import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "./FetchDialog.css";

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
  format: string;
  quality: string;
}

export interface FetchDialogProps {
  /** Undefined while the editor is still asking the server whether it can fetch at all. */
  available?: boolean;
  results: readonly FoundVideo[];
  /** What is being asked of the server right now, so the dialogue can say which wait this is. */
  busy?: "searching" | "reading" | "fetching";
  error?: string;
  onSearch: (query: string) => void;
  onRead: (url: string) => void;
  onFetch: (choice: FetchChoice) => void;
  onClose: () => void;
}

const VIDEO_FORMATS = ["mp4", "any"] as const;
const AUDIO_FORMATS = ["m4a", "mp3", "opus", "wav", "flac"] as const;
const QUALITIES = ["best", "2160", "1440", "1080", "720", "480", "360"] as const;

/**
 * Material from a link, without leaving the editor.
 *
 * One field for both jobs: a link is fetched, anything else is searched for. That is how people
 * actually arrive here -- with a link somebody sent them, or with the name of a talk they gave --
 * and asking them to pick a mode first is a question about this program rather than about their
 * work.
 *
 * The download happens on a Videola server, because a page may not read another origin's video.
 * Where there is no server, or the server has no `yt-dlp`, this says so instead of offering
 * something that cannot happen.
 */
export function FetchDialog(props: FetchDialogProps): ReactElement {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<FoundVideo>();
  const [kind, setKind] = useState<FetchKind>("video");
  const [format, setFormat] = useState<string>("mp4");
  const [quality, setQuality] = useState<string>("best");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  // The one result of a link is the one somebody wanted: reading a link and then asking them to
  // click the single row it produced is a step that says nothing.
  useEffect(() => {
    if (props.results.length === 1 && chosen === undefined) setChosen(props.results[0]);
  }, [props.results, chosen]);

  const formats = kind === "audio" ? AUDIO_FORMATS : VIDEO_FORMATS;
  const ask = (): void => {
    const text = query.trim();
    if (text === "") return;
    setChosen(undefined);
    if (looksLikeLink(text)) props.onRead(text);
    else props.onSearch(text);
  };

  return (
    <div className="v-modal" role="dialog" aria-modal="true" aria-label={t("fetch.title")}>
      <div className="v-modal__panel v-fetch" data-testid="fetch-dialog">
        <h2 className="v-export__title">{t("fetch.title")}</h2>
        <p className="v-export__note">{t("fetch.intro")}</p>

        {props.available === false && (
          <p className="v-fetch__missing" data-testid="fetch-unavailable">
            {t("fetch.unavailable")}
          </p>
        )}

        <div className="v-fetch__ask">
          <input
            ref={field}
            className="v-input v-fetch__query"
            type="text"
            value={query}
            placeholder={t("fetch.queryHint")}
            aria-label={t("fetch.query")}
            disabled={props.available === false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                ask();
              }
            }}
          />
          <button
            className="v-button v-button--primary"
            disabled={props.available === false || query.trim() === "" || props.busy !== undefined}
            onClick={ask}
          >
            {looksLikeLink(query) ? t("fetch.read") : t("fetch.search")}
          </button>
        </div>

        {props.busy === "searching" && <p className="v-export__note">{t("fetch.searching")}</p>}
        {props.busy === "reading" && <p className="v-export__note">{t("fetch.reading")}</p>}
        {props.error !== undefined && (
          <p className="v-fetch__error" role="alert">
            {props.error}
          </p>
        )}

        {props.results.length > 0 && (
          <ul className="v-fetch__results">
            {props.results.map((found) => (
              <li key={found.id}>
                <button
                  type="button"
                  className="v-fetch__result"
                  data-video-id={found.id}
                  aria-pressed={chosen?.id === found.id}
                  onClick={() => setChosen(found)}
                >
                  {/* Straight from the site it came from: the picture is what makes a list of ten
                      results readable, and a thumbnail is the one thing a browser may load from
                      another origin without asking anybody. */}
                  {found.thumbnail !== undefined && (
                    <img className="v-fetch__thumb" src={found.thumbnail} alt="" loading="lazy" />
                  )}
                  <span className="v-fetch__meta">
                    <span className="v-fetch__resultTitle">{found.title}</span>
                    <span className="v-fetch__resultFacts">
                      {[found.uploader, spoken(found.duration)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {chosen !== undefined && (
          <div className="v-fetch__choice">
            <h3 className="v-dest__heading">{chosen.title}</h3>
            <div className="v-fetch__fields">
              <label className="v-dest__field">
                <span>{t("fetch.kind")}</span>
                <select
                  value={kind}
                  aria-label={t("fetch.kind")}
                  onChange={(event) => {
                    const next = event.target.value as FetchKind;
                    setKind(next);
                    // The formats of one kind mean nothing to the other, so the choice resets to
                    // that kind's first rather than staying on a word the tool would refuse.
                    setFormat(next === "audio" ? "m4a" : "mp4");
                  }}
                >
                  <option value="video">{t("fetch.kind.video")}</option>
                  <option value="audio">{t("fetch.kind.audio")}</option>
                </select>
              </label>
              <label className="v-dest__field">
                <span>{t("fetch.format")}</span>
                <select
                  value={format}
                  aria-label={t("fetch.format")}
                  onChange={(event) => setFormat(event.target.value)}
                >
                  {formats.map((one) => (
                    <option key={one} value={one}>
                      {t(`fetch.format.${one}`)}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "video" && (
                <label className="v-dest__field">
                  <span>{t("fetch.quality")}</span>
                  <select
                    value={quality}
                    aria-label={t("fetch.quality")}
                    onChange={(event) => setQuality(event.target.value)}
                  >
                    {QUALITIES.map((one) => (
                      <option key={one} value={one}>
                        {one === "best" ? t("fetch.quality.best") : `${one}p`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        <div className="v-export__actions">
          <button
            className="v-button v-button--primary"
            disabled={chosen === undefined || props.busy !== undefined}
            onClick={() =>
              chosen !== undefined &&
              props.onFetch({ url: chosen.url, kind, format, quality })
            }
          >
            {props.busy === "fetching" ? t("fetch.fetching") : t("fetch.add")}
          </button>
          <span className="v-templates__spacer" />
          <button className="v-button" onClick={props.onClose}>
            {t("fetch.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Whether what somebody typed is a link to fetch or words to search for. */
export function looksLikeLink(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed) || /^[\w-]+\.[a-z]{2,}\//i.test(trimmed);
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
