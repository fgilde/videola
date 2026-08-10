import type { ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import type { LayoutPreference } from "../layout/detectLayoutMode";
import { Icon } from "../primitives/Icon";
import { useTheme } from "../theme/useTheme";

export interface SettingsMenuProps {
  /**
   * Inside the overflow menu, where every other entry is a word. A column of two lone symbols
   * between "Exportieren" and "Speichern" reads as a rendering fault.
   */
  labelled?: boolean;
  /** The layout that is in force, and somewhere to change it. Absent where a host pinned one. */
  layout?: LayoutPreference;
  onLayout?: (next: LayoutPreference) => void;
}

const LAYOUTS: readonly LayoutPreference[] = ["auto", "desktop", "tablet", "phone"];

export function SettingsMenu({
  labelled = false,
  layout,
  onLayout,
}: SettingsMenuProps): ReactElement {
  const { locale, setLocale, t } = useI18n();
  const { theme, setPreference } = useTheme();
  // Names the toggle action itself, not a translatable word, so it reads correctly in either
  // language without a catalogue entry.
  const localeLabel = "Deutsch / English";
  // This one names the target state, which is a translatable word.
  const themeLabel = theme === "dark" ? t("theme.light") : t("theme.dark");
  const className = labelled ? "v-button" : "v-button v-button--icon";

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={localeLabel}
        onClick={() => setLocale(locale === "de" ? "en" : "de")}
      >
        {labelled ? localeLabel : <span className="v-topbar__locale">{locale.toUpperCase()}</span>}
      </button>
      <button
        type="button"
        className={className}
        aria-label={themeLabel}
        onClick={() => setPreference(theme === "dark" ? "light" : "dark")}
      >
        {/* The symbol is the theme being switched *to*, so it says the same thing the label does. */}
        {labelled ? themeLabel : <Icon name={theme === "dark" ? "sun" : "moon"} />}
      </button>
      {/* Detection is right nearly always and wrong in the one case that matters: a wide screen whose
          browser reports no fine pointer gets the tablet layout, because `(any-pointer: fine)` is
          the only honest question a page can ask about what is being pointed with. A touchscreen
          laptop answers it correctly; so does a tablet with a mouse plugged in, in the other
          direction. Whoever disagrees has to be able to say so, and be remembered saying it. */}
      {onLayout !== undefined && layout !== undefined && (
        <select
          className="v-topbar__layout"
          aria-label={t("layout.label")}
          value={layout}
          onChange={(event) => onLayout(event.target.value as LayoutPreference)}
        >
          {LAYOUTS.map((mode) => (
            <option key={mode} value={mode}>
              {t(`layout.${mode}`)}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
