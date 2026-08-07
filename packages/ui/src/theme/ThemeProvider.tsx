import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

import { clearStored, readStored, writeStored } from "../storage";
import { ThemeContext, type Theme, type ThemePreference } from "./useTheme";
import "./tokens.css";
import "./global.css";

const STORAGE_KEY = "videola.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [preference, setStoredPreference] = useState<ThemePreference>(readPreference);
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, getSystemTheme);
  const theme = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next);
    if (next === "system") {
      clearStored(STORAGE_KEY);
    } else {
      writeStored(STORAGE_KEY, next);
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
  const stored = readStored(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

function getSystemTheme(): Theme {
  return matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
