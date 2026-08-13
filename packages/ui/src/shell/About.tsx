import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon } from "../primitives/Icon";
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
      <header className="v-about__head">
        <img className="v-about__brand" src={wordmark} alt={t("app.title")} />
        <span className="v-about__version">{t("about.version", { version })}</span>
      </header>

      <p className="v-about__what">{t("about.what")}</p>

      {/* Rows rather than a bare bulleted list: each of these is somewhere to go, and a row the whole
          width of the dialogue is a row a finger can hit. The chevron is what says so. */}
      <nav className="v-about__links">
        {[
          { href: SITE, label: t("about.site") },
          { href: `${SITE}guide/getting-started`, label: t("about.docs") },
          { href: REPO, label: t("about.source") },
          { href: `${REPO}/blob/main/LICENSE`, label: t("about.licence") },
        ].map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
            <span>{link.label}</span>
            <Icon name="chevronRight" />
          </a>
        ))}
      </nav>

      {/* Only where there is something to fetch. In the desktop build this would be an offer to
          install what is already running. */}
      {!desktop && (
        <a
          className="v-about__get v-button v-button--primary"
          href={`${SITE}download`}
          target="_blank"
          rel="noreferrer"
        >
          {t("about.getApp")}
        </a>
      )}

      <footer className="v-about__foot">
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
      </footer>
    </dialog>
  );
}
