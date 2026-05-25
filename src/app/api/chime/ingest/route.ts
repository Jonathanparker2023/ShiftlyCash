import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  parseChimeNotification,
  type ChimeParseKind,
  type ChimeParseResult,
} from "@/lib/domain/chime-parser";
import { toLocalIsoDate } from "@/lib/dashboard/dates";
import { createAdminClient } from "@/lib/supabase/admin";

const SECRET_ENV = "CHIME_INGEST_SECRET";

export async function POST(request: Request) {
  const expected = process.env[SECRET_ENV];
  if (!expected) {
    return NextResponse.json({ error: `${SECRET_ENV} not configured` }, { status: 500 });
  }

  const provided = request.headers.get("x-chime-ingest-key");
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const obj = body as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  const title = typeof obj.title === "string" ? obj.title.trim() : null;
  const receivedAt =
    typeof obj.receivedAt === "string" ? obj.receivedAt : new Date().toISOString();

  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (profileError || !profile?.id) {
    return NextResponse.json(
      { error: `Unable to resolve user: ${profileError?.message ?? "no profile"}` },
      { status: 500 },
    );
  }

  const userId = profile.id as string;
  const sourceMeta: Record<string, unknown> = {};
  if (typeof obj.shortcutVersion === "string") {
    sourceMeta.shortcutVersion = obj.shortcutVersion;
  }
  if (typeof obj.appBundle === "string") {
    sourceMeta.appBundle = obj.appBundle;
  }

  const parsed = await parseChimeNotification({ title, body: text });
  let parsedTransactionId: string | null = null;
  let parseFailureReason: string | null = null;
  let parsedAt: string | null = null;

  if (parsed.ok && isMoneyMovementKind(parsed.kind)) {
    // Use the user's LOCAL date, not the UTC date from the email
    // timestamp. A Chime email sent at 9:38 PM EDT has receivedAt of
    // 01:38 UTC the next day; naive UTC slicing would land it on
    // tomorrow's date and miss the days row, forcing pending_review.
    const todayDate = toLocalIsoDate(receivedAt);
    const importKey = `${receivedAt}|${title ?? ""}|${text}`.slice(0, 240);
    const amount = transactionAmount(parsed);
    const merchantName = formatChimeMerchantName(parsed);

    // Guardrail: if Haiku returned amountDollars=null the parser fills
    // amount with 0. A dedup query keyed on amount=0 matches any
    // placeholder Plaid row and silently merges unrelated transactions.
    // Skip the insert in that case and leave the capture with a clear
    // failure reason for review rather than corrupting dedup state.
    if (!Number.isFinite(amount) || amount === 0) {
      parseFailureReason = `No amount extracted for ${parsed.kind} (kind=${parsed.kind}, direction=${parsed.direction})`;
    } else {

    // Resolve the day row for this transaction's date so we can mark it
    // applied immediately (mirrors Plaid sync logic). If no day exists or
    // the day is spend-locked, fall back to pending_review.
    const { data: day } = await supabase
      .from("days")
      .select("id,spend_locked")
      .eq("user_id", userId)
      .eq("date", todayDate)
      .maybeSingle();

    const shouldExclude = shouldAutoExclude(parsed.kind);
    const canApply = Boolean(day?.id) && !day?.spend_locked;
    const status = shouldExclude
      ? "excluded"
      : canApply
        ? "applied"
        : "pending_review";
    const dayId = canApply ? (day!.id as string) : null;
    const reviewReason = shouldExclude
      ? reviewReasonForExcludedKind(parsed.kind)
      : canApply
        ? null
        : day?.spend_locked
          ? "day_locked"
          : "no_matching_day";

    // Cross-source dedup: if a Plaid sync already landed this exact
    // transaction (same date + amount), don't double-write — just note
    // the chime capture in the existing row's notes for traceability.
    const { data: existingPlaid } = await supabase
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "plaid")
      .eq("date", todayDate)
      .eq("amount", amount)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existingPlaid?.id) {
      parsedTransactionId = existingPlaid.id as string;
      parsedAt = new Date().toISOString();
      parseFailureReason = "Cross-source match: Plaid row already exists";
    } else {
      const { data: txInserted, error: txError } = await supabase
        .from("transactions")
        .insert({
          user_id: userId,
          source: "chime",
          status,
          day_id: dayId,
          review_reason: reviewReason,
          merchant_name: merchantName,
          raw_name: merchantName,
          amount,
          date: todayDate,
          datetime: receivedAt,
          import_key: importKey,
          category: categoryForKind(parsed.kind),
          pending: parsed.kind === "pending_charge",
          excluded_at: shouldExclude ? new Date().toISOString() : null,
          notes: chimeNotes(parsed),
        })
        .select("id")
        .single();

      if (txError) {
        parseFailureReason =
          txError.code === "23505"
            ? "Duplicate import_key (already captured)"
            : `Transaction insert failed: ${txError.message}`;
      } else {
        parsedTransactionId = txInserted.id as string;
        parsedAt = new Date().toISOString();
      }
    }
    } // end amount-guard else
  } else if (!parsed.ok) {
    parseFailureReason = parsed.reason;
  } else {
    parseFailureReason = `No transaction created for ${parsed.kind}: ${parsed.reasoning}`;
  }

  const { data: capInserted, error: capError } = await supabase
    .from("chime_raw_captures")
    .insert({
      user_id: userId,
      raw_title: title,
      raw_text: text,
      received_at: receivedAt,
      source_meta: Object.keys(sourceMeta).length > 0 ? sourceMeta : null,
      parsed_at: parsedAt,
      parsed_transaction_id: parsedTransactionId,
      parse_failure_reason: parseFailureReason,
    })
    .select("id")
    .single();

  if (capError) {
    console.error(`[chime/ingest] capture insert failed: ${capError.message}`);
  }

  if (parsedTransactionId) {
    revalidatePath("/");
  }

  // Always log parseFailureReason when present, even on parsed.ok=true —
  // a parsed=ok with no transaction means Haiku classified the event as
  // non-money-movement (balance_alert, card_event, etc.) and we want to
  // see why.
  const parseSummary = parsed.ok
    ? `kind=${parsed.kind} amount=${parsed.amountDollars ?? "null"} dir=${parsed.direction}`
    : "parse-failed";
  const logStatus = parsedTransactionId
    ? "TX"
    : parseFailureReason
      ? `SKIP: ${parseFailureReason}`
      : parsed.ok
        ? `NOOP kind=${parsed.kind}`
        : "PARSE_FAIL";
  console.info(
    `[chime/ingest] capture=${capInserted?.id ?? "fail"} tx=${parsedTransactionId ?? "none"} ${logStatus} (${parseSummary})`,
  );

  return NextResponse.json({
    ok: true,
    capture_id: capInserted?.id ?? null,
    transaction_id: parsedTransactionId,
    parsed: parsed.ok,
    parse_failure_reason: parseFailureReason,
  });
}

