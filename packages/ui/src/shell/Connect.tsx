import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { accentColour, loadWidgets, widgetAttributes } from "./connectWidgets";
import "../export/ExportDialog.css";
import "./Connect.css";

export type ConnectWidget = "contact" | "support";

export interface ConnectProps {
  widget: ConnectWidget;
  onClose: () => void;
}

/**
 * Writing to whoever made this, or supporting it: one of gilde.org's widgets, in a dialogue of its
 * own.
 *
 * One at a time rather than both in one panel. They are two different errands -- something is
 * wrong, or thank you -- and a panel that offers both at once makes each of them look like half of
 * something else. The about dialogue is where they are chosen between.
 *
 * Drawn in place, because the dialogue around it is already the dialogue a button would open. It
 * takes the accent the editor is wearing and the language it is being used in, so it reads as part
 * of the application rather than as a visitor.
 *
 * The script that defines the element is fetched when this opens and never before -- an editor
 * nobody has asked for a contact form makes no request to anybody.
 */
export function Connect({ widget, onClose }: ConnectProps): ReactElement {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadWidgets();
    ref.current?.showModal();
  }, []);

  const title = t(widget === "contact" ? "connect.contact" : "connect.support");

  /**
   * The element is built by hand rather than rendered.
   *
   * React sets a *property* on a custom element wherever the element has one, and a widget whose
   * `inline` is a read-only accessor then throws on the assignment -- which took the whole render
   * down. Built detached, given its attributes and only then put into the page, it is also upgraded
   * once, with everything it needs already on it, instead of being upgraded and then changed.
   */
  useEffect(() => {
    const host = slot.current;
    if (host === null) return undefined;
    const element = document.createElement(`gilde-${widget}`);
    const attributes = widgetAttributes({
      widget,
      inline: true,
      language: locale,
      accent: accentColour(),
      title,
    });
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.setAttribute("data-testid", `connect-${widget}`);
    element.textContent = title;
    host.append(element);
    return () => element.remove();
  }, [widget, locale, title]);

  return (
    <dialog className="v-export v-connect" ref={ref} onClose={onClose} data-testid="connect">
      <h2 className="v-export__title">{title}</h2>

      <div className="v-connect__widget" ref={slot} />

      <footer className="v-connect__foot">
        <span className="v-connect__note">{t("connect.note")}</span>
        <button type="button" className="v-button" onClick={() => ref.current?.close()}>
          {t("about.close")}
        </button>
      </footer>
    </dialog>
  );
}
