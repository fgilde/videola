import { useEffect, useRef, useState, type DragEvent, type ReactElement } from "react";

import { Icon } from "../primitives/Icon";
import { useI18n } from "../i18n/useI18n";
import "./ImportDialog.css";

export interface FoundVideo {
  id: string;
  title: string;
  url: string;
  duration?: number;
  uploader?: string;
  thumbnail?: string;
}

export type FetchKind = "video" | "audio";

export interface FetchChoice {
  url: string;
  kind: FetchKind;
  /** `auto`, `h264`, `h265`, `av1` or `vp9`. Video only. */
  codec: string;
  /** `mp4` or `any` for video; `m4a`, `mp3`, `opus`, `wav`, `flac` for sound. */
  format: string;
  /** A height for video, `best` or `worst`; for sound a bitrate or `best`. */
  quality: string;
}

export interface ImportDialogProps {
  /** Undefined while the editor is still asking the server whether it can fetch at all. */
  canFetch?: boolean;
  /** Where to point somebody who has no server yet, shown with the set-up note. */
  serverHint?: string;
  results: readonly FoundVideo[];
  busy?: "searching" | "reading" | "fetching";
  percent?: number;
  error?: string;
  onFiles: (files: File[]) => void;
  onPick: () => void;
  onSearch: (query: string) => void;
  onRead: (url: string) => void;
  onFetch: (choice: FetchChoice) => void;
  onClose: () => void;
}

// The lists MeTube offers, because they are the ones people recognise from every other downloader --
// and because each of them is a `yt-dlp` selector this server already knows how to build.
const CODECS = ["auto", "h264", "h265", "av1", "vp9"] as const;
const VIDEO_FORMATS = ["any", "mp4"] as const;
const AUDIO_FORMATS = ["m4a", "mp3", "opus", "wav", "flac"] as const;
const HEIGHTS = ["best", "2160", "1440", "1080", "720", "480", "360", "240", "worst"] as const;
const BITRATES: Record<string, readonly string[]> = {
  m4a: ["best", "192", "128"],
  mp3: ["best", "320", "192", "128"],
  opus: ["best"],
  wav: ["best"],
  flac: ["best"],
};

/**
 * Getting material in, both ways, in one place.
 *
 * One dialogue rather than two menu entries: "where does this video come from" is a question with two
 * answers -- this machine, or a link -- and they belong side by side. A person who has a file drops
 * it on the left; a person who has a link pastes it on the right, or searches when they only
 * remember the title.
 *
 * The right-hand half works like MeTube, which is the tool people already know for this: a link, the
 * kind, the codec, the format and the quality, and then it downloads. It happens on a Videola server
 * because a page may not read another origin's video, and where there is no server this says so with
 * the command that starts one rather than with a sentence about a missing binary.
 */
