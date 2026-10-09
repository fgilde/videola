import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type { MediaAsset, MediaId } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { IconButton } from "../primitives/Icon";
import "../shell/UpdateOffer.css";
import { readStored, writeStored } from "../storage";
import { useDismiss } from "../useDismiss";
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
  "grow",
  "tree",
] as const;

/**
 * Which of the four knobs a style answers to.
 *
 * The same table the painter keeps, and it has to stay the same: a slider for a setting the style
 * ignores is worse than no slider. It is repeated rather than imported because this package draws
 * the dialogue and the other one draws the picture -- the engine is not a dependency here.
 */
const KNOBS: Record<string, readonly LyricKnob[]> = {
  kinetic: ["size", "intensity"],
  karaoke: ["size", "intensity"],
  typewriter: ["size", "intensity"],
  pop: ["size", "intensity"],
  neon: ["size", "intensity", "glow"],
  flip: ["size", "intensity"],
  bar: ["size", "intensity"],
  depth: ["size", "intensity", "tilt"],
  morph: ["size", "intensity"],
  wave: ["size", "intensity"],
  glitch: ["size", "intensity", "glow"],
  grow: ["size", "intensity", "glow", "tilt"],
  tree: ["size", "intensity", "glow"],
};

export type LyricKnob = "size" | "intensity" | "glow" | "tilt";

/** What each knob may be, and the step a slider moves it by. */
const RANGE: Record<LyricKnob, { low: number; high: number; step: number }> = {
  size: { low: 0.05, high: 0.3, step: 0.005 },
  intensity: { low: 0, high: 1, step: 0.05 },
  glow: { low: 0, high: 1, step: 0.05 },
  tilt: { low: 0, high: 1, step: 0.05 },
};

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
  /**
   * Whether the words are also burned in at the foot of the frame.
   *
   * The lines live on a caption row either way -- that row is what the lyric video reads to know
   * which line is being sung -- but a caption row taken out of the picture draws nothing. On, this
   * is a lyric video with subtitles; off, it is a lyric video.
   */
  subtitles: boolean;
  /** How big, how much movement, how much glow, how far it leans. Per style, and clamped there. */
  size: number;
  intensity: number;
  glow: number;
  tilt: number;
}

/** What a tile asks for when it wants a picture of a style. */
export interface PreviewRequest {
  canvas: HTMLCanvasElement;
  style: string;
  look: Omit<LyricsDraft, "media" | "style" | "withVisualizer" | "subtitles">;
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
  /**
   * Who can listen to the song and write the words down: `local` is Whisper in this browser and is
   * always there, `server` a transcriber on the server, `cloud` sends the song to ElevenLabs. One is
   * a button; more than one is a button with a menu that says where the song would go.
   */
  transcribers: readonly Transcriber[];
  /** How far a transcription has got, while one runs. */
  hearing?: Hearing;
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
  onTranscribe: (media: MediaId, transcriber: Transcriber, listen: ListenOptions) => void;
  onStopTranscribing: () => void;
  onText: (text: string) => void;
  /** The lines as they were corrected by hand: a word misheard, a line a moment early. */
  onLines: (found: FoundLyrics) => void;
  onCreate: (draft: LyricsDraft) => void;
  onClose: () => void;
}

export type Transcriber = "local" | "server" | "cloud";

/** How big a Whisper listens in the browser: the bigger, the more it hears, and the longer the download. */
export const WHISPER_SIZES = ["base", "small", "turbo"] as const;
export type WhisperSize = (typeof WHISPER_SIZES)[number];

/**
 * The language the song is sung in. Said rather than guessed, because Whisper left to guess takes most
 * songs for English -- and then translates them.
 */
export const LYRIC_LANGUAGES = ["de", "en", "fr", "es", "it", "nl", "pt", "pl", "tr", "sv"] as const;

export interface ListenOptions {
  language: string;
  size: WhisperSize;
}

const LISTEN_KEY = "videola.lyrics.listen";

