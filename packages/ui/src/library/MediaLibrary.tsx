import type { PointerEvent, ReactElement } from "react";

import { timeToSeconds } from "@videola/core";

import type { MediaAsset, MediaId, Rate } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { IconButton } from "../primitives/Icon";
import type { MediaGrab } from "../timeline/geometry";
import "./MediaLibrary.css";

/**
 * What has been done about a medium's proxy. Spelled out here rather than imported from the engine
 * so the panel keeps its one dependency on the core: it is two words, and the alternative is the
 * interface package knowing about decoders.
 */
export type MediaProxyState = "building" | "ready";

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
  /**
   * Which media have a proxy and which one is being given one right now. A medium that is not in
   * here has none and is not getting one, which is a perfectly ordinary state -- the preview then
   * decodes the original.
   */
  proxies?: ReadonlyMap<MediaId, MediaProxyState>;
  /** True while the preview is decoding originals rather than proxies. */
  useOriginals?: boolean;
  /** Offered only where there is something to switch: left out, the control is not drawn. */
  onUseOriginals?: (useOriginals: boolean) => void;
  onImport: () => void;
  /** Files chosen from the camera or the gallery. Only offered on a touch layout. */
  onCapture?: (files: File[]) => void;
  onAdd: (media: MediaId) => void;
  onRelink: (media: MediaId) => void;
  onGrab?: (grab: MediaGrab) => void;
  /** The medium a range is being marked in, so the entry can say which one that is. */
  armed?: MediaId;
  /** Take this medium to the source bar and mark a range in it. */
  onArm?: (media: MediaId) => void;
}

export function MediaLibrary({
  library,
  missing,
  fps,
  thumbnails,
  draggable = false,
  proxies,
  useOriginals = false,
  onUseOriginals,
  onImport,
  onCapture,
  onAdd,
  onRelink,
  onGrab,
  armed,
  onArm,
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
        {/* A proxy that nobody can switch off is a picture quality decided behind the person's
            back. Pressed means the preview is on the originals -- the state the button names is
            the state it is in, not the one it would go to, because the second reading is what
            makes a toggle ambiguous. */}
        {onUseOriginals !== undefined && (
          <button
            type="button"
            className="v-button v-library__proxies"
            aria-pressed={useOriginals}
            onClick={() => onUseOriginals(!useOriginals)}
          >
            {t("library.useOriginals")}
          </button>
        )}
      </div>
      {library.length === 0 ? (
        /* An empty library is the first screen of a first session, and a sentence is a poor answer to
           it. The same actions the toolbar carries, said again where somebody is actually looking --
           on a phone the toolbar is a row of small buttons above the fold of a panel behind a tab,
           and "drop a file here" is advice a phone cannot take. */
        <div className="v-library__blank">
          <p className="v-library__empty">{t("library.empty")}</p>
          <button type="button" className="v-button v-button--primary" onClick={onImport}>
            {t("action.importMedia")}
          </button>
          {onCapture !== undefined && (
            <>
              <Capture label={t("library.record")} capture onFiles={onCapture} primary />
              <Capture label={t("library.pickFromGallery")} onFiles={onCapture} primary />
            </>
          )}
        </div>
      ) : (
        <ul className="v-library__list">
          {library.map((asset) => (
            <Entry
              key={asset.id}
              asset={asset}
              missing={missing.has(asset.id)}
              fps={fps}
              thumbnail={thumbnails?.get(asset.id)}
              proxy={proxies?.get(asset.id)}
              draggable={draggable}
              armed={armed === asset.id}
              onAdd={onAdd}
              onRelink={onRelink}
              onGrab={onGrab}
              onArm={onArm}
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
  primary = false,
  onFiles,
}: {
  label: string;
  capture?: boolean;
  /** On the empty state, where these are the only thing to do and read as the offer they are. */
  primary?: boolean;
  onFiles: (files: File[]) => void;
}): ReactElement {
  return (
    <label
      className={
        primary
          ? "v-button v-button--primary v-library__capture"
          : "v-button v-library__capture"
      }
    >
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
  proxy,
  draggable,
  armed,
  onAdd,
  onRelink,
  onGrab,
  onArm,
}: {
  asset: MediaAsset;
  missing: boolean;
  fps: Rate;
  thumbnail: string | undefined;
  proxy: MediaProxyState | undefined;
  draggable: boolean;
  armed: boolean;
  onAdd: (media: MediaId) => void;
  onRelink: (media: MediaId) => void;
  onGrab: ((grab: MediaGrab) => void) | undefined;
  onArm: ((media: MediaId) => void) | undefined;
}): ReactElement {
  const { t, formatTimecode } = useI18n();
  // A lookup table is a library entry that is never a clip: it has no picture, no length and
  // nothing a track could show. Every control that would put it on the timeline is therefore
  // absent rather than disabled -- the same rule the inspector follows for a slider that would
  // move a number the renderer never reads.
  const placeable = asset.kind !== "lut";
  const grabbable = draggable && placeable && !missing && onGrab !== undefined;

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
      data-proxy={proxy ?? "none"}
      data-armed={armed}
      data-grabbable={grabbable}
      title={grabbable ? t("library.dragToTimeline") : undefined}
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
        {/* A table has no length, and a timecode of zero beside it would read as one that does. */}
        {placeable && (
          <span>{formatTimecode(timeToSeconds(asset.duration ?? 0), asset.fps ?? fps)}</span>
        )}
        {!placeable && <span>{t("library.lut")}</span>}
        {asset.width != null && asset.height != null && (
          <span>{`${asset.width} × ${asset.height}`}</span>
        )}
        {asset.sampleRate != null && <span>{`${asset.sampleRate} Hz`}</span>}
        {missing && <span className="v-library__missing">{t("library.missing")}</span>}
      </span>
      {/* A proxy is minutes of a fan spinning for a picture nobody asked for. Saying which medium
          is being worked on, and which one is already quick, is the difference between that and an
          unexplained load.

          Its own row, and one that is there whether or not there is anything to say: a queue
          working through a library would otherwise grow and shrink every entry it touched, and the
          list would jump under the pointer at every handover. Measured in the browser harness,
          which is where the wrap this used to cause was found. */}
      <span className="v-library__proxy" data-state={proxy ?? "none"}>
        {proxy === undefined
          ? ""
          : t(proxy === "building" ? "library.proxyBuilding" : "library.proxyReady")}
      </span>
      <span className="v-library__actions">
        {/* The button stays even where the drag works. A drag is not keyboard-operable, and it
            is the only way onto the timeline -- removing it would leave the panel unusable
            without a pointer. A symbol rather than a line of text: one per medium over the full
            width of the panel turned a list of five into a screen of scrolling. */}
        {placeable && (
          <IconButton
            icon="plus"
            label={t("library.addToTimeline")}
            disabled={missing}
            onClick={() => onAdd(asset.id)}
          />
        )}
        {/* The other way onto the timeline, and the one classical cutting is built on: mark a
            range in this medium and insert or overwrite with it, rather than dropping the whole
            of it at the end. Pressed rather than gone while it is armed, so the entry the source
            bar is showing can be read off the list. */}
        {onArm !== undefined && placeable && (
          <IconButton
            icon="scissors"
            label={t("library.markRange")}
            pressed={armed}
            disabled={missing}
            onClick={() => onArm(asset.id)}
          />
        )}
        {missing && (
          <IconButton
            icon="link"
            label={t("library.relink")}
            onClick={() => onRelink(asset.id)}
          />
        )}
      </span>
    </li>
  );
}
