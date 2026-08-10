import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "./About.css";
import "./UpdateOffer.css";

export interface UpdateOfferProps {
  version: string;
  /** Reports how far the download has got, or `undefined` where the host cannot know. */
  install: (onProgress: (fraction: number | undefined) => void) => Promise<void>;
  onClose: () => void;
}

/**
 * A newer desktop version, offered.
 *
 * In the editor's own dialogue rather than in `window.confirm`, and not only for looks: a confirm box
 * blocks the whole page while it is up, cannot say how far a download has got, and is the one thing
 * on screen that is neither translated by the catalogue nor themed. A download of a hundred megabytes
 * behind a modal that says nothing is a program somebody force-quits.
 */
export function UpdateOffer({ version, install, onClose }: UpdateOfferProps): ReactElement {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<"offered" | "installing" | "done" | "failed">("offered");
  const [fraction, setFraction] = useState<number | undefined>(undefined);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const start = (): void => {
    setState("installing");
    install(setFraction).then(
      () => setState("done"),
      () => setState("failed"),
    );
  };

  const percent = fraction === undefined ? undefined : Math.round(fraction * 100);

  return (
    <dialog className="v-about v-update" ref={ref} onClose={onClose} data-testid="update-offer">
      <h2 className="v-update__title">{t("update.title", { version })}</h2>

      {state === "offered" && <p className="v-about__what">{t("update.offer")}</p>}
      {state === "installing" && (
        <>
          <p className="v-about__what">
            {percent === undefined ? t("update.downloading") : t("update.downloadingAt", { percent })}
          </p>
          {/* Determinate where the host reports a total and indeterminate where it does not. A bar
              that invented a number would be a bar that lies about how long this takes. */}
          <progress className="v-update__bar" max={100} value={percent} />
        </>
      )}
      {state === "done" && <p className="v-about__what">{t("update.installed")}</p>}
      {state === "failed" && <p className="v-update__failed">{t("update.failed")}</p>}

      <div className="v-update__actions">
        {state === "offered" && (
          <button type="button" className="v-button v-button--primary" onClick={start}>
            {t("update.install")}
          </button>
        )}
        <button
          type="button"
          className="v-button"
          // Not while it is downloading: closing would leave the download running with nothing on
          // screen to say so, and the next check would start it over.
          disabled={state === "installing"}
          onClick={() => ref.current?.close()}
        >
          {state === "offered" ? t("update.later") : t("about.close")}
        </button>
      </div>
    </dialog>
  );
}
