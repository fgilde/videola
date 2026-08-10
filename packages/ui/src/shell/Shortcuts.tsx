import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "./Shortcuts.css";

export interface ShortcutsProps {
  onClose: () => void;
}

/**
 * Which keys do what. One list, read from the two places that answer a key.
 *
 * Every row here is a key the editor really answers — `shortcut` in Timeline.tsx, `useTransportKeys`
 * in Transport.tsx and `commandKey` in useCommandKeys.ts are the whole roster, and a sheet that listed
 * a key nobody handles would be worse than no sheet: it would send somebody looking for a fault in
 * their keyboard.
 *
 * The modifier is written as `Strg/Cmd` rather than resolved per platform. A browser cannot ask which
 * one this keyboard has — `navigator.platform` guesses from the operating system, which is wrong on
 * a Mac with a PC keyboard and on Linux either way — and naming both is right on all of them.
 */
export function Shortcuts({ onClose }: ShortcutsProps): ReactElement {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const groups: readonly { title: string; rows: readonly [string, string][] }[] = [
    {
      title: t("keys.transport"),
      rows: [
        ["Space", t("keys.playPause")],
        ["J / K / L", t("keys.shuttle")],
        ["← / →", t("keys.step")],
        ["Shift + ← / →", t("keys.marker")],
      ],
    },
    {
      title: t("keys.project"),
      rows: [
        ["Strg/Cmd + Z", t("keys.undo")],
        ["Shift + Strg/Cmd + Z", t("keys.redo")],
        ["Strg/Cmd + S", t("keys.save")],
        ["Strg/Cmd + O", t("keys.open")],
        ["Strg/Cmd + E", t("keys.export")],
      ],
    },
    {
      title: t("keys.view"),
      rows: [
        ["+ / -", t("keys.zoom")],
        ["0", t("keys.zoomFit")],
        ["Home / End", t("keys.ends")],
      ],
    },
    {
      title: t("keys.editing"),
      rows: [
        ["S", t("keys.split")],
        ["Strg/Cmd + A", t("keys.selectAll")],
        ["Strg/Cmd + D", t("keys.duplicate")],
        ["Del / ⌫", t("keys.delete")],
        ["Shift + Del", t("keys.rippleDelete")],
        ["Strg/Cmd + C", t("keys.copy")],
        ["Strg/Cmd + X", t("keys.cut")],
        ["Strg/Cmd + V", t("keys.paste")],
        ["Strg/Cmd + G", t("keys.group")],
        ["Shift + Strg/Cmd + G", t("keys.ungroup")],
        ["N", t("keys.nest")],
        ["M", t("keys.markerAdd")],
      ],
    },
    {
      title: t("keys.curve"),
      rows: [["← ↑ → ↓", t("keys.handle")]],
    },
  ];

  return (
    <dialog className="v-keys" ref={ref} onClose={onClose} data-testid="shortcuts">
      <h2 className="v-keys__title">{t("keys.label")}</h2>
      {groups.map((group) => (
        <section key={group.title} className="v-keys__group">
          <h3 className="v-keys__heading">{group.title}</h3>
          <dl className="v-keys__list">
            {group.rows.map(([combination, what]) => (
              <div key={combination} className="v-keys__row">
                <dt>
                  <kbd>{combination}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {/* Said rather than left to be discovered: a key that only works while the timeline has the
          focus is a key somebody will report as broken. */}
      <p className="v-keys__note">{t("keys.focus")}</p>
      <button type="button" className="v-button v-keys__close" onClick={() => ref.current?.close()}>
        {t("about.close")}
      </button>
    </dialog>
  );
}
