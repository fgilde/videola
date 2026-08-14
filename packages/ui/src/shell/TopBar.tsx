import { useRef, type ReactElement, type ReactNode } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon, IconButton } from "../primitives/Icon";
import { useDismiss } from "../useDismiss";
import { ASPECTS, INSERT_KINDS } from "@videola/core";

import type { InsertKind } from "@videola/core";

import type { LayoutPreference } from "../layout/detectLayoutMode";
import { SettingsMenu } from "./SettingsMenu";
import wordmark from "./videola-wordmark.png";

/** The three files a cut can leave in. Which one to reach for is the other editor's decision. */
export type HandOff = "edl" | "fcpxml" | "xmeml";

export interface TopBarActions {
  onAbout?: () => void;
  /** Open the dialogue that explains what each interchange file is before writing one. */
  onHandOff?: () => void;
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
   * constantly; everything else joins one menu, because six menu titles do not fit 390 px.
   */
  compact?: boolean;
  /**
   * A desktop, where the bar has room for the wordmark and the export button beside six menu titles.
   * A tablet has not: six titles are 450 px of German, and the bar has to fit 834 without pushing the
   * page wider than the window -- which is what it did, and what took the panels under it with it.
   */
  roomy?: boolean;
  /** Which layout is in force, and somewhere to change it. Absent where a host pinned one. */
  layout?: LayoutPreference;
  onLayout?: (next: LayoutPreference) => void;
}

/**
 * The bar, and the menus a person looks in.
 *
 * Six titles rather than one pile. Everything used to live behind a single overflow disclosure, and
 * a list of fifteen unrelated actions is a list nobody reads twice — "where is reframe" had no
 * answer except "somewhere in there". The names are the ones every editor on this planet uses, so
 * the answer to "where is import" is the answer somebody already knows.
 *
 * On a phone the same six become groups inside one disclosure, because six titles do not fit 390 px
 * at a thumb's width each. Same tree, same order, one level deeper.
 */
export function TopBar({
  compact = false,
  roomy = true,
  layout,
  onLayout,
  ...actions
}: TopBarProps): ReactElement {
  const { t } = useI18n();

  const menus: readonly { id: string; label: string; items: ReactNode }[] = [
    {
      id: "file",
      label: t("menu.file"),
      items: (
        <>
          <Action label={t("action.new")} onClick={actions.onNew} />
          <Action label={t("action.templates")} onClick={actions.onTemplates} />
          <Action label={t("action.open")} onClick={actions.onOpen} />
          <Action label={t("action.save")} onClick={actions.onSave} />
          <Rule />
          <Action label={t("action.importMedia")} onClick={actions.onImportMedia} />
          <Action label={t("action.importCaptions")} onClick={actions.onImportCaptions} />
          <Rule />
          {/* The two ways out, in the order they are wanted: a finished video, and the cut for
              somebody else to finish. What each interchange file is belongs in the dialogue rather
              than in three menu lines that assume the reader knows what an EDL is. */}
          <Action label={t("action.export")} onClick={actions.onExport} />
          <Action label={t("action.handOff")} onClick={actions.onHandOff} />
        </>
      ),
    },
    {
      id: "edit",
      label: t("menu.edit"),
      items: (
        <>
          <Action label={t("action.undo")} onClick={actions.canUndo === true ? actions.onUndo : undefined} />
          <Action label={t("action.redo")} onClick={actions.canRedo === true ? actions.onRedo : undefined} />
          <Rule />
          <Action label={t("action.addTrack")} onClick={actions.onAddTrack} />
        </>
      ),
    },
    {
      id: "insert",
      label: t("menu.insert"),
      items: (
        <>
          {INSERT_KINDS.map((kind) => (
            <Action
              key={kind}
              label={t(`insert.${kind}`)}
              onClick={
                actions.onInsert === undefined
                  ? undefined
                  : () => actions.onInsert?.(kind, t("insert.newTitle"))
              }
            />
          ))}
        </>
      ),
    },
    {
      id: "project",
      label: t("menu.project"),
      items: (
        <>
          {/* Grouped rather than four rows of their own: they are four answers to one question, and
              "Hochkant 9:16" three rows under "Querformat 16:9" reads as four unrelated actions. */}
          <Submenu label={t("reframe.label")}>
            {ASPECTS.map((aspect) => (
              <Action
                key={aspect.id}
                label={t(`reframe.${aspect.id}`)}
                onClick={
                  actions.onReframe === undefined ? undefined : () => actions.onReframe?.(aspect.id)
                }
              />
            ))}
          </Submenu>
        </>
      ),
    },
    {
      id: "view",
      label: t("menu.view"),
      items: <SettingsMenu labelled layout={layout} onLayout={onLayout} />,
    },
    {
      id: "help",
      label: t("menu.help"),
      items: (
        <>
          <Action label={t("action.keys")} onClick={actions.onKeys} />
          <Action label={t("about.label")} onClick={actions.onAbout} />
          {actions.getAppHref !== undefined && (
            <a className="v-button" href={actions.getAppHref} target="_blank" rel="noreferrer">
              {t("action.getApp")}
            </a>
          )}
        </>
      ),
    },
  ];

  return (
    <header className="v-topbar">
      {roomy && <img className="v-topbar__brand" src={wordmark} alt={t("app.title")} />}
      {compact ? (
        <Disclosure label={t("action.more")} icon>
          {menus.map((menu) => (
            <Submenu key={menu.id} label={menu.label}>
              {menu.items}
            </Submenu>
          ))}
        </Disclosure>
      ) : (
        <nav className="v-topbar__menus" aria-label={t("menu.label")}>
          {menus.map((menu) => (
            <Disclosure key={menu.id} label={menu.label} testId={`menu-${menu.id}`}>
              {menu.items}
            </Disclosure>
          ))}
        </nav>
      )}
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
      <span className="v-topbar__rule" aria-hidden="true" />
      {/* On the bar as well as in View, because it is the one preference somebody uses before they
          know where the menus are -- and two letters is the whole control. */}
      <LocaleSwitch />
      {/* The two the whole bar is arranged around, on it rather than in a menu: exporting is what
          the work is for, and saving is the one action nobody should have to look for. */}
      {roomy && <Action label={t("action.export")} onClick={actions.onExport} />}
      <Action label={t("action.save")} onClick={actions.onSave} primary />
    </header>
  );
}

