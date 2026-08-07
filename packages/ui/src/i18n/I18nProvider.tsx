import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import de from "./catalogs/de.json";
import en from "./catalogs/en.json";
import { translate, type Catalog, type Vars } from "./translate";
import { I18nContext, type Locale } from "./useI18n";

const STORAGE_KEY = "videola.locale";
const CATALOGS: Record<Locale, Catalog> = { de, en };

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setStoredLocale] = useState<Locale>(readLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setStoredLocale(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => {
    const catalog = CATALOGS[locale];
    return {
      locale,
      setLocale,
      t: (key: string, vars?: Vars) => translate(catalog, key, vars),
      formatNumber: (input: number, options?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat(locale, options).format(input),
      formatTimecode: (seconds: number) => formatTimecode(seconds),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function readLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "de" || stored === "en") {
    return stored;
  }
  return navigator.language.startsWith("en") ? "en" : "de";
}

function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const frames = Math.floor((seconds - total) * 100);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(rest)}.${pad(frames)}`;
}
