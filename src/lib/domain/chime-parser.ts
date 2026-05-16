import "server-only";

import Anthropic from "@anthropic-ai/sdk";

const PARSER_MODEL = "claude-haiku-4-5";

export type ChimeParseKind =
  | "purchase"
  | "deposit"
  | "transfer_in"
  | "transfer_out"
  | "refund"
  | "pending_charge"
  | "balance_alert"
  | "card_event"
  | "unknown_known_chime";

export type ChimeParseResult =
  | {
      ok: true;
      kind: ChimeParseKind;
      amountDollars: number | null;
      merchantOrSource: string | null;
      newBalanceDollars: number | null;
      direction: "debit" | "credit" | "neutral";
      confidence: "high" | "medium" | "low";
      reasoning: string;
    }
  | { ok: false; reason: string };

const SYSTEM_PROMPT = `You read Chime bank push notifications from the user's iPhone and extract structured transaction data. Return JSON only.

## Known Chime notification types

- **purchase**: card debit at a merchant. Example: "You spent $5.05" / "Your new Chime account balance is $233.76 after your purchase at Anthropic."
- **deposit**: paycheck or external deposit arriving. Example: "You got paid $1,500.00 from EMPLOYER" or "$500 was deposited"
- **transfer_in**: money received from another Chime user or external source. Example: "John P. sent you $50"
- **transfer_out**: money sent to another person. Example: "You sent $50 to John P."
- **refund**: money returned from a merchant. Example: "You got a $12.34 refund from MERCHANT"
- **pending_charge**: card auth before settlement. Example: "Pending charge of $43.27 at MERCHANT"
- **balance_alert**: informational, no transaction. Example: "Your balance is below $100"
- **card_event**: security/lock notifications. Example: "Your card was used at..." (without dollar amount)
- **unknown_known_chime**: clearly a Chime notification but doesn't fit any pattern above

## Output JSON schema (strict, no markdown)

{
  "kind": one of the types above,
  "amountDollars": number (positive) or null if no dollar amount,
  "merchantOrSource": string or null (the merchant for purchases/refunds; the sender for transfers_in; the payer for deposits; null for balance alerts),
  "newBalanceDollars": number or null (extract if the notification mentions "Your new Chime account balance is $X"),
  "direction": "debit" (money leaving) | "credit" (money arriving) | "neutral" (info only),
  "confidence": "high" if you're certain of every field, "medium" if some inference, "low" if ambiguous,
  "reasoning": ONE short sentence explaining your call
}

Direction rules:
- purchase, transfer_out, pending_charge -> "debit"
- deposit, transfer_in, refund -> "credit"
- balance_alert, card_event, unknown -> "neutral"

If amount has commas (e.g. "$1,234.56"), strip the comma before returning as a number.

Output JSON only. No markdown, no preamble.`;

export async function parseChimeNotification(input: {
  title: string | null;
  body: string;
}): Promise<ChimeParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY not configured" };
  }

  const title = (input.title ?? "").trim();
  const body = input.body.trim();
  if (!body && !title) {
    return { ok: false, reason: "Empty notification" };
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: PARSER_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Title: ${title || "(none)"}\nBody: ${body || "(none)"}`,
        },
      ],
    });

    const text = extractText(response.content).trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    const parsed: unknown = JSON.parse(cleaned);

    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, reason: "AI returned non-object" };
    }

    const obj = parsed as Record<string, unknown>;

    return {
      ok: true,
      kind: parseKind(obj.kind),
      amountDollars: toOptionalNumber(obj.amountDollars),
      merchantOrSource:
        typeof obj.merchantOrSource === "string" &&
        obj.merchantOrSource.trim().length > 0
          ? obj.merchantOrSource.trim().slice(0, 120)
          : null,
      newBalanceDollars: toOptionalNumber(obj.newBalanceDollars),
      direction: parseDirection(obj.direction),
      confidence: parseConfidence(obj.confidence),
      reasoning: typeof obj.reasoning === "string" ? obj.reasoning.slice(0, 200) : "",
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "AI parser failed",
    };
  }
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  for (const block of content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

function parseKind(value: unknown): ChimeParseKind {
  const valid = [
    "purchase",
    "deposit",
    "transfer_in",
    "transfer_out",
    "refund",
    "pending_charge",
    "balance_alert",
    "card_event",
    "unknown_known_chime",
  ] as const;
  if (typeof value === "string" && (valid as readonly string[]).includes(value)) {
    return value as ChimeParseKind;
  }
  return "unknown_known_chime";
}

function parseDirection(value: unknown): "debit" | "credit" | "neutral" {
  if (value === "debit" || value === "credit" || value === "neutral") return value;
  return "neutral";
}

function parseConfidence(value: unknown): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}
