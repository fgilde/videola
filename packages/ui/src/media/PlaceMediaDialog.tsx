import { useEffect, useRef, useState, type ReactElement } from "react";

import { timeToSeconds, type MediaAsset, type MediaId, type Rate, type Time } from "@videola/core";

import { formatTimecode } from "../i18n/formatTimecode";
import { useI18n } from "../i18n/useI18n";
import "./PlaceMediaDialog.css";

export interface PlaceMediaDialogProps {
  /** What the project already holds. Nothing here is imported; this is a choice among those. */
  library: readonly MediaAsset[];
  thumbnails?: ReadonlyMap<MediaId, string>;
  /** The row and the instant the menu was opened at, for the sentence at the top. */
  trackName: string;
  at: Time;
  fps: Rate;
  onPlace: (media: MediaId) => void;
  onClose: () => void;
}

/**
 * Which medium goes here.
 *
 * The other half of "put a medium here", and the half a menu cannot do: a menu with eleven media in
 * it is a menu nobody reads. This is the library again, small, with the pictures that make a list of
 * files recognisable -- and it places rather than imports, which is why it lists what the project
 * holds instead of opening a file picker.
 */
export function PlaceMediaDialog(props: PlaceMediaDialogProps): ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const placeable = props.library.filter((asset) => asset.kind !== "lut");
  const [chosen, setChosen] = useState<MediaId | undefined>(placeable[0]?.id);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  return (
    <div className="v-export__scrim">
      <div
        ref={panel}
        className="v-export v-place"
        role="dialog"
        aria-modal="true"
        aria-label={t("place.title", { track: props.trackName })}
        tabIndex={-1}
        data-testid="place-media"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <h2 className="v-export__title">{t("place.title", { track: props.trackName })}</h2>
        <p className="v-export__note">
          {t("place.intro", { at: formatTimecode(timeToSeconds(props.at), props.fps) })}
        </p>

        {placeable.length === 0 ? (
          <p className="v-place__empty">{t("place.none")}</p>
        ) : (
          <ul className="v-place__list">
            {placeable.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  className="v-place__item"
                  data-media-id={asset.id}
                  aria-pressed={chosen === asset.id}
                  onClick={() => setChosen(asset.id)}
                  onDoubleClick={() => props.onPlace(asset.id)}
                >
                  {props.thumbnails?.get(asset.id) !== undefined && (
                    <img className="v-place__thumb" src={props.thumbnails.get(asset.id)} alt="" />
                  )}
                  <span className="v-place__meta">
                    <span className="v-place__name">{asset.originalName}</span>
                    <span className="v-place__facts">
                      {formatTimecode(timeToSeconds(asset.duration ?? 0), asset.fps ?? props.fps)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="v-export__actions">
          <button
            className="v-button v-button--primary"
            disabled={chosen === undefined}
            onClick={() => chosen !== undefined && props.onPlace(chosen)}
          >
            {t("place.put")}
          </button>
          <span className="v-templates__spacer" />
          <button className="v-button" onClick={props.onClose}>
            {t("place.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
