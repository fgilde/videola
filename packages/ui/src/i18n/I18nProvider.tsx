import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";

import { writeStored } from "../storage";
import { formatTimecode } from "./formatTimecode";
import { CATALOGS, LOCALE_KEY, readLocale } from "./say";
import { translate, type Vars } from "./translate";
import { I18nContext, type Locale } from "./useI18n";

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setStoredLocale] = useState<Locale>(readLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setStoredLocale(next);
    writeStored(LOCALE_KEY, next);
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