export type Hearing =
  | { phase: "decoding" }
  | { phase: "loading"; fraction: number | undefined }
  | { phase: "listening"; fraction: number }
  | { phase: "sending" };

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
  const { t, locale } = useI18n();
  const [listen, setListen] = useState<ListenOptions>(() => remembered(locale));
  const chooseListen = (next: ListenOptions): void => {
    setListen(next);
    writeStored(LISTEN_KEY, JSON.stringify(next));
  };
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
    subtitles: true,
    size: 0.13,
    intensity: 0.6,
    glow: 0.5,
    tilt: 0.5,
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
    size: draft.size,
    intensity: draft.intensity,
    glow: draft.glow,
    tilt: draft.tilt,
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
              <Transcribe
                transcribers={props.transcribers}
                disabled={media === undefined || props.busy !== undefined}
                onTranscribe={(transcriber) =>
                  media !== undefined && props.onTranscribe(media, transcriber, listen)
                }
              />
            </div>
            <div className="v-lyrics__listen">
              <label className="v-dest__field">
                <span>{t("lyrics.language")}</span>
                <select
                  value={listen.language}
                  data-testid="lyrics-language"
                  onChange={(event) => chooseListen({ ...listen, language: event.target.value })}
                >
                  {LYRIC_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {languageName(locale, language)}
                    </option>
                  ))}
                </select>
              </label>
              {props.transcribers.includes("local") && (
                <label className="v-dest__field">
                  <span>{t("lyrics.size")}</span>
                  <select
                    value={listen.size}
                    data-testid="lyrics-size"
                    onChange={(event) => chooseListen({ ...listen, size: event.target.value as WhisperSize })}
                  >
                    {WHISPER_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {t(`lyrics.size.${size}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {props.busy === "transcribe" && props.hearing !== undefined && (
              <HearingProgress hearing={props.hearing} onStop={props.onStopTranscribing} />
            )}

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
                <LineEditor
                  lines={lines}
                  timed={props.found.timed}
                  onLines={(edited) => props.onLines({ ...props.found!, lines: edited })}
                />
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

            <div className="v-lyrics__settings">
              <div className="v-lyrics__colors" role="group" aria-label={t("lyrics.colors")}>
                {(["color", "accent", "background"] as const).map((field) => (
                  <label key={field} className="v-lyrics__swatch">
                    <input
                      type="color"
                      aria-label={t(`lyrics.${field}`)}
                      data-testid={`lyrics-${field}`}
                      value={draft[field]}
                      onChange={(event) => setDraft((held) => ({ ...held, [field]: event.target.value }))}
                    />
                    <span>{t(`lyrics.${field}`)}</span>
                  </label>
                ))}
              </div>

              <label className="v-lyrics__setting">
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

              {/* Only the knobs this style answers to. A slider that does nothing is a slider that
                  teaches somebody the settings do nothing. */}
              {(KNOBS[draft.style] ?? KNOBS.kinetic!).map((knob) => (
                <label className="v-lyrics__setting" key={knob}>
                  <span>{t(`lyrics.knob.${knob}`)}</span>
                  <input
                    type="range"
                    min={RANGE[knob].low}
                    max={RANGE[knob].high}
                    step={RANGE[knob].step}
                    value={draft[knob]}
                    data-testid={`lyrics-knob-${knob}`}
                    onChange={(event) =>
                      setDraft((held) => ({ ...held, [knob]: Number(event.target.value) }))
                    }
                  />
                </label>
              ))}

              <label className="v-lyrics__switch">
                <input
                  type="checkbox"
                  checked={draft.subtitles}
                  data-testid="lyrics-subtitles"
                  onChange={(event) =>
                    setDraft((held) => ({ ...held, subtitles: event.target.checked }))
                  }
                />
                <span>{t("lyrics.subtitles")}</span>
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
            </div>
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

function Transcribe({
  transcribers,
  disabled,
  onTranscribe,
}: {
  transcribers: readonly Transcriber[];
  disabled: boolean;
  onTranscribe: (transcriber: Transcriber) => void;
}): ReactElement {
  const { t } = useI18n();
  const menu = useRef<HTMLDetailsElement>(null);
  const close = useCallback(() => {
    if (menu.current !== null) menu.current.open = false;
  }, []);
  useDismiss(menu, close);
  const only = transcribers.length === 1 ? transcribers[0] : undefined;

  if (only !== undefined) {
    return (
      <button
        type="button"
        className="v-button"
        data-testid="lyrics-transcribe"
        data-engine={only}
        disabled={disabled}
        title={t(`lyrics.engine.${only}`)}
        onClick={() => onTranscribe(only)}
      >
        {t("lyrics.transcribe")}
      </button>
    );
  }
  return (
    <details className="v-lyrics__engines" ref={menu} data-testid="lyrics-transcribe">
      {/* A summary cannot be disabled; a closed menu that will not open is the same thing. */}
      <summary
        className="v-button"
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {t("lyrics.transcribe")} ▾
      </summary>
      <div className="v-lyrics__engineMenu" role="menu">
        {transcribers.map((transcriber) => (
          <button
            key={transcriber}
            type="button"
            role="menuitem"
            className="v-button"
            data-engine={transcriber}
            onClick={() => {
              close();
              onTranscribe(transcriber);
            }}
          >
            {t(`lyrics.engine.${transcriber}`)}
          </button>
        ))}
      </div>
    </details>
  );
}

function HearingProgress({ hearing, onStop }: { hearing: Hearing; onStop: () => void }): ReactElement {
  const { t } = useI18n();
  const fraction = "fraction" in hearing ? hearing.fraction : undefined;
  const percent = fraction === undefined ? undefined : Math.round(fraction * 100);
  return (
    <div className="v-lyrics__hearing" data-testid="lyrics-hearing" data-phase={hearing.phase}>
      <p className="v-export__note" aria-live="polite">
        {percent === undefined
          ? t(`lyrics.hearing.${hearing.phase}`)
          : t(`lyrics.hearing.${hearing.phase}At`, { percent })}
      </p>
      {/* Indeterminate where nobody can know how long it takes: a server that is listening says
          nothing until it is done, and a bar that made a number up would be lying. */}
      <progress className="v-update__bar" max={100} value={percent} />
      <div className="v-lyrics__ways">
        <button type="button" className="v-button" data-testid="lyrics-stop" onClick={onStop}>
          {t("lyrics.hearing.stop")}
        </button>
        <small className="v-export__note">{t("lyrics.hearing.kept")}</small>
      </div>
    </div>
  );
}

function remembered(locale: string): ListenOptions {
  try {
    const held = JSON.parse(readStored(LISTEN_KEY) ?? "{}") as Partial<ListenOptions>;
    return {
      language: LYRIC_LANGUAGES.includes(held.language as never) ? held.language! : locale,
      size: WHISPER_SIZES.includes(held.size as never) ? held.size! : "small",
    };
  } catch {
    return { language: locale, size: "small" };
  }
}

function languageName(locale: string, language: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

/**
 * The lines, open to correction: a misheard word, a line that comes in a moment early. Times are
 * typed the way they are read, `1:23.45`; one that does not read as a time goes back to what it was.
 */
function LineEditor({
  lines,
  timed,
  onLines,
}: {
  lines: readonly LyricLineDraft[];
  timed: boolean;
  onLines: (lines: LyricLineDraft[]) => void;
}): ReactElement {
  const { t } = useI18n();
  const change = (index: number, line: LyricLineDraft): void =>
    onLines(lines.map((held, at) => (at === index ? line : held)));
  const time = (index: number, field: "at" | "until", typed: string): void => {
    const ms = parseClock(typed);
    if (ms === undefined) return;
    change(index, { ...lines[index]!, [field]: ms });
  };
  const add = (): void => {
    const last = lines[lines.length - 1];
    const at = last === undefined ? 0 : (last.until ?? last.at) + 500;
    onLines([...lines, { at, until: at + 2000, text: "" }]);
  };

  return (
    <div className="v-lyrics__edit">
      <ol className="v-lyrics__lines" data-testid="lyrics-lines">
        {lines.map((line, index) => (
          <li key={index}>
            {timed && (
              <>
                <input
                  className="v-lyrics__at"
                  // Keyed by the value, so a time that did not parse snaps back to the one in force.
                  key={`at-${line.at}`}
                  defaultValue={clock(line.at)}
                  aria-label={t("lyrics.line.at", { line: index + 1 })}
                  onBlur={(event) => time(index, "at", event.target.value)}
                />
                <input
                  className="v-lyrics__at"
                  key={`until-${line.until ?? ""}`}
                  defaultValue={line.until === undefined ? "" : clock(line.until)}
                  aria-label={t("lyrics.line.until", { line: index + 1 })}
                  onBlur={(event) => time(index, "until", event.target.value)}
                />
              </>
            )}
            <input
              className="v-lyrics__text"
              value={line.text}
              aria-label={t("lyrics.line.text", { line: index + 1 })}
              onChange={(event) => change(index, { ...line, text: event.target.value })}
            />
            <IconButton
              icon="trash"
              label={t("lyrics.line.remove", { line: index + 1 })}
              onClick={() => onLines(lines.filter((_, at) => at !== index))}
            />
          </li>
        ))}
      </ol>
      <button type="button" className="v-button" data-testid="lyrics-add-line" onClick={add}>
        {t("lyrics.line.add")}
      </button>
    </div>
  );
}

function clock(ms: number): string {
  const hundredths = Math.round(ms / 10);
  const seconds = Math.floor(hundredths / 100);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** `1:23.45`, `83.45` or `83,45`, in milliseconds; anything else is not a time. */
export function parseClock(typed: string): number | undefined {
  const match = /^\s*(?:(\d+):)?(\d+(?:[.,]\d+)?)\s*$/.exec(typed);
  if (match === null) return undefined;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]!.replace(",", "."));
  return Math.round((minutes * 60 + seconds) * 1000);
}
