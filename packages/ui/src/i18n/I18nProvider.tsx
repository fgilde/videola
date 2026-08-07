import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import { readStored, writeStored } from "../storage";
import de from "./catalogs/de.json";
import en from "./catalogs/en.json";
import { formatTimecode } from "./formatTimecode";
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
    writeStored(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => {
    const catalog = CATALOGS[locale];
    const defaultNumberFormat = new Intl.NumberFormat(locale);
    const formatNumber = (input: number) => defaultNumberFormat.format(input);
    return {
      locale,
      setLocale,
      t: (key: string, vars?: Vars) =>
        translate(catalog, key, vars, (n: number) => defaultNumberFormat.format(n)),
      formatNumber,
      formatTimecode,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function readLocale(): Locale {
  const stored = readStored(STORAGE_KEY);
  if (stored === "de" || stored === "en") {
    return stored;
  }
  // English is the fallback because the project's public face - README, release notes, docs
  // site - is English; German is what a German browser asks for, not what everyone else gets.
  return navigator.language.startsWith("de") ? "de" : "en";
}
