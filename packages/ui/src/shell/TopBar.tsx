import type { ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { SettingsMenu } from "./SettingsMenu";
import wordmark from "./videola-wordmark.png";

export interface TopBarActions {
  onNew?: () => void;
  onTemplates?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onImportMedia?: () => void;
  onAddTrack?: () => void;
  onExport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function TopBar(actions: TopBarActions): ReactElement {
  const { t } = useI18n();

  return (
    <header className="v-topbar">
      <img className="v-topbar__brand" src={wordmark} alt={t("app.title")} />
      <button className="v-button" onClick={actions.onNew} disabled={!actions.onNew}>
        {t("action.new")}
      </button>
      <button className="v-button" onClick={actions.onTemplates} disabled={!actions.onTemplates}>
        {t("action.templates")}
      </button>
      <button className="v-button" onClick={actions.onOpen} disabled={!actions.onOpen}>
        {t("action.open")}
      </button>
      <button
        className="v-button"
        onClick={actions.onImportMedia}
        disabled={!actions.onImportMedia}
      >
        {t("action.importMedia")}
      </button>
      <button className="v-button" onClick={actions.onAddTrack} disabled={!actions.onAddTrack}>
        {t("action.addTrack")}
      </button>
      <button className="v-button" onClick={actions.onUndo} disabled={actions.canUndo !== true}>
        {t("action.undo")}
      </button>
      <button className="v-button" onClick={actions.onRedo} disabled={actions.canRedo !== true}>
        {t("action.redo")}
      </button>
      <button className="v-button" onClick={actions.onExport} disabled={!actions.onExport}>
        {t("action.export")}
      </button>
      <span className="v-topbar__spacer" />
      <SettingsMenu />
      <button
        className="v-button v-button--primary"
        onClick={actions.onSave}
        disabled={!actions.onSave}
      >
        {t("action.save")}
      </button>
    </header>
  );
}
