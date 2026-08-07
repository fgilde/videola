import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import { ThemeContext, type Theme, type ThemePreference } from "./useTheme";
import "./tokens.css";

const STORAGE_KEY = "videola.theme";

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [preference, setStoredPreference] = useState<ThemePreference>(readPreference);
  const theme = preference === "system" ? systemTheme() : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = useMemo(() => ({ theme, preference, setPreference }), [
    theme,
    preference,
    setPreference,
  ]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

function systemTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
