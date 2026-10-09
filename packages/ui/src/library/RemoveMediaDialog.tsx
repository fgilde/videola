import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "../shell/About.css";
import "../shell/UpdateOffer.css";

export interface RemoveMediaDialogProps {
  name: string;
  /** How many clips stand on the timeline with this medium in them, and on which rows. */
  clips: number;
  tracks: readonly string[];
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Asked before a medium that is in use goes: the clips made from it go with it, and a gap in the
 * edit is not something anybody should find out about afterwards. Undo brings both back.
 */
export function RemoveMediaDialog({
  name,
  clips,
  tracks,
  onRemove,
  onClose,
}: RemoveMediaDialogProps): ReactElement {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog className="v-about v-update" ref={ref} onClose={onClose} data-testid="remove-media">
      <h2 className="v-update__title">{t("library.removeTitle", { name })}</h2>
      <p className="v-about__what">
        {t("library.removeInUse", { count: clips, tracks: tracks.join(", ") })}
      </p>
      <div className="v-update__actions">
        <button
          type="button"
          className="v-button v-button--primary"
          data-testid="remove-media-confirm"
          onClick={() => {
            onRemove();
            ref.current?.close();
          }}
        >
          {t("library.removeConfirm")}
        </button>
        <button type="button" className="v-button" onClick={() => ref.current?.close()}>
          {t("library.removeCancel")}
        </button>
      </div>
    </dialog>
  );
}
