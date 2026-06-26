"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import {
  THEME_COOKIE_KEY,
  THEME_COOKIE_MAX_AGE,
  THEMES,
  type Theme,
} from "./theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  themes: Theme[];
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Site-wide theme. Persisted in a cookie (read server-side in the root layout so
// the very first paint already carries the right [data-theme], no flash) and
// mirrored to localStorage. Switching updates <html data-theme> immediately so
// every token-based surface — including the sidebar — reskins live.
export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
      document.cookie = `${THEME_COOKIE_KEY}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
      try {
        window.localStorage.setItem(THEME_COOKIE_KEY, next);
      } catch {
        // localStorage can be unavailable (private mode); the cookie is the source of truth.
      }
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