// Build a merchant-name string that makes the kind obvious at-a-glance
// in the dashboard transaction list. Without this, a transfer_out to
// "kayla b" rendered as just "kayla b" — visually indistinguishable
// from a card purchase at a merchant named kayla b. Prefix transfers,
// deposits, and refunds with a direction word so the row label is
// self-describing.
function formatChimeMerchantName(
  parsed: Extract<ChimeParseResult, { ok: true }>,
): string {
  const source = parsed.merchantOrSource?.trim() || `Chime ${parsed.kind}`;
  switch (parsed.kind) {
    case "transfer_out":
      return `Sent to ${source}`;
    case "transfer_in":
      return `Transfer credit: ${source}`;
    case "deposit":
      return `Deposit credit: ${source}`;
    case "refund":
      return `Refund credit: ${source}`;
    default:
      // purchase, pending_charge, etc. — keep the merchant name plain
      return source;
  }
}

function isMoneyMovementKind(kind: ChimeParseKind): boolean {
  return [
    "purchase",
    "pending_charge",
    "transfer_out",
    "deposit",
    "transfer_in",
    "refund",
  ].includes(kind);
}

function transactionAmount(parsed: Extract<ChimeParseResult, { ok: true }>): number {
  const amount = parsed.amountDollars ?? 0;
  return parsed.direction === "credit" ? -amount : amount;
}

function categoryForKind(kind: ChimeParseKind): string {
  switch (kind) {
    case "deposit":
      return "deposit";
    case "transfer_in":
    case "transfer_out":
      return "transfer";
    case "refund":
      return "refund";
    case "pending_charge":
      return "pending_charge";
    case "purchase":
      return "purchase";
    case "payment_request":
    case "balance_alert":
    case "card_event":
    case "unknown_known_chime":
      return "chime";
  }
}

function shouldAutoExclude(kind: ChimeParseKind): boolean {
  return kind === "transfer_in" || kind === "deposit" || kind === "refund";
}

function reviewReasonForExcludedKind(kind: ChimeParseKind): string | null {
  switch (kind) {
    case "transfer_in":
      return "transfer_credit";
    case "deposit":
      return "income_deposit";
    case "refund":
      return "refund_credit";
    default:
      return null;
  }
}

function chimeNotes(parsed: Extract<ChimeParseResult, { ok: true }>): string {
  const parts: string[] = [];
  if (parsed.newBalanceDollars !== null) {
    parts.push(`Chime balance after: $${parsed.newBalanceDollars.toFixed(2)}`);
  }
  if (parsed.reasoning) {
    parts.push(`AI parser: ${parsed.reasoning}`);
  }
  return parts.join(" | ");
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "chime/ingest" });
}
