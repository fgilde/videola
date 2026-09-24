import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { Icon, type IconName } from "../primitives/Icon";
import { GildeMark } from "./GildeMark";
import wordmark from "./videola-wordmark.png";
import "./About.css";

export interface AboutProps {
  /** Stamped into every `.videola` this build writes, so it is the version to show. */
  version: string;
  /** Whether this is the desktop build. The browser gets the offer to fetch one. */
  desktop: boolean;
  /** Writing to whoever made this, and supporting it. Each opens a dialogue of its own. */
  onContact?: () => void;
  onSupport?: () => void;
  onClose: () => void;
}

const SITE = "https://videola.app/";
const REPO = "https://github.com/fgilde/videola";

const LINKS: { key: string; href: string; icon: IconName }[] = [
  { key: "about.site", href: SITE, icon: "globe" },
  { key: "about.docs", href: `${SITE}guide/getting-started`, icon: "book" },
  { key: "about.source", href: REPO, icon: "code" },
  { key: "about.licence", href: `${REPO}/blob/main/LICENSE`, icon: "scale" },
];

/**
 * Who made this, how to reach them, and where the rest of it lives.
 *
 * The one page in the editor that is not about the work in hand, so it is arranged the way a colophon
 * is: the mark, the build, one sentence, then the two things somebody might want from a person --
 * writing to us, or supporting the work -- and only then the four places to go.
 *
 * A native `<dialog>` and `showModal`: the browser already knows how to trap focus in one, close it
 * on Escape, and put it above everything without a stacking-order argument. A div with
 * `role="dialog"` would be a reimplementation of all three.
 */
export function About({ version, desktop, onContact, onSupport, onClose }: AboutProps): ReactElement {
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

      {/* The two that lead to a person rather than to a page. Side by side and before the links,
          because a colophon nobody can answer back to is a page of addresses. */}
      <div className="v-about__reach">
        <button
          type="button"
          className="v-button v-about__reachButton"
          data-testid="about-contact"
          onClick={onContact}
        >
          <Icon name="mail" />
          {t("connect.contact")}
        </button>
        <button
          type="button"
          className="v-button v-about__reachButton v-about__reachButton--support"
          data-testid="about-support"
          onClick={onSupport}
        >
          <Icon name="heart" />
          {t("connect.support")}
        </button>
      </div>

      {/* Rows rather than a bare bulleted list: each of these is somewhere to go, and a row the whole
          width of the dialogue is a row a finger can hit. The mark says which kind of place it is. */}
      <nav className="v-about__links">
        {LINKS.map((link) => (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
            <Icon name={link.icon} />
            <span>{t(link.key)}</span>
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
        <a className="v-about__gilde" href="https://www.gilde.org" target="_blank" rel="noreferrer">
          <GildeMark />
          <span>gilde.org</span>
        </a>
        <p className="v-about__copyright">
          © 2026{" "}
          <a href="https://florian.gilde.org" target="_blank" rel="noreferrer">
            Florian Gilde
          </a>
        </p>
        <button type="button" className="v-button v-about__close" onClick={() => ref.current?.close()}>
          {t("about.close")}
        </button>
      </footer>
    </dialog>
  );
}
