"use client";

import { useTheme } from "./ThemeProvider";

// Site-wide theme switcher. Lives in the sidebar so it's reachable on every
// screen; flips <html data-theme> through the ThemeProvider.
export function ThemeToggle() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <div
      className="flex gap-1"
      style={{
        background: "var(--surface-elevated)",
        border: "1px solid var(--border-default)",
        borderRadius: "9999px",
        padding: "3px",
      }}
    >
      {themes.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setTheme(option)}
          aria-pressed={theme === option}
          className="flex-1 px-3 py-1 text-xs font-medium capitalize transition-colors"
          style={
            theme === option
              ? {
                  background: "var(--accent-brand)",
                  color: "#ffffff",
                  borderRadius: "9999px",
                }
              : {
                  background: "transparent",
                  color: "var(--text-tertiary)",
                  borderRadius: "9999px",
                }
          }
        >
          {option}
        </button>
      ))}
    </div>
  );
}
