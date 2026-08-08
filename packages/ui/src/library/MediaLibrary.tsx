import type { PointerEvent, ReactElement } from "react";

import { timeToSeconds } from "@videola/core";

import type { MediaAsset, MediaId, Rate } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import type { MediaGrab } from "../timeline/geometry";
import "./MediaLibrary.css";

export interface MediaLibraryProps {
  library: readonly MediaAsset[];
  /** Entries with no bytes behind them. They can neither be drawn nor exported nor saved. */
  missing: ReadonlySet<MediaId>;
  /** The project's timebase, for media that carry no frame rate of their own. */
  fps: Rate;
  /**
   * One still per medium, as an object URL. An entry that is not in here shows no picture at all
   * rather than a placeholder: a grey rectangle where a frame belongs is a promise without cover.
   */
  thumbnails?: ReadonlyMap<MediaId, string>;
  /**
   * True where the library and the timeline are on screen together, which is the only place a drag
   * between them can happen. On a phone they take turns behind a tab bar, so there the button is
   * the whole story.
   */
  draggable?: boolean;
  onImport: () => void;
  /** Files chosen from the camera or the gallery. Only offered on a touch layout. */
  onCapture?: (files: File[]) => void;
  onAdd: (media: MediaId) => void;
  onRelink: (media: MediaId) => void;
  onGrab?: (grab: MediaGrab) => void;
}

export function MediaLibrary({
  library,
  missing,
  fps,
  thumbnails,
  draggable = false,
  onImport,
  onCapture,
  onAdd,
  onRelink,
  onGrab,
}: MediaLibraryProps): ReactElement {
  const { t } = useI18n();

  return (
    <section className="v-library" aria-label={t("library.label")} data-testid="library">
      <div className="v-library__toolbar">
        <button type="button" className="v-button" onClick={onImport}>
          {t("action.importMedia")}
        </button>
        {onCapture !== undefined && (
          <>
            {/* The native picker is the whole feature: `capture` is what asks a phone for its
                camera rather than its file system, and no scripted input can do that. A label
                wrapping the input is what makes it a control a thumb can hit. */}
            <Capture label={t("library.record")} capture onFiles={onCapture} />
            <Capture label={t("library.pickFromGallery")} onFiles={onCapture} />
          </>
        )}
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
              thumbnail={thumbnails?.get(asset.id)}
              draggable={draggable}
              onAdd={onAdd}
              onRelink={onRelink}
              onGrab={onGrab}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Capture({
  label,
  capture = false,
  onFiles,
}: {
  label: string;
  capture?: boolean;
  onFiles: (files: File[]) => void;
}): ReactElement {
  return (
    <label className="v-button v-library__capture">
      {label}
      <input
        type="file"
        accept="video/*"
        multiple={!capture}
        // The environment-facing camera: a phone shooting footage for an edit is pointed away
        // from its owner. An attribute a browser does not understand is simply ignored, which
        // leaves an ordinary file picker.
        {...(capture ? { capture: "environment" } : {})}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Same input reused for a second take of the same file name, which fires no change
          // event unless the value is cleared.
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}

function Entry({
  asset,
  missing,
  fps,
  thumbnail,
  draggable,
  onAdd,
  onRelink,
  onGrab,
}: {
  asset: MediaAsset;
  missing: boolean;
  fps: Rate;
  thumbnail: string | undefined;
  draggable: boolean;
  onAdd: (media: MediaId) => void;
  onRelink: (media: MediaId) => void;
  onGrab: ((grab: MediaGrab) => void) | undefined;
}): ReactElement {
  const { t, formatTimecode } = useI18n();
  const grabbable = draggable && !missing && onGrab !== undefined;

  // Only which medium is under the pointer is reported. Whether that becomes a drop, on which
  // track and at which instant, is the timeline's decision -- all three are its geometry, and one
  // gesture judged in one place cannot disagree with itself.
  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (!grabbable || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, label") !== null) return;
    onGrab?.(asset.id);
  };

  return (
    <li
      className="v-library__item"
      data-media-id={asset.id}
      data-missing={missing}
      data-grabbable={grabbable}
      onPointerDown={onPointerDown}
    >
      {thumbnail !== undefined && (
        <img
          className="v-library__thumb"
          src={thumbnail}
          alt={t("library.thumbnail", { name: asset.originalName })}
          draggable={false}
        />
      )}
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
        {/* The button stays even where the drag works. A drag is not keyboard-operable, and it
            is the only way onto the timeline -- removing it would leave the panel unusable
            without a pointer. */}
        <button
          type="button"
          className="v-button"
          disabled={missing}
          title={grabbable ? t("library.dragToTimeline") : undefined}
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
