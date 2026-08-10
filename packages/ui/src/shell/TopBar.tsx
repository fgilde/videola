import { useRef, type ReactElement, type ReactNode } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon, IconButton } from "../primitives/Icon";
import { useDismiss } from "../useDismiss";
import { ASPECTS, INSERT_KINDS } from "@videola/core";

import type { InsertKind } from "@videola/core";

import type { LayoutPreference } from "../layout/detectLayoutMode";
import { SettingsMenu } from "./SettingsMenu";
import wordmark from "./videola-wordmark.png";

export interface TopBarActions {
  onAbout?: () => void;
  /** Write the cut out for another editor: an EDL or FCPXML. */
  onHandOff?: (kind: "edl" | "fcpxml") => void;
  /** Write the sound out as an `.audiola`, so the mix can be finished in Audiola. */
  onExportAudiola?: () => void;
  onKeys?: () => void;
  /** Where the browser build offers a desktop one. Absent in the desktop build itself. */
  getAppHref?: string;
  onNew?: () => void;
  /** Reframe the whole edit into another shape. The shapes themselves come from the core. */
  onReframe?: (aspect: string) => void;
  onTemplates?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onImportMedia?: () => void;
  onImportCaptions?: () => void;
  onExportCaptions?: () => void;
  onAddTrack?: () => void;
  /**
   * Put a title, a shape or a countdown on the timeline at the playhead. The text a fresh title
   * starts with comes from here rather than from the caller: this side of the app is the side that
   * has the catalogue, and a host outside the provider has no locale to write it in.
   */
  onInsert?: (kind: InsertKind, text: string) => void;
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
  /** Which layout is in force, and somewhere to change it. Absent where a host pinned one. */
  layout?: LayoutPreference;
  onLayout?: (next: LayoutPreference) => void;
}

export function TopBar({ compact = false, layout, onLayout, ...actions }: TopBarProps): ReactElement {
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
      {/* Beside the subtitles, because both are "write something out that is not a video". Two
          entries rather than a select: they are two file formats and not two answers to one
          question -- an EDL is what an old system conforms from, FCPXML is what a new one opens. */}
      <Action label={t("action.exportEdl")} onClick={() => actions.onHandOff?.("edl")} />
      <Action label={t("action.exportFcpxml")} onClick={() => actions.onHandOff?.("fcpxml")} />
      {/* Beside them, because it is the same kind of thing: an edit leaving for another tool. An
          `.audiola` is opened by dropping it on the window, so there is no entry for that. */}
      <Action label={t("action.exportAudiola")} onClick={actions.onExportAudiola} />
      <Action label={t("action.addTrack")} onClick={actions.onAddTrack} />
      {/* A select for the same reason the reframe below is one: five answers to "what shall I put
          down", and five buttons in a row would read as five unrelated actions. It resets to its
          label after every pick, because it names a thing to do and not a state the project is in. */}
      {actions.onInsert !== undefined && (
        <select
          className="v-topbar__reframe"
          aria-label={t("insert.label")}
          value=""
          onChange={(event) => {
            if (event.target.value !== "") {
              actions.onInsert?.(event.target.value as InsertKind, t("insert.newTitle"));
            }
          }}
        >
          <option value="">{t("insert.label")}</option>
          {INSERT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`insert.${kind}`)}
            </option>
          ))}
        </select>
      )}
      {/* A select and not four entries: they are four answers to one question, and a menu with
          "Hochkant 9:16" three rows under "Querformat 16:9" reads as four unrelated actions. */}
      {actions.onReframe !== undefined && (
        <select
          className="v-topbar__reframe"
          aria-label={t("reframe.label")}
          value=""
          onChange={(event) => {
            if (event.target.value !== "") actions.onReframe?.(event.target.value);
          }}
        >
          <option value="">{t("reframe.label")}</option>
          {ASPECTS.map((aspect) => (
            <option key={aspect.id} value={aspect.id}>
              {t(`reframe.${aspect.id}`)}
            </option>
          ))}
        </select>
      )}
      {/* Last in the menu, where an "about" belongs, and above the offer to fetch a build -- which
          is only here at all in a browser, where there is something to fetch. */}
      <Action label={t("action.keys")} onClick={actions.onKeys} />
      <Action label={t("about.label")} onClick={actions.onAbout} />
      {actions.getAppHref !== undefined && (
        <a className="v-button" href={actions.getAppHref} target="_blank" rel="noreferrer">
          {t("action.getApp")}
        </a>
      )}
    </>
  );
  // Three ranks in three lines: the export is something the project does, the two switches are
  // preferences, and saving is the one action the whole bar is arranged around.
  const output = (
    <>
      <Action label={t("action.export")} onClick={actions.onExport} />
      <SettingsMenu labelled={compact} layout={layout} onLayout={onLayout} />
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
