import { NextResponse, after } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CHIME_SENDER = "alerts@account.chime.com";
// Process at most this many new emails per firing. Cron fires every
// minute so even a 10-email backlog drains in ~3 minutes. The cap
// exists so a sudden burst can't blow the function timeout.
const FETCH_CAP = 3;
// Hard ceiling on background work. We reject AFTER this elapses even
// if mid-IMAP-fetch, so a hanging Gmail call can't burn the full 60s
// Vercel function budget. Set conservatively below Vercel's 60s limit.
const HARD_DEADLINE_MS = 25_000;
// Look back this far for new Chime emails. Anything older than this
// window is presumed handled (or intentionally skipped).
const SEARCH_WINDOW_DAYS = 1;

type Summary = {
  ok: boolean;
  scanned: number;
  newlyProcessed: number;
  alreadyProcessed: number;
  failed: number;
  errors: string[];
  durationMs: number;
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

  // Kill switch. Default OFF until manually re-enabled. Keep this
  // before Gmail/env validation so disabled runs stay cheap and safe.
  if (process.env.ENABLE_GMAIL_CHIME_SYNC !== "1") {
    return NextResponse.json({
      ok: true,
      disabled: true,
      reason:
        "Set ENABLE_GMAIL_CHIME_SYNC=1 in Vercel env to enable Gmail sync.",
    });
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

  // Background the IMAP work so cron-job.org gets a fast 200 in <1s.
  // processChimeBacklog wraps everything in a hard-timeout Promise.race
  // so a hanging network call can't drag the function past HARD_DEADLINE_MS.
  after(async () => {
    const startedAt = Date.now();
    try {
      const result = await Promise.race([
        processChimeBacklog({ user, password, ingestUrl, ingestKey }),
        hardDeadline(),
      ]);
      console.info(
        `[cron/gmail-chime-sync] ${oneLineSummary(result, startedAt)}`,
      );
    } catch (err) {
      console.error(
        `[cron/gmail-chime-sync] aborted after ${Date.now() - startedAt}ms: ${err instanceof Error ? err.message : err}`,
      );
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`hard deadline ${HARD_DEADLINE_MS}ms exceeded`)),
      HARD_DEADLINE_MS,
    );
  });
}

