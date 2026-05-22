import { NextResponse, after } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CHIME_SENDER = "alerts@account.chime.com";
const FORWARDED_LABEL = "shiftlycash-forwarded";
// IMAP connect + per-email Haiku call (~3-5s each) easily exceeds Vercel's
// 60s function limit at higher caps. Keep low; the cron fires every minute,
// so a backlog drains quickly even at 3/run.
const FETCH_CAP = 3;
// Hard deadline inside the background task so we never exceed Vercel's
// function timeout. Leaves buffer for connection teardown.
const SOFT_DEADLINE_MS = 45_000;

type Summary = {
  ok: boolean;
  scanned: number;
  forwarded: number;
  failed: number;
  alreadyLabeled: number;
  errors: string[];
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = process.env.GMAIL_USER;
  const password = process.env.GMAIL_APP_PASSWORD;
  if (!user || !password) {
    return NextResponse.json(
      { error: "GMAIL_USER and GMAIL_APP_PASSWORD must be configured" },
      { status: 500 },
    );
  }

  const ingestUrl = absoluteIngestUrl(request);
  const ingestKey = process.env.CHIME_INGEST_SECRET;
  if (!ingestKey) {
    return NextResponse.json(
      { error: "CHIME_INGEST_SECRET not configured" },
      { status: 500 },
    );
  }

  // TEMPORARILY DISABLED 2026-05-21 — label-apply via imapflow's
  // messageFlagsAdd was hanging silently, causing every cron firing to
  // re-process the SAME email and burn 60s of background compute. That
  // path is exhausting Vercel free-tier quotas (50%+ used in 2 days).
  // Set ENABLE_GMAIL_CHIME_SYNC=1 in Vercel env to re-enable once the
  // label-apply bug is fixed. Until then, the Plaid 6h backup cron is
  // the only Chime ingestion path.
  if (process.env.ENABLE_GMAIL_CHIME_SYNC !== "1") {
    return NextResponse.json({
      ok: true,
      disabled: true,
      reason: "Temporarily disabled — label-apply bug burns Vercel quota",
    });
  }

  // Hand the actual IMAP/Haiku work to `after()` so the cron caller gets a
  // fast 200 response.
  after(async () => {
    const result = await processChimeBacklog({
      user,
      password,
      ingestUrl,
      ingestKey,
    });
    console.info("[cron/gmail-chime-sync] result:", JSON.stringify(result));
  });

  return NextResponse.json({ ok: true, queued: true });
}

type ProcessOpts = {
  user: string;
  password: string;
  ingestUrl: string;
  ingestKey: string;
};