/**
 * Two letters, and the language they are not. On the bar rather than only under View: somebody who
 * opened this in the wrong language is looking for exactly this control and cannot read the menu
 * titles to find it.
 */
function LocaleSwitch(): ReactElement {
  const { locale, setLocale } = useI18n();
  return (
    <button
      type="button"
      className="v-button v-topbar__lang"
      aria-label="Deutsch / English"
      data-testid="locale-switch"
      onClick={() => setLocale(locale === "de" ? "en" : "de")}
    >
      <span className="v-topbar__locale">{locale.toUpperCase()}</span>
    </button>
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

// A line between two ranks of a menu. `aria-hidden`, because a separator announced as one is noise
// in a list a screen reader is already reading top to bottom.
function Rule(): ReactElement {
  return <span className="v-topbar__sep" aria-hidden="true" />;
}

/**
 * A group of entries inside a menu, folded away behind its own label.
 *
 * These were selects, and a select inside a menu could not be used at all: the menu closes on any
 * click within it, so the click that opened the dropdown closed the menu under it. Hence the stopped
 * propagation here -- opening a group is not choosing an entry -- while the entries inside still
 * bubble and close the whole thing.
 *
 * Nested <details> rather than a hover-out flyout: the same disclosure one level down, so the open
 * state, the keyboard and the accessible name stay the browser's, and it works with a finger, where
 * there is nothing to hover with.
 */
function Submenu({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <details className="v-topbar__group">
      <summary className="v-button" onClick={(event) => event.stopPropagation()}>
        <span>{label}</span>
        <Icon name="chevronRight" />
      </summary>
      <div className="v-topbar__group-items">{children}</div>
    </details>
  );
}

// <details> already is a disclosure: it carries its own open state, its own keyboard handling and
// its own accessible name. A button plus useState plus aria-expanded would be a reimplementation
// of all three. Closing on a click inside is the one thing it does not do by itself, because the
// element cannot know that an item was chosen rather than a label read.
function Disclosure({
  label,
  children,
  icon = false,
  testId,
}: {
  label: string;
  children: ReactNode;
  icon?: boolean;
  testId?: string;
}): ReactElement {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = (): void => {
    if (ref.current !== null) ref.current.open = false;
  };
  useDismiss(ref, close);

  return (
    <details className="v-topbar__more" ref={ref} data-testid={testId}>
      <summary
        className={icon ? "v-button v-button--icon" : "v-button v-topbar__title"}
        aria-label={icon ? label : undefined}
      >
        {icon ? <Icon name="menu" /> : label}
      </summary>
      <div className="v-topbar__menu" onClick={close}>
        {children}
      </div>
    </details>
  );
}
