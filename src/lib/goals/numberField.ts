/**
 * Text <-> cents for the Goals number inputs.
 *
 * These fields used to bind straight to a number, which made them impossible to
 * clear: deleting the digits produced 0, the parent read 0 as "no override",
 * and the fallback figure was written back into the box on the next render. The
 * user could never reach an empty field to type their own value.
 *
 * The fix needs three outcomes, not two, so it lives here where it can be
 * tested without standing up a DOM.
 */

/** What an edit should commit upward. */
export type FieldCommit =
  /** Field was cleared -- follow the default again. Distinct from a typed 0. */
  | { kind: "cleared" }
  /** A usable number, in cents. */
  | { kind: "value"; cents: number }
  /** Half-typed ("", ".", "1e", "-"). Keep the text, commit nothing. */
  | { kind: "ignore" };

export function commitFromText(text: string): FieldCommit {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "cleared" };

  // A lone separator or sign is a keystroke on the way to a number, not a
  // number. Committing it would round to 0 and snap the field back.
  if (/^[.,-]$/.test(trimmed)) return { kind: "ignore" };

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return { kind: "ignore" };

  return { kind: "value", cents: Math.round(parsed * 100) };
}

/** How a committed value should read when the field is not being edited. */
export function canonicalText(valueCents: number): string {
  return valueCents % 100 === 0
    ? String(Math.round(valueCents / 100))
    : (valueCents / 100).toFixed(2);
}
