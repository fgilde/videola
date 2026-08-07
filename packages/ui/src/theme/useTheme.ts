import { createContext, useContext } from "react";

export type Theme = "dark" | "light";
export type ThemePreference = "system" | Theme;

export interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) {
    throw new Error("useTheme requires a ThemeProvider");
  }
  return value;
}