function oneLineSummary(result: Summary, startedAt: number): string {
  return `done in ${Date.now() - startedAt}ms scanned=${result.scanned} new=${result.newlyProcessed} dup=${result.alreadyProcessed} fail=${result.failed} ok=${result.ok}${result.errors.length > 0 ? ` errs=${result.errors.slice(0, 3).join(" | ")}` : ""}`;
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
    newlyProcessed: 0,
    alreadyProcessed: 0,
    failed: 0,
    errors: [],
    durationMs: 0,
  };
  const startedAt = Date.now();

  // Resolve the active user once. The ingest endpoint does its own
  // user lookup so this is only for the dedup table writes.
  const supabase = createAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (profileError || !profile?.id) {
    summary.ok = false;
    summary.errors.push(
      `Unable to resolve user: ${profileError?.message ?? "no profile"}`,
    );
    summary.durationMs = Date.now() - startedAt;
    return summary;
  }
  const userId = profile.id as string;

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
      // X-GM-RAW search so we can exclude security-alert subjects at
      // the server. No label filter here — we now dedup via Supabase,
      // not Gmail labels.
      const uids = await client.search({
        gmailraw: `from:${CHIME_SENDER} newer_than:${SEARCH_WINDOW_DAYS}d -subject:"New login detected" -subject:"Was this you"`,
      });

      if (!uids || uids.length === 0) {
        summary.durationMs = Date.now() - startedAt;
        return summary;
      }

      // Process oldest first so backlogs drain in arrival order.
      const candidateUids = uids.slice(0, Math.min(uids.length, FETCH_CAP * 3));
      summary.scanned = candidateUids.length;

      // Collect (uid, messageId, source, subject, date) for each candidate.
      type Candidate = {
        uid: number;
        messageId: string;
        title: string;
        text: string;
        receivedAt: string;
      };
      const candidates: Candidate[] = [];

      for await (const message of client.fetch(
        candidateUids,
        { source: true, internalDate: true, uid: true, envelope: true },
        { uid: false },
      )) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const sourceHash = createHash("sha256")
          .update(message.source)
          .digest("hex")
          .slice(0, 32);
        const messageId =
          parsed.messageId?.trim() ||
          message.envelope?.messageId?.trim() ||
          (typeof message.uid === "number"
            ? `uid:${message.uid}`
            : `source:${sourceHash}`);
        const title = (parsed.subject ?? "").slice(0, 240);
        const htmlBody = typeof parsed.html === "string" ? parsed.html : "";
        const text = (parsed.text ?? stripHtml(htmlBody)).slice(0, 4000);
        const rawDate =
          message.internalDate ?? parsed.date ?? new Date();
        candidates.push({
          uid: message.uid ?? 0,
          messageId,
          title,
          text,
          receivedAt: new Date(rawDate).toISOString(),
        });
      }

      if (candidates.length === 0) {
        summary.durationMs = Date.now() - startedAt;
        return summary;
      }

      // Single DB roundtrip: fetch already-processed IDs from the
      // candidates we just collected. Filtering server-side keeps the
      // IN list bounded.
      const { data: processed, error: processedErr } = await supabase
        .from("chime_gmail_processed")
        .select("gmail_message_id")
        .eq("user_id", userId)
        .in(
          "gmail_message_id",
          candidates.map((c) => c.messageId),
        );
      if (processedErr) {
        summary.ok = false;
        summary.errors.push(`Dedup query failed: ${processedErr.message}`);
        summary.durationMs = Date.now() - startedAt;
        return summary;
      }
      const processedSet = new Set(
        (processed ?? []).map((r) => r.gmail_message_id as string),
      );
      summary.alreadyProcessed = processedSet.size;

      const fresh = candidates
        .filter((c) => !processedSet.has(c.messageId))
        .slice(0, FETCH_CAP);

      for (const candidate of fresh) {
        if (!candidate.text && !candidate.title) {
          summary.failed += 1;
          summary.errors.push(`uid=${candidate.uid}: empty body`);
          continue;
        }

        const response = await fetch(opts.ingestUrl, {
          method: "POST",
          headers: {
            "x-chime-ingest-key": opts.ingestKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: candidate.title,
            text: candidate.text,
            receivedAt: candidate.receivedAt,
            appBundle: "gmail-imap-cron",
            shortcutVersion: "v2",
          }),
        });

        if (!response.ok) {
          summary.failed += 1;
          const errBody = await response.text();
          summary.errors.push(
            `uid=${candidate.uid}: ingest ${response.status} ${errBody.slice(0, 160)}`,
          );
          continue;
        }

        let captureId: string | null = null;
        try {
          const body = (await response.json()) as { capture_id?: string };
          captureId = typeof body.capture_id === "string" ? body.capture_id : null;
        } catch {
          // ingest returned non-JSON; that's fine, capture_id stays null
        }

        // Mark this message ID processed BEFORE we count it as a
        // success. If this insert fails, the next firing will re-try
        // — which is the correct behavior since the ingest itself
        // dedups on import_key, so retries are safe.
        const { error: insertErr } = await supabase
          .from("chime_gmail_processed")
          .insert({
            gmail_message_id: candidate.messageId,
            user_id: userId,
            capture_id: captureId,
          });

        if (insertErr) {
          // Duplicate-key (23505) means another concurrent run beat
          // us to it — still a success path. Other errors get
          // surfaced but don't abort the loop.
          if (insertErr.code !== "23505") {
            summary.errors.push(
              `dedup insert failed for ${candidate.messageId}: ${insertErr.message}`,
            );
          }
        }

        summary.newlyProcessed += 1;
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    summary.ok = false;
    summary.errors.push(
      err instanceof Error ? err.message : "Unknown IMAP error",
    );
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }

  summary.durationMs = Date.now() - startedAt;
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
