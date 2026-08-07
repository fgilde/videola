import type { ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { useTheme } from "../theme/useTheme";

export function SettingsMenu(): ReactElement {
  const { locale, setLocale, t } = useI18n();
  const { theme, setPreference } = useTheme();

  return (
    <>
      {/* Names the toggle action itself, not a translatable word, so it reads correctly
          in either language without a catalogue entry. */}
      <button
        className="v-button"
        aria-label="Deutsch / English"
        onClick={() => setLocale(locale === "de" ? "en" : "de")}
      >
        {locale.toUpperCase()}
      </button>
      {/* This one names the target state, which is a translatable word - unlike the
          label above, it belongs in the catalogue. */}
      <button
        className="v-button"
        aria-label={theme === "dark" ? t("theme.light") : t("theme.dark")}
        onClick={() => setPreference(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "☾" : "☀"}
      </button>
    </>
  );
}
