// Shared theme constants/types — deliberately NOT a "use client" module so the
// server root layout can import the real values (importing them from the client
// ThemeProvider would hand the server client-reference stubs instead).

export type Theme = "linear" | "apple";

export const THEMES: Theme[] = ["linear", "apple"];

export const THEME_COOKIE_KEY = "shiftlycash-theme";

export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isTheme(value: unknown): value is Theme {
  return value === "linear" || value === "apple";
}
