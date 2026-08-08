import type { ReactElement } from "react";

import { timeToSeconds } from "@videola/core";

import type { MediaAsset, MediaId, Rate } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import "./MediaLibrary.css";

export interface MediaLibraryProps {
  library: readonly MediaAsset[];
  /** Entries with no bytes behind them. They can neither be drawn nor exported nor saved. */
  missing: ReadonlySet<MediaId>;
  /** The project's timebase, for media that carry no frame rate of their own. */
  fps: Rate;
  onImport: () => void;
  onAdd: (media: MediaId) => void;
  onRelink: (media: MediaId) => void;
}

// No thumbnail strip and no waveform: `@videola/media` has neither, and a grey rectangle where a
// picture belongs is a promise this application cannot keep. The list says what it knows.
export function MediaLibrary({
  library,
  missing,
  fps,
  onImport,
  onAdd,
  onRelink,
}: MediaLibraryProps): ReactElement {
  const { t } = useI18n();

  return (
    <section className="v-library" aria-label={t("library.label")} data-testid="library">
      <div className="v-library__toolbar">
        <button type="button" className="v-button" onClick={onImport}>
          {t("action.importMedia")}
        </button>
      </div>
      {library.length === 0 ? (
        <p className="v-library__empty">{t("library.empty")}</p>
      ) : (
        <ul className="v-library__list">
          {library.map((asset) => (
            <Entry
              key={asset.id}
              asset={asset}
              missing={missing.has(asset.id)}
              fps={fps}
              onAdd={onAdd}
              onRelink={onRelink}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Entry({
  asset,
  missing,
  fps,
  onAdd,
  onRelink,
}: {
  asset: MediaAsset;
  missing: boolean;
  fps: Rate;
  onAdd: (media: MediaId) => void;
  onRelink: (media: MediaId) => void;
}): ReactElement {
  const { t, formatTimecode } = useI18n();

  return (
    <li className="v-library__item" data-media-id={asset.id} data-missing={missing}>
      <span className="v-library__name" title={asset.originalName}>
        {asset.originalName}
      </span>
      <span className="v-library__facts">
        <span>{formatTimecode(timeToSeconds(asset.duration ?? 0), asset.fps ?? fps)}</span>
        {asset.width != null && asset.height != null && (
          <span>{`${asset.width} × ${asset.height}`}</span>
        )}
        {asset.sampleRate != null && <span>{`${asset.sampleRate} Hz`}</span>}
        {missing && <span className="v-library__missing">{t("library.missing")}</span>}
      </span>
      <span className="v-library__actions">
        <button
          type="button"
          className="v-button"
          disabled={missing}
          onClick={() => onAdd(asset.id)}
        >
          {t("library.addToTimeline")}
        </button>
        {missing && (
          <button type="button" className="v-button" onClick={() => onRelink(asset.id)}>
            {t("library.relink")}
          </button>
        )}
      </span>
    </li>
  );
}
