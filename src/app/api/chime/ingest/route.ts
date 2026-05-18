import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  parseChimeNotification,
  type ChimeParseKind,
  type ChimeParseResult,
} from "@/lib/domain/chime-parser";
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
    const todayDate = receivedAt.slice(0, 10);
    const importKey = `${receivedAt}|${title ?? ""}|${text}`.slice(0, 240);
    const amount = transactionAmount(parsed);
    const merchantName = parsed.merchantOrSource || `Chime ${parsed.kind}`;

    const { data: txInserted, error: txError } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        source: "chime",
        status: "applied",
        review_reason: null,
        merchant_name: merchantName,
        raw_name: merchantName,
        amount,
        date: todayDate,
        datetime: receivedAt,
        import_key: importKey,
        category: categoryForKind(parsed.kind),
        pending: parsed.kind === "pending_charge",
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

  console.info(
    `[chime/ingest] capture=${capInserted?.id ?? "fail"} tx=${parsedTransactionId ?? "none"} ${
      parsed.ok ? "OK" : (parseFailureReason ?? "no-match")
    }`,
  );

  return NextResponse.json({
    ok: true,
    capture_id: capInserted?.id ?? null,
    transaction_id: parsedTransactionId,
    parsed: parsed.ok,
    parse_failure_reason: parseFailureReason,
  });
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
    case "balance_alert":
    case "card_event":
    case "unknown_known_chime":
      return "chime";
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