async function processChimeBacklog(opts: ProcessOpts): Promise<Summary> {
  const summary: Summary = {
    ok: true,
    scanned: 0,
    forwarded: 0,
    failed: 0,
    alreadyLabeled: 0,
    errors: [],
  };

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: opts.user, pass: opts.password },
    logger: false,
  });

  try {
    await client.connect();

    // Ensure the forwarded label exists in Gmail before we try to apply
    // it. Without this, messageFlagsAdd silently no-ops, the email
    // never gets labeled, and the cron re-processes the same email
    // every minute — burning Anthropic tokens and producing duplicate
    // chime_raw_captures rows. mailboxCreate is idempotent: if the
    // label already exists, the error is caught and ignored.
    try {
      await client.mailboxCreate(FORWARDED_LABEL);
    } catch (createErr) {
      // imapflow throws on ALREADYEXISTS; that's expected. Log other
      // errors but don't abort the run.
      const msg = createErr instanceof Error ? createErr.message : "";
      if (!/already exists|alreadyexists/i.test(msg)) {
        console.warn(
          `[cron/gmail-chime-sync] label create failed: ${msg}`,
        );
      }
    }

    const lock = await client.getMailboxLock("INBOX");
    try {
      // Use Gmail's RAW search (X-GM-RAW) so we can exclude security alert
      // subjects at the server. Chime sends a "New login detected" /
      // "Was this you?" email every time the app authenticates, and those
      // would otherwise crowd out actual money-movement emails from the
      // FETCH_CAP slice. We also explicitly exclude already-labeled
      // emails so successful labels stop reappearing in the search.
      const uids = await client.search({
        gmailraw: `from:${CHIME_SENDER} newer_than:1d -label:${FORWARDED_LABEL} -subject:"New login detected" -subject:"Was this you"`,
      });

      if (!uids || uids.length === 0) {
        return summary;
      }

      // Process OLDEST first so backlogs drain in arrival order; newer
      // emails wait their turn. This prevents a flood of recent emails
      // from starving older ones.
      const recentUids = uids.slice(0, FETCH_CAP);
      summary.scanned = recentUids.length;
      const startedAt = Date.now();

      for await (const message of client.fetch(
        recentUids,
        { source: true, labels: true, internalDate: true, uid: true },
        { uid: false },
      )) {
        if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
          summary.errors.push(
            `Soft deadline hit after ${summary.forwarded} forwarded; remaining will retry next run.`,
          );
          break;
        }

        const labels = message.labels ?? new Set<string>();
        if (labels.has(FORWARDED_LABEL)) {
          summary.alreadyLabeled += 1;
          continue;
        }

        if (!message.source) {
          summary.failed += 1;
          summary.errors.push(`uid=${message.uid}: no source`);
          continue;
        }

        const parsed = await simpleParser(message.source);
        const title = (parsed.subject ?? "").slice(0, 240);
        const htmlBody = typeof parsed.html === "string" ? parsed.html : "";
        const text = (parsed.text ?? stripHtml(htmlBody)).slice(0, 4000);
        const rawDate =
          message.internalDate ?? parsed.date ?? new Date();
        const receivedAt = new Date(rawDate).toISOString();

        if (!text && !title) {
          summary.failed += 1;
          summary.errors.push(`uid=${message.uid}: empty body`);
          continue;
        }

        const response = await fetch(opts.ingestUrl, {
          method: "POST",
          headers: {
            "x-chime-ingest-key": opts.ingestKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            text,
            receivedAt,
            appBundle: "gmail-imap-cron",
            shortcutVersion: "v1",
          }),
        });

        if (!response.ok) {
          summary.failed += 1;
          const errBody = await response.text();
          summary.errors.push(
            `uid=${message.uid}: ingest ${response.status} ${errBody.slice(0, 160)}`,
          );
          continue;
        }

        // Apply the Gmail label so we don't re-forward next minute. Uses
        // Gmail's X-GM-LABELS IMAP extension via imapflow's setFlags
        // equivalent. Log success/failure explicitly because a silent
        // no-op here means the cron re-processes the same email forever.
        try {
          const labelResult = await client.messageFlagsAdd(
            message.uid,
            [FORWARDED_LABEL],
            { uid: true, useLabels: true },
          );
          if (!labelResult) {
            console.warn(
              `[cron/gmail-chime-sync] label add returned false for uid=${message.uid}`,
            );
          }
        } catch (labelErr) {
          console.warn(
            `[cron/gmail-chime-sync] label add threw for uid=${message.uid}: ${labelErr instanceof Error ? labelErr.message : labelErr}`,
          );
        }

        summary.forwarded += 1;
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    summary.ok = false;
    summary.errors.push(
      err instanceof Error ? err.message : "Unknown IMAP error",
    );
    console.error(
      "[cron/gmail-chime-sync] failed:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }

  return summary;
}

function absoluteIngestUrl(request: Request): string {
  const explicit = process.env.SHIFTLYCASH_BASE_URL;
  if (explicit) {
    return `${explicit.replace(/\/$/, "")}/api/chime/ingest`;
  }
  const url = new URL(request.url);
  return `${url.origin}/api/chime/ingest`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
