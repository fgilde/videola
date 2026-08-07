import { createContext, useContext } from "react";

import type { Vars } from "./translate";

export type Locale = "de" | "en";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Vars) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatTimecode: (seconds: number, fps: number) => string;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value === undefined) {
    throw new Error("useI18n requires an I18nProvider");
  }
  return value;
}
