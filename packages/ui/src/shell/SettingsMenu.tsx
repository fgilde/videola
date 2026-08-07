import type { ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { useTheme } from "../theme/useTheme";

export function SettingsMenu(): ReactElement {
  const { locale, setLocale } = useI18n();
  const { theme, setPreference } = useTheme();

  return (
    <>
      {/* Both aria-labels name the toggle action itself, not its current state or a
          user-visible word, so they read correctly in either language without a
          catalogue entry. */}
      <button
        className="v-button"
        aria-label="Deutsch / English"
        onClick={() => setLocale(locale === "de" ? "en" : "de")}
      >
        {locale.toUpperCase()}
      </button>
      <button
        className="v-button"
        aria-label={theme === "dark" ? "Light" : "Dark"}
        onClick={() => setPreference(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "☾" : "☀"}
      </button>
    </>
  );
}
