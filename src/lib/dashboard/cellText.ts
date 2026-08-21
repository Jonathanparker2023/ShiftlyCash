/**
 * Type sizing for the week-strip day cells on a phone.
 *
 * Seven cells share the viewport width, so the widest figure decides the type
 * size. On a 375px screen each cell has roughly 41px of usable width after
 * padding, which a four-figure cashflow overflows at the default size.
 *
 * The cell used to carry Tailwind's `truncate`, so that overflow was elided to
 * "1,4…" -- hiding exactly the digits the cell exists to show. Scaling the
 * figure to fit is the right trade: a small number is readable, a clipped one
 * is not.
 */
export function mobileCashflowSizeClass(text: string): string {
  if (text.length >= 7) return "text-[9px]";
  if (text.length >= 6) return "text-[10px]";
  if (text.length >= 5) return "text-[11px]";
  return "text-xs";
}