export function ImportDialog(props: ImportDialogProps): ReactElement {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<FoundVideo>();
  const [kind, setKind] = useState<FetchKind>("video");
  const [codec, setCodec] = useState<string>("auto");
  const [format, setFormat] = useState<string>("any");
  const [quality, setQuality] = useState<string>("best");
  const [over, setOver] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  // A link is one video, so reading one is also choosing it. Asking somebody to click the single row
  // their own link produced is a step that says nothing.
  useEffect(() => {
    if (props.results.length === 1 && chosen === undefined) setChosen(props.results[0]);
  }, [props.results, chosen]);

  const formats = kind === "audio" ? AUDIO_FORMATS : VIDEO_FORMATS;
  const qualities = kind === "audio" ? (BITRATES[format] ?? ["best"]) : HEIGHTS;
  const ask = (): void => {
    const text = query.trim();
    if (text === "") return;
    setChosen(undefined);
    if (looksLikeLink(text)) props.onRead(text);
    else props.onSearch(text);
  };

  return (
    <div className="v-modal" role="dialog" aria-modal="true" aria-label={t("import.title")}>
      <div className="v-modal__panel v-import" data-testid="import-dialog">
        <h2 className="v-export__title">{t("import.title")}</h2>

        <div className="v-import__ways">
          <section className="v-import__way" aria-label={t("import.fromDisk")}>
            <h3 className="v-import__wayTitle">{t("import.fromDisk")}</h3>
            <div
              className="v-import__drop"
              data-over={over ? "" : undefined}
              data-testid="import-drop"
              onDragOver={(event: DragEvent) => {
                event.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                setOver(false);
                const files = [...event.dataTransfer.files];
                if (files.length > 0) props.onFiles(files);
              }}
            >
              <Icon name="plus" />
              <p className="v-import__dropHint">{t("import.dropHere")}</p>
              <button className="v-button v-button--primary" onClick={props.onPick}>
                {t("import.choose")}
              </button>
              <p className="v-import__kinds">{t("import.kinds")}</p>
            </div>
          </section>

          <section className="v-import__way v-import__way--net" aria-label={t("import.fromNet")}>
            <h3 className="v-import__wayTitle">{t("import.fromNet")}</h3>

            {props.canFetch === false ? (
              <div className="v-import__setup" data-testid="import-no-server">
                <p>{t("import.noServer")}</p>
                <pre className="v-import__command">{props.serverHint ?? DEFAULT_HINT}</pre>
                <p className="v-import__fine">{t("import.rights")}</p>
              </div>
            ) : (
              <>
                <div className="v-import__ask">
                  <input
                    ref={field}
                    className="v-input v-import__query"
                    type="text"
                    value={query}
                    placeholder={t("import.queryHint")}
                    aria-label={t("import.query")}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        ask();
                      }
                    }}
                  />
                  <button
                    className="v-button"
                    disabled={query.trim() === "" || props.busy !== undefined}
                    onClick={ask}
                  >
                    {looksLikeLink(query) ? t("import.read") : t("import.search")}
                  </button>
                </div>

                {props.busy === "searching" && (
                  <p className="v-export__note">{t("import.searching")}</p>
                )}
                {props.busy === "reading" && <p className="v-export__note">{t("import.reading")}</p>}

                {props.results.length > 0 && (
                  <ul className="v-import__results">
                    {props.results.map((found) => (
                      <li key={found.id}>
                        <button
                          type="button"
                          className="v-import__result"
                          data-video-id={found.id}
                          aria-pressed={chosen?.id === found.id}
                          onClick={() => setChosen(found)}
                        >
                          {/* Straight from the site it came from: a picture is what makes a list of
                              ten results readable, and a thumbnail is the one thing a browser may
                              load from another origin without asking anybody. */}
                          {found.thumbnail !== undefined && (
                            <img
                              className="v-import__thumb"
                              src={found.thumbnail}
                              alt=""
                              loading="lazy"
                            />
                          )}
                          <span className="v-import__meta">
                            <span className="v-import__resultTitle">{found.title}</span>
                            <span className="v-import__resultFacts">
                              {[found.uploader, spoken(found.duration)].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="v-import__options">
                  <label className="v-dest__field">
                    <span>{t("import.kind")}</span>
                    <select
                      value={kind}
                      aria-label={t("import.kind")}
                      onChange={(event) => {
                        const next = event.target.value as FetchKind;
                        setKind(next);
                        // The formats of one kind mean nothing to the other, and neither do the
                        // qualities: both fall back to that kind's first rather than staying on a
                        // word the tool would refuse.
                        setFormat(next === "audio" ? "m4a" : "any");
                        setQuality("best");
                      }}
                    >
                      <option value="video">{t("import.kind.video")}</option>
                      <option value="audio">{t("import.kind.audio")}</option>
                    </select>
                  </label>
                  {kind === "video" && (
                    <label className="v-dest__field">
                      <span>{t("import.codec")}</span>
                      <select
                        value={codec}
                        aria-label={t("import.codec")}
                        onChange={(event) => setCodec(event.target.value)}
                      >
                        {CODECS.map((one) => (
                          <option key={one} value={one}>
                            {t(`import.codec.${one}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="v-dest__field">
                    <span>{t("import.format")}</span>
                    <select
                      value={format}
                      aria-label={t("import.format")}
                      onChange={(event) => {
                        setFormat(event.target.value);
                        setQuality("best");
                      }}
                    >
                      {formats.map((one) => (
                        <option key={one} value={one}>
                          {t(`import.format.${one}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="v-dest__field">
                    <span>{t("import.quality")}</span>
                    <select
                      value={quality}
                      aria-label={t("import.quality")}
                      onChange={(event) => setQuality(event.target.value)}
                    >
                      {qualities.map((one) => (
                        <option key={one} value={one}>
                          {spokenQuality(one, kind, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {props.busy === "fetching" && props.percent !== undefined && (
                  <div
                    className="v-import__bar"
                    role="progressbar"
                    aria-valuenow={props.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t("import.fetching")}
                  >
                    <span className="v-import__barFill" style={{ width: `${props.percent}%` }} />
                  </div>
                )}

                <button
                  className="v-button v-button--primary v-import__fetch"
                  disabled={chosen === undefined || props.busy !== undefined}
                  onClick={() =>
                    chosen !== undefined &&
                    props.onFetch({ url: chosen.url, kind, codec, format, quality })
                  }
                >
                  {props.busy === "fetching"
                    ? props.percent === undefined
                      ? t("import.fetching")
                      : t("import.fetchingAt", { percent: String(props.percent) })
                    : t("import.fetch")}
                </button>
                <p className="v-import__fine">{t("import.rights")}</p>
              </>
            )}
          </section>
        </div>

        {props.error !== undefined && (
          <p className="v-import__error" role="alert">
            {props.error}
          </p>
        )}

        <div className="v-export__actions">
          <span className="v-templates__spacer" />
          <button className="v-button" onClick={props.onClose}>
            {t("import.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// What a person who has no server needs, which is a command rather than an explanation. The image
// carries `yt-dlp` and `ffmpeg`, so this one line is the whole of the set-up.
const DEFAULT_HINT = [
  "docker run -d -p 7331:7331 -v videola:/data \\",
  '  -e VIDEOLA_TOKEN="$(openssl rand -hex 24)" \\',
  "  ghcr.io/fgilde/videola:latest",
].join("\n");

/** Whether what somebody typed is a link to fetch or words to search for. */
export function looksLikeLink(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed) || /^[\w-]+\.[a-z]{2,}\//i.test(trimmed);
}

function spokenQuality(one: string, kind: FetchKind, t: (key: string) => string): string {
  if (one === "best") return t("import.quality.best");
  if (one === "worst") return t("import.quality.worst");
  return kind === "audio" ? `${one} kbps` : `${one}p`;
}

// Minutes and seconds, which is how long a video is said to be everywhere else.
function spoken(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const padded = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${padded(minutes)}:${padded(rest)}` : `${minutes}:${padded(rest)}`;
}
