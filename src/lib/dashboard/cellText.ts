/**
 * Type sizing for the week-strip day figures on a phone.
 *
 * Seven cells share the viewport, so how much room a figure has depends on the
 * device: roughly 45px per cell on a 375px phone and 53px on a Pro Max. A fixed
 * step table cannot know which, so it has to assume the worst screen and then
 * every larger one renders a needlessly tiny number inside an obviously
 * half-empty cell.
 *
 * So the figure is sized against the CELL rather than the string: cqw units,
 * capped at the same 12px the short days already use. A four-figure day now
 * renders exactly as large as a three-figure one wherever there is room, and
 * only shrinks on the screens that genuinely cannot fit it.
 *
 * The cell previously used Tailwind's `truncate`, which elided a four-figure
 * day to "1,4…" -- hiding the digits the cell exists to show.
 */

/** Ceiling, matching the short-day size (text-xs). */
const MAX_FONT_REM = 0.75;

/**
 * Share of the cell's width left for the figure after padding and border.
 * px-1.5 + border-2 costs 16px of a ~47px cell.
 */
const USABLE_FRACTION = 0.74;

/**
 * Advance width per character in em, for a bold tracking-tight face. Digits are
 * tabular so they share one width; punctuation is materially narrower and
 * treating it as a full digit is what makes naive estimates over-shrink.
 */
function advanceEm(text: string): number {
  let em = 0;
  for (const char of text) {
    if (char === ",") em += 0.3;
    else if (char === ".") em += 0.28;
    else if (char === "+" || char === "-") em += 0.55;
    else em += 0.6;
  }
  // tracking-tight pulls -0.025em between characters.
  return Math.max(0.6, em - Math.max(0, text.length - 1) * 0.025);
}

/**
 * A CSS font-size for the mobile figure. Requires an ancestor with
 * `container-type: inline-size` -- the cell sets it.
 */
export function mobileCashflowFontSize(text: string): string {
  const advance = advanceEm(text);
  const cqw = (USABLE_FRACTION * 100) / advance;
  return `min(${MAX_FONT_REM}rem, ${cqw.toFixed(1)}cqw)`;
}
