import { useEffect, useRef, useState, type ReactElement } from "react";

import type { MediaAsset, MediaId } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import "./LyricsDialog.css";

/** One line, as the dialogue shows it: milliseconds, because that is what every lyric source uses. */
export interface LyricLineDraft {
  at: number;
  until?: number;
  text: string;
}

export interface FoundLyrics {
  lines: readonly LyricLineDraft[];
  /** Whether the source carried timings, or these are lines in order and nothing more. */
  timed: boolean;
  /** Where they came from, said out loud: people want to know before they trust the timings. */
  from: string;
}

export const LYRIC_STYLE_NAMES = [
  "kinetic",
  "karaoke",
  "typewriter",
  "pop",
  "neon",
  "flip",
  "bar",
  "depth",
  "morph",
  "wave",
  "glitch",
] as const;

export interface LyricsDraft {
  media?: MediaId;
  style: string;
  color: string;
  accent: string;
  background: string;
  position: "top" | "middle" | "bottom";
  uppercase: boolean;
  /** Whether a visualiser goes in behind them, which is what makes it a lyric *video*. */
  withVisualizer: boolean;
}

/** What a tile asks for when it wants a picture of a style. */
export interface PreviewRequest {
  canvas: HTMLCanvasElement;
  style: string;
  look: Omit<LyricsDraft, "media" | "style" | "withVisualizer">;
  /** How far through its line the sample is, 0 to 1. */
  progress: number;
  /** The words to draw, and the line before them for the styles that use one. */
  text: string;
  previous: string;
}

export interface LyricsDialogProps {
  library: readonly MediaAsset[];
  found?: FoundLyrics;
  /** What is happening right now, for the two things that take a moment. */
  busy?: "file" | "transcribe";
  /** Whether the server behind this editor can transcribe at all. */
  canTranscribe?: boolean;
  error?: string;
  /**
   * Paints one style onto one canvas.
   *
   * Handed in rather than imported: the renderer lives in the package that carries the decoders,
   * and a row of thumbnails is no reason to pull a demuxer into the editor's panel code. The
   * application owns both and wires them together in one line.
   */
  onPaintPreview?: (request: PreviewRequest) => void;
  onLookInFile: (media: MediaId) => void;
  onTranscribe: (media: MediaId) => void;
  onText: (text: string) => void;
  onCreate: (draft: LyricsDraft) => void;
  onClose: () => void;
}

/** What a preview sings, where the song has not been read yet. */
const SAMPLE = "Hall of fame";
const SAMPLE_BEFORE = "And the world";
const PREVIEW_SECONDS = 2.6;

/**
 * A lyric video, in one dialogue.
 *
 * Two columns, because there are two questions and they are not the same question: on the left,
 * where the words come from; on the right, what they look like. Stacked, the looks were below the
 * fold and nobody scrolled to them -- which made a feature about how a video looks feel like a
 * form about where a file is.
 *
 * The order of the buttons on the left is the order of the answers: the song usually already
 * carries its own words, so looking in the file comes first and costs nothing. An `.lrc` pasted in
 * is second. Only then is there a reason to send the audio to somebody else's machine to be
 * listened to -- and that button says so, because it is the one thing here that leaves the
 * building.
 */
