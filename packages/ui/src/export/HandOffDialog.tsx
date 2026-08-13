import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "./HandOffDialog.css";

/** Everything that leaves this program as a file that is not a video. */
export type HandOffKind = "edl" | "fcpxml" | "xmeml" | "captions" | "audiola";

export interface HandOffDialogProps {
  /** Absent where a session cannot write it — no subtitles in the project, no sound to hand over. */
  available?: Partial<Record<HandOffKind, boolean>>;
  onChoose: (kind: HandOffKind) => void;
  onClose: () => void;
}

// The order somebody would work down: the two an editor opens, then the old one every system reads,
// then the two that are a part of the project rather than the cut.
const KINDS: readonly HandOffKind[] = ["fcpxml", "xmeml", "edl", "captions", "audiola"];

/**
 * Which file to hand the cut on in — as a question with the answers explained.
 *
 * These were five lines in a menu reading "Export EDL", "Export FCPXML", "Export Premiere XML". That
 * is a menu that assumes the reader already knows what an EDL is, and somebody who does not is left
 * guessing which of three XML-ish things their editor opens. So: one card per file, saying what it
 * is in a sentence, which program opens it, and — the part a menu can never say — what it does *not*
 * carry. None of these takes an effect, a grade or a keyframe with it, and finding that out after
 * conforming a reel is the expensive way.
 */
export function HandOffDialog({ available, onChoose, onClose }: HandOffDialogProps): ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="v-export__scrim">
      <div
        ref={panel}
        className="v-export v-handoff"
        role="dialog"
        aria-modal="true"
        aria-label={t("handOff.title")}
        tabIndex={-1}
        data-testid="hand-off"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 className="v-export__title">{t("handOff.title")}</h2>
        <p className="v-export__note">{t("handOff.intro")}</p>

        <ul className="v-handoff__list">
          {KINDS.map((kind) => {
            const usable = available?.[kind] !== false;
            return (
              <li key={kind}>
                <button
                  type="button"
                  className="v-handoff__card"
                  data-kind={kind}
                  disabled={!usable}
                  onClick={() => onChoose(kind)}
                >
                  <span className="v-handoff__name">
                    {t(`handOff.${kind}.name`)}
                    <span className="v-handoff__ext">{t(`handOff.${kind}.ext`)}</span>
                  </span>
                  <span className="v-handoff__what">{t(`handOff.${kind}.what`)}</span>
                  <span className="v-handoff__opens">
                    {usable ? t(`handOff.${kind}.opens`) : t(`handOff.${kind}.absent`)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="v-export__note">{t("handOff.carries")}</p>

        <div className="v-export__actions">
          <button type="button" className="v-button" onClick={onClose}>
            {t("handOff.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
