import { useRef, type ReactElement, type ReactNode } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon, IconButton } from "../primitives/Icon";
import { useDismiss } from "../useDismiss";
import { SettingsMenu } from "./SettingsMenu";
import wordmark from "./videola-wordmark.png";

export interface TopBarActions {
  onNew?: () => void;
  onTemplates?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onImportMedia?: () => void;
  onImportCaptions?: () => void;
  onExportCaptions?: () => void;
  onAddTrack?: () => void;
  onExport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export interface TopBarProps extends TopBarActions {
  /**
   * A phone. Undo and redo stay on the bar because they are the two a finger reaches for
   * constantly; everything else joins the menu, because ten controls do not fit 390 px at
   * 44 px each and a bar that scrolls sideways hides half of itself in its resting state.
   */
  compact?: boolean;
}

export function TopBar({ compact = false, ...actions }: TopBarProps): ReactElement {
  const { t } = useI18n();

  const project = (
    <>
      <Action label={t("action.new")} onClick={actions.onNew} />
      <Action label={t("action.templates")} onClick={actions.onTemplates} />
      <Action label={t("action.open")} onClick={actions.onOpen} />
      <Action label={t("action.importMedia")} onClick={actions.onImportMedia} />
      {/* Beside importing media, because both are "bring a file into this project". They live in
          the overflow rather than on the bar for the reason everything else does: ten controls do
          not fit a phone at 44 px each. */}
      <Action label={t("action.importCaptions")} onClick={actions.onImportCaptions} />
      <Action label={t("action.exportCaptions")} onClick={actions.onExportCaptions} />
      <Action label={t("action.addTrack")} onClick={actions.onAddTrack} />
    </>
  );
  // Three ranks in three lines: the export is something the project does, the two switches are
  // preferences, and saving is the one action the whole bar is arranged around.
  const output = (
    <>
      <Action label={t("action.export")} onClick={actions.onExport} />
      <SettingsMenu labelled={compact} />
      <Action label={t("action.save")} onClick={actions.onSave} primary />
    </>
  );

  return (
    <header className="v-topbar">
      {!compact && <img className="v-topbar__brand" src={wordmark} alt={t("app.title")} />}
      <Overflow label={t("action.more")}>
        {project}
        {compact && output}
      </Overflow>
      <span className="v-topbar__spacer" />
      <IconButton
        icon="undo"
        label={t("action.undo")}
        onClick={actions.onUndo}
        disabled={actions.canUndo !== true}
      />
      <IconButton
        icon="redo"
        label={t("action.redo")}
        onClick={actions.onRedo}
        disabled={actions.canRedo !== true}
      />
      {!compact && <span className="v-topbar__rule" aria-hidden="true" />}
      {!compact && output}
    </header>
  );
}

function Action({
  label,
  onClick,
  primary = false,
}: {
  label: string;
  onClick?: () => void;
  primary?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className={primary ? "v-button v-button--primary" : "v-button"}
      onClick={onClick}
      disabled={onClick === undefined}
    >
      {label}
    </button>
  );
}

// <details> already is a disclosure: it carries its own open state, its own keyboard handling and
// its own accessible name. A button plus useState plus aria-expanded would be a reimplementation
// of all three. Closing on a click inside is the one thing it does not do by itself, because the
// element cannot know that an item was chosen rather than a label read.
function Overflow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = (): void => {
    if (ref.current !== null) ref.current.open = false;
  };
  useDismiss(ref, close);

  return (
    <details className="v-topbar__more" ref={ref}>
      <summary className="v-button v-button--icon" aria-label={label}>
        <Icon name="menu" />
      </summary>
      <div className="v-topbar__menu" onClick={close}>
        {children}
      </div>
    </details>
  );
}
