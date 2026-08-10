import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import wordmark from "./videola-wordmark.png";
import "./About.css";

export interface AboutProps {
  /** Stamped into every `.videola` this build writes, so it is the version to show. */
  version: string;
  /** Whether this is the desktop build. The browser gets the offer to fetch one. */
  desktop: boolean;
  onClose: () => void;
}

const SITE = "https://fgilde.github.io/videola/";
const REPO = "https://github.com/fgilde/videola";

/**
 * Who made this, under what licence, and where the rest of it lives.
 *
 * A native `<dialog>` and `showModal`: the browser already knows how to trap focus in one, close it
 * on Escape, and put it above everything without a stacking-order argument. A div with
 * `role="dialog"` would be a reimplementation of all three.
 */
export function About({ version, desktop, onClose }: AboutProps): ReactElement {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog className="v-about" ref={ref} onClose={onClose} data-testid="about">
      <img className="v-about__brand" src={wordmark} alt={t("app.title")} />
      <p className="v-about__version">{t("about.version", { version })}</p>
      <p className="v-about__what">{t("about.what")}</p>

      <ul className="v-about__links">
        <li>
          <a href={SITE} target="_blank" rel="noreferrer">
            {t("about.site")}
          </a>
        </li>
        <li>
          <a href={`${SITE}guide/getting-started`} target="_blank" rel="noreferrer">
            {t("about.docs")}
          </a>
        </li>
        <li>
          <a href={REPO} target="_blank" rel="noreferrer">
            {t("about.source")}
          </a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            {t("about.licence")}
          </a>
        </li>
      </ul>

      {/* Only where there is something to fetch. In the desktop build this would be an offer to
          install what is already running. */}
      {!desktop && (
        <a className="v-about__get v-button v-button--primary" href={`${SITE}download`} target="_blank" rel="noreferrer">
          {t("about.getApp")}
        </a>
      )}

      <p className="v-about__copyright">
        © 2026{" "}
        <a href="https://florian.gilde.org" target="_blank" rel="noreferrer">
          Florian Gilde
        </a>
        {" · "}
        <a href="https://www.gilde.org" target="_blank" rel="noreferrer">
          gilde.org
        </a>
      </p>

      <button type="button" className="v-button v-about__close" onClick={() => ref.current?.close()}>
        {t("about.close")}
      </button>
    </dialog>
  );
}
