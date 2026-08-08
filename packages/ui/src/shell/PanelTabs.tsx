import type { ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";

export type EditorPanel = "library" | "timeline" | "mixer";

// One entry per panel that exists. The spec's phone bar also names effects, text and export --
// none of those exist yet, and a tab that opens nothing is worse than a tab that is not there.
// Each one joins this list on the day its panel does.
const TABS = [
  { id: "library", label: "library.label" },
  { id: "timeline", label: "timeline.label" },
  { id: "mixer", label: "panel.mixer" },
] as const satisfies readonly { id: EditorPanel; label: string }[];

export interface PanelTabsProps {
  panel: EditorPanel;
  onSelect: (panel: EditorPanel) => void;
}

export function PanelTabs({ panel, onSelect }: PanelTabsProps): ReactElement {
  const { t } = useI18n();

  return (
    <div className="v-panels" role="group" aria-label={t("panel.label")}>
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="v-panels__tab"
          aria-pressed={panel === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {t(tab.label)}
        </button>
      ))}
    </div>
  );
}
