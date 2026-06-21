// Custom-job shift bars render in a user-chosen hex color. Tailwind cannot
// compile class names built from runtime values (bg-[#abc123] would be a dead
// class), so callers apply these via inline style: backgroundColor / borderColor
// / color. These helpers derive a border shade and a legible text color.

function parseHex(hex: string): { r: number; g: number; b: number } {
  const match = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  const value = match ? match[1] : "475569"; // slate-600 fallback
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
    .join("")}`;
}

// A darker shade for the bar's border.
export function darken(hex: string, factor = 0.7): string {
  const { r, g, b } = parseHex(hex);
  return toHex(r * factor, g * factor, b * factor);
}

// White or near-black text, whichever reads better on the given background.
export function contrastText(hex: string): string {
  const { r, g, b } = parseHex(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2937" : "#ffffff";
}
