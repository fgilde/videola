import type { ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";

export type EditorPanel = "library" | "timeline" | "inspector" | "mixer" | "scopes";

// One entry per panel that exists. The properties panel is what carries effects, keyframes,
// transitions and speed, and while it sat squeezed between the transport and this bar the phone was
// a viewer rather than an editor. Text and export from the spec's bar have no panel of their own;
// each joins this list on the day one exists, because a tab that opens nothing is worse than a tab
// that is not there.
const TABS = [
  { id: "library", label: "library.label" },
  { id: "timeline", label: "timeline.label" },
  { id: "inspector", label: "inspector.label" },
  { id: "mixer", label: "panel.mixer" },
  { id: "scopes", label: "scopes.label" },
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
