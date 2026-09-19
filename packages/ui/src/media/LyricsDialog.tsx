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

export interface LyricsDialogProps {
  library: readonly MediaAsset[];
  found?: FoundLyrics;
  /** What is happening right now, for the two things that take a moment. */
  busy?: "file" | "transcribe";
  /** Whether the server behind this editor can transcribe at all. */
  canTranscribe?: boolean;
  error?: string;
  onLookInFile: (media: MediaId) => void;
  onTranscribe: (media: MediaId) => void;
  onText: (text: string) => void;
  onCreate: (draft: LyricsDraft) => void;
  onClose: () => void;
}

/**
 * A lyric video, in one dialogue.
 *
 * The order of the buttons is the order of the answers: the song usually already carries its own
 * words, so looking in the file comes first and costs nothing. An `.lrc` pasted in is second. Only
 * then is there a reason to send the audio to somebody else's machine to be listened to -- and that
 * button says so, because it is the only thing in this editor that leaves the building.
 */
export function LyricsDialog(props: LyricsDialogProps): ReactElement {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const songs = props.library.filter((asset) => asset.kind === "audio" || asset.kind === "video");
  const [media, setMedia] = useState<MediaId | undefined>(songs[0]?.id);
  const [typed, setTyped] = useState("");
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

        <section className="v-lyrics__block">
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
              rows={4}
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
        </section>

        {props.error !== undefined && (
          <p className="v-export__note" role="alert" data-testid="lyrics-error">
            {t(props.error)}
          </p>
        )}

        {props.found !== undefined && (
          <section className="v-lyrics__block">
            <h3 className="v-dest__heading">
              {t("lyrics.found", { count: lines.length, from: t(`lyrics.from.${props.found.from}`) })}
            </h3>
            {/* Whether the times came with the words decides what happens on the timeline, so it is
                said here rather than discovered afterwards. */}
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
          </section>
        )}

        <section className="v-lyrics__block">
          <h3 className="v-dest__heading">{t("lyrics.look")}</h3>
          <div className="v-lyrics__styles" role="group" aria-label={t("lyrics.style")}>
            {LYRIC_STYLE_NAMES.map((style) => (
              <button
                key={style}
                type="button"
                className="v-dest__kind"
                data-style={style}
                aria-pressed={draft.style === style}
                onClick={() => setDraft((held) => ({ ...held, style }))}
              >
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
              onChange={(event) => setDraft((held) => ({ ...held, background: event.target.value }))}
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
              onChange={(event) => setDraft((held) => ({ ...held, uppercase: event.target.checked }))}
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

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
