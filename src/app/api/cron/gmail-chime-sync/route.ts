import { NextResponse, after } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CHIME_SENDER = "alerts@account.chime.com";
const FORWARDED_LABEL = "shiftlycash-forwarded";
// Reasonable batch size now that the work runs in the background after the
// response is sent — we have the full maxDuration window instead of 30s.
const FETCH_CAP = 10;
// Hard deadline inside the background task so we never exceed Vercel's
// function timeout. Leaves buffer for connection teardown.
const SOFT_DEADLINE_MS = 50_000;

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

  // Hand the actual IMAP/Haiku work to `after()` so the cron caller gets a
  // fast 200 response. IMAP connect + per-message Haiku parsing was busting
  // cron-job.org's 30s response limit. Background work runs up to the
  // route's maxDuration (60s) which is more than enough for FETCH_CAP=10.
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
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Restrict the search window to recent mail so we don't scan years of
      // history on every minute-tick.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const uids = await client.search({ from: CHIME_SENDER, since });

      if (!uids || uids.length === 0) {
        return summary;
      }

      const recentUids = uids.slice(-FETCH_CAP);
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
        // Gmail's X-GM-LABELS IMAP extension via imapflow's setFlags equivalent.
        await client.messageFlagsAdd(
          message.uid,
          [FORWARDED_LABEL],
          { uid: true, useLabels: true },
        );

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