export function LyricsDialog(props: LyricsDialogProps): ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const songs = props.library.filter((asset) => asset.kind === "audio" || asset.kind === "video");
  const [media, setMedia] = useState<MediaId | undefined>(songs[0]?.id);
  const [typed, setTyped] = useState("");
  const [hovered, setHovered] = useState<string>();
  const [draft, setDraft] = useState<Omit<LyricsDraft, "media">>({
    style: "kinetic",
    color: "#ffffff",
    accent: "#a048f8",
    background: "#050609",
    position: "middle",
    uppercase: false,
    withVisualizer: true,
  });

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const lines = props.found?.lines ?? [];
  const look = {
    color: draft.color,
    accent: draft.accent,
    background: draft.background,
    position: draft.position,
    uppercase: draft.uppercase,
  };

  return (
    <div className="v-export__scrim">
      <div
        ref={panel}
        className="v-export v-lyrics"
        role="dialog"
        aria-modal="true"
        aria-label={t("lyrics.title")}
        tabIndex={-1}
        data-testid="lyrics-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <h2 className="v-export__title">{t("lyrics.title")}</h2>
        <p className="v-export__note">{t("lyrics.intro")}</p>

        <div className="v-lyrics__columns">
          <section className="v-lyrics__block">
            <h3 className="v-dest__heading">{t("lyrics.words")}</h3>
            <label className="v-dest__field">
              <span>{t("lyrics.song")}</span>
              <select
                value={media ?? ""}
                data-testid="lyrics-song"
                onChange={(event) => setMedia(event.target.value as MediaId)}
              >
                {songs.length === 0 && <option value="">{t("lyrics.noSongs")}</option>}
                {songs.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.originalName}
                  </option>
                ))}
              </select>
            </label>

            <div className="v-lyrics__ways">
              <button
                type="button"
                className="v-button v-button--primary"
                data-testid="lyrics-from-file"
                disabled={media === undefined || props.busy !== undefined}
                onClick={() => media !== undefined && props.onLookInFile(media)}
              >
                {props.busy === "file" ? t("lyrics.looking") : t("lyrics.fromFile")}
              </button>
              {props.canTranscribe === true ? (
                <button
                  type="button"
                  className="v-button"
                  data-testid="lyrics-transcribe"
                  disabled={media === undefined || props.busy !== undefined}
                  onClick={() => media !== undefined && props.onTranscribe(media)}
                >
                  {props.busy === "transcribe" ? t("lyrics.transcribing") : t("lyrics.transcribe")}
                </button>
              ) : (
                <p className="v-export__note" data-testid="lyrics-no-transcriber">
                  {t("lyrics.noTranscriber")}
                </p>
              )}
            </div>

            <label className="v-dest__field v-lyrics__paste">
              <span>{t("lyrics.paste")}</span>
              <textarea
                rows={5}
                value={typed}
                placeholder={t("lyrics.pasteHint")}
                data-testid="lyrics-text"
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="v-button"
              data-testid="lyrics-take-text"
              disabled={typed.trim() === ""}
              onClick={() => props.onText(typed)}
            >
              {t("lyrics.takeText")}
            </button>

            {props.error !== undefined && (
              <p className="v-export__note" role="alert" data-testid="lyrics-error">
                {t(props.error)}
              </p>
            )}

            {props.found !== undefined && (
              <>
                <p className="v-lyrics__count">
                  {t("lyrics.found", {
                    count: lines.length,
                    from: t(`lyrics.from.${props.found.from}`),
                  })}
                </p>
                <p className="v-export__note">
                  {props.found.timed ? t("lyrics.timed") : t("lyrics.untimed")}
                </p>
                <ol className="v-lyrics__lines" data-testid="lyrics-lines">
                  {lines.slice(0, 40).map((line, index) => (
                    <li key={`${line.at}-${index}`}>
                      {props.found?.timed === true && (
                        <span className="v-lyrics__at">{clock(line.at)}</span>
                      )}
                      <span>{line.text}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>

          <section className="v-lyrics__block">
            <h3 className="v-dest__heading">{t("lyrics.look")}</h3>
            {/* Every style draws itself, in the colours that are set: a list of names says nothing
                about what "kinetic" or "letters travel" look like, and the only other way to find
                out is to make a video. Hovering one runs it. */}
            <div className="v-lyrics__styles" role="group" aria-label={t("lyrics.style")}>
              {LYRIC_STYLE_NAMES.map((style) => (
                <button
                  key={style}
                  type="button"
                  className="v-lyrics__style"
                  data-style={style}
                  aria-pressed={draft.style === style}
                  onPointerEnter={() => setHovered(style)}
                  onPointerLeave={() => setHovered((held) => (held === style ? undefined : held))}
                  onFocus={() => setHovered(style)}
                  onBlur={() => setHovered((held) => (held === style ? undefined : held))}
                  onClick={() => setDraft((held) => ({ ...held, style }))}
                >
                  <StylePreview
                    style={style}
                    look={look}
                    running={hovered === style}
                    onPaint={props.onPaintPreview}
                  />
                  <span>{t(`lyrics.style.${style}`)}</span>
                </button>
              ))}
            </div>

            <div className="v-param v-param--text">
              <span className="v-param__label">{t("lyrics.colors")}</span>
              <input
                type="color"
                aria-label={t("lyrics.color")}
                data-testid="lyrics-color"
                value={draft.color}
                onChange={(event) => setDraft((held) => ({ ...held, color: event.target.value }))}
              />
              <input
                type="color"
                aria-label={t("lyrics.accent")}
                data-testid="lyrics-accent"
                value={draft.accent}
                onChange={(event) => setDraft((held) => ({ ...held, accent: event.target.value }))}
              />
              <input
                type="color"
                aria-label={t("lyrics.background")}
                data-testid="lyrics-background"
                value={draft.background}
                onChange={(event) =>
                  setDraft((held) => ({ ...held, background: event.target.value }))
                }
              />
            </div>

            <label className="v-dest__field">
              <span>{t("lyrics.position")}</span>
              <select
                value={draft.position}
                onChange={(event) =>
                  setDraft((held) => ({
                    ...held,
                    position: event.target.value as LyricsDraft["position"],
                  }))
                }
              >
                <option value="top">{t("lyrics.position.top")}</option>
                <option value="middle">{t("lyrics.position.middle")}</option>
                <option value="bottom">{t("lyrics.position.bottom")}</option>
              </select>
            </label>

            <label className="v-lyrics__switch">
              <input
                type="checkbox"
                checked={draft.uppercase}
                onChange={(event) =>
                  setDraft((held) => ({ ...held, uppercase: event.target.checked }))
                }
              />
              <span>{t("lyrics.uppercase")}</span>
            </label>
            <label className="v-lyrics__switch">
              <input
                type="checkbox"
                checked={draft.withVisualizer}
                data-testid="lyrics-with-visualizer"
                onChange={(event) =>
                  setDraft((held) => ({ ...held, withVisualizer: event.target.checked }))
                }
              />
              <span>{t("lyrics.withVisualizer")}</span>
            </label>
          </section>
        </div>

        <div className="v-export__actions">
          <button
            type="button"
            className="v-button v-button--primary"
            data-testid="lyrics-create"
            disabled={lines.length === 0}
            onClick={() => props.onCreate({ ...draft, ...(media === undefined ? {} : { media }) })}
          >
            {t("lyrics.create")}
          </button>
          <span className="v-templates__spacer" />
          <button type="button" className="v-button" onClick={props.onClose}>
            {t("lyrics.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One style, drawn on a thumbnail.
 *
 * Still at a moment that shows what the style does, and running while the pointer is on it: two
 * and a half seconds of a line being sung, which is long enough for the letters to travel and
 * short enough that nobody waits for it. Only the hovered one animates -- eleven canvases on a
 * frame clock would be a dialogue that heats the room.
 */
function StylePreview({
  style,
  look,
  running,
  onPaint,
}: {
  style: string;
  look: PreviewRequest["look"];
  running: boolean;
  onPaint: LyricsDialogProps["onPaintPreview"];
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const surface = canvas.current;
    if (surface === null || onPaint === undefined) return;
    const paint = (progress: number): void =>
      onPaint({ canvas: surface, style, look, progress, text: SAMPLE, previous: SAMPLE_BEFORE });
    if (!running) {
      // Three quarters through: far enough that every style has shown its hand.
      paint(0.75);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number): void => {
      paint(((now - started) / 1000 / PREVIEW_SECONDS) % 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [style, look, running, onPaint]);

  return <canvas ref={canvas} className="v-lyrics__preview" width={192} height={108} />;
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
