export type ChimeParseResult =
  | {
      ok: true;
      kind: "purchase";
      amountDollars: number;
      merchant: string;
      newBalanceDollars: number | null;
    }
  | { ok: false; reason: string };

// Confirmed format from Jon's iPhone (2026-05-15):
//   title: "You spent $5.05"
//   body:  "Your new Chime account balance is $233.76 after your purchase at Anthropic."
const PURCHASE_TITLE_RE = /^You spent \$([\d,]+\.\d{2})$/i;
const PURCHASE_BODY_RE =
  /Your new Chime account balance is \$([\d,]+\.\d{2}) after your purchase at (.+?)\.?$/i;

export function parseChimeNotification(input: {
  title: string | null;
  body: string;
}): ChimeParseResult {
  const title = (input.title ?? "").trim();
  const body = input.body.trim();

  const titleMatch = title.match(PURCHASE_TITLE_RE);
  const bodyMatch = body.match(PURCHASE_BODY_RE);
  if (titleMatch && bodyMatch) {
    const amount = Number.parseFloat(titleMatch[1].replace(/,/g, ""));
    const balance = Number.parseFloat(bodyMatch[1].replace(/,/g, ""));
    const merchant = bodyMatch[2].trim();

    if (Number.isFinite(amount) && amount > 0 && merchant.length > 0) {
      return {
        ok: true,
        kind: "purchase",
        amountDollars: round2(amount),
        merchant,
        newBalanceDollars: Number.isFinite(balance) ? round2(balance) : null,
      };
    }
  }

  return {
    ok: false,
    reason: `No matching pattern. title="${title.slice(0, 60)}" body="${body.slice(0, 120)}"`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
