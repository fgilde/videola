import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type { Rate } from "@videola/core";

import { useI18n } from "../i18n/useI18n";

import "./ExportDialog.css";

export interface ExportFormatChoice {
  id: string;
  video: boolean;
  audio: boolean;
  /** Whether the container can carry a subtitle track of its own. Asked of the writer, not guessed. */
  subtitles?: boolean;
}

/** Mirrors `CaptionMode` in the engine. Named here so this package needs no dependency on it. */
export type ExportCaptionChoice = "burned" | "separate" | "none";

export type ExportRangeChoice = "project" | "selection";

export interface ExportSelection {
  formatId: string;
  width: number;
  height: number;
  fps: Rate;
  videoBitrate: number;
  audioBitrate: number;
  range: ExportRangeChoice;
  captions: ExportCaptionChoice;
}

export interface ExportProgress {
  done: number;
  total: number;
}

export interface ExportDialogProps {
  formats: readonly ExportFormatChoice[];
  settings: { width: number; height: number; fps: Rate };
  hasSelection: boolean;
  /** Whether the project has any captions at all. Without them the row is nothing to decide. */
  hasCaptions?: boolean;
  progress?: ExportProgress;
  error?: string;
  /**
   * Where the finished file can be sent, if a server holds any destinations. Empty in a browser with
   * no server behind it, and then the row is not drawn at all -- an offer that cannot be taken is
   * worse than no offer.
   */
  destinations?: readonly { id: string; name: string }[];
  publishTo?: string;
  onPublishTo?: (id: string) => void;
  onExport: (selection: ExportSelection) => void;
  onCancel: () => void;
  onClose: () => void;
}

const AUDIO_BITRATE = 128_000;

const CAPTION_CHOICES: readonly ExportCaptionChoice[] = ["burned", "separate", "none"];

// The rates an editor is handed, plus whatever the project itself runs at. Rationals throughout:
// 29.97 is not 30000/1001, and a file written from the decimal drifts a frame every half minute.
const STANDARD_RATES: readonly Rate[] = [
  { numerator: 24000, denominator: 1001 },
  { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 },
  { numerator: 30000, denominator: 1001 },
  { numerator: 30, denominator: 1 },
  { numerator: 50, denominator: 1 },
  { numerator: 60000, denominator: 1001 },
  { numerator: 60, denominator: 1 },
];

// ponytail: one constant for every codec and every kind of material. It puts 1080p30 at about
// 6 Mbit/s, which is right for ordinary footage and generous for a screen recording. A codec aware
// default -- VP9 needs roughly two thirds of what H.264 does for the same picture -- is worth
// having once there is more than one thing in the menu that people actually pick.
const BITS_PER_PIXEL = 0.1;

export function defaultBitrate(width: number, height: number, fps: Rate): number {
  const rate = fps.numerator / fps.denominator;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((width * height * rate * BITS_PER_PIXEL) / 1000) * 1000;
}


/**
 * The sizes people actually deliver, as one choice instead of three fields.
 *
 * Sizes and frame rates only. Not a bitrate: the suggestion below is computed from the size and the
 * rate, so a preset that carried one as well would be a second opinion about the same question — and
 * the one that is wrong is the one nobody recomputed after changing the size.
 *
 * The project's own frame rate wins wherever a preset does not insist. A preset that quietly moved a
 * 25 fps edit to 30 would drop or repeat a frame in five, which is not what "1080p" asked for.
 */
export interface ExportPreset {
  id: string;
  width: number;
  height: number;
  /** Only where the platform really wants one; otherwise the project's rate is kept. */
  fps?: Rate;
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  { id: "hd", width: 1920, height: 1080 },
  { id: "uhd", width: 3840, height: 2160 },
  { id: "hdReady", width: 1280, height: 720 },
  // The two shapes a phone delivers, both at the sizes the platforms serve back.
  { id: "vertical", width: 1080, height: 1920 },
  { id: "square", width: 1080, height: 1080 },
];

export function rateKey(rate: Rate): string {
  return `${rate.numerator}/${rate.denominator}`;
}

export function ExportDialog(props: ExportDialogProps): ReactElement {
  const { t, formatNumber } = useI18n();
  const usable = props.formats.filter((format) => format.video);
  const [formatId, setFormatId] = useState(usable[0]?.id ?? "");
  const [width, setWidth] = useState(props.settings.width);
  const [height, setHeight] = useState(props.settings.height);
  const [fpsKey, setFpsKey] = useState(rateKey(props.settings.fps));
  // Undefined means "whatever the size and rate imply". Once it holds a number the field is the
  // user's, and changing the resolution must not overwrite what they typed.
  const [bitrate, setBitrate] = useState<number>();
  const [range, setRange] = useState<ExportRangeChoice>("project");
  const [captions, setCaptions] = useState<ExportCaptionChoice>("burned");
  const ref = useRef<HTMLDivElement>(null);

  const rates = useMemo(() => withProjectRate(props.settings.fps), [props.settings.fps]);
  const fps = rates.find((rate) => rateKey(rate) === fpsKey) ?? props.settings.fps;
  const running = props.progress !== undefined;
  const chosen = usable.find((format) => format.id === formatId);
  const suggested = defaultBitrate(width, height, fps);
  // Escape leaves the dialog, but never abandons a run: cancelling an export is a decision, and
  // a key pressed to dismiss something is not one.
  useEscape(props.onClose, !running);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const start = (): void => {
    props.onExport({
      formatId,
      width,
      height,
      fps,
      videoBitrate: bitrate ?? suggested,
      audioBitrate: AUDIO_BITRATE,
      range,
      // A container that cannot carry a subtitle track must not be handed a request for one. The
      // radio is disabled as well, but a format changed after the choice was made would otherwise
      // start a run whose switch has nothing behind it.
      captions: captions === "separate" && chosen?.subtitles !== true ? "burned" : captions,
    });
  };

  return (
    <div className="v-export__scrim">
      <div
        ref={ref}
        className="v-export"
        role="dialog"
        aria-modal="true"
        aria-label={t("export.title")}
        tabIndex={-1}
      >
        <h2 className="v-export__title">{t("export.title")}</h2>

        {usable.length === 0 && <p className="v-export__note">{t("export.noEncoder")}</p>}
        {missesPreferred(props.formats) && <p className="v-export__note">{t("export.noH264")}</p>}
        {chosen?.audio === false && <p className="v-export__note">{t("export.noAudioCodec")}</p>}
        {props.error !== undefined && (
          <p className="v-export__note" role="alert">
            {t(props.error)}
          </p>
        )}

        <label className="v-export__row">
          {t("export.format")}
          <select
            value={formatId}
            disabled={running}
            onChange={(event) => setFormatId(event.target.value)}
          >
            {usable.map((format) => (
              <option key={format.id} value={format.id}>
                {t(`export.format.${format.id}`)}
              </option>
            ))}
          </select>
        </label>

        {/* Above the three fields it fills, because it is the short way to answer all of them. It
            resets to its own heading after a pick: it names a thing to do, not a state the export is
            in -- the fields below are the state, and they are what a person edits next. */}
        <label className="v-export__row">
          {t("export.preset")}
          <select
            aria-label={t("export.preset")}
            value=""
            disabled={running}
            onChange={(event) => {
              const preset = EXPORT_PRESETS.find((entry) => entry.id === event.target.value);
              if (preset === undefined) return;
              setWidth(preset.width);
              setHeight(preset.height);
              if (preset.fps !== undefined) setFpsKey(rateKey(preset.fps));
              // The bitrate goes back to being derived: a number left over from the previous size is
              // the one thing a preset cannot honestly keep.
              setBitrate(undefined);
            }}
          >
            <option value="">{t("export.preset")}</option>
            {EXPORT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {t(`export.preset.${preset.id}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="v-export__row">
          {t("export.width")}
          <input
            type="number"
            min={16}
            max={16384}
            value={width}
            disabled={running}
            onChange={(event) => setWidth(dimension(event.target.value, props.settings.width))}
          />
        </label>

        <label className="v-export__row">
          {t("export.height")}
          <input
            type="number"
            min={16}
            max={16384}
            value={height}
            disabled={running}
            onChange={(event) => setHeight(dimension(event.target.value, props.settings.height))}
          />
        </label>

        <label className="v-export__row">
          {t("export.fps")}
          <select value={fpsKey} disabled={running} onChange={(e) => setFpsKey(e.target.value)}>
            {rates.map((rate) => (
              <option key={rateKey(rate)} value={rateKey(rate)}>
                {formatNumber(Math.round((rate.numerator / rate.denominator) * 100) / 100)}
              </option>
            ))}
          </select>
        </label>

        <label className="v-export__row">
          {t("export.bitrate")}
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={Math.round((bitrate ?? suggested) / 100_000) / 10}
            disabled={running}
            onChange={(event) => setBitrate(megabits(event.target.value, suggested))}
          />
        </label>

        {props.hasCaptions === true && (
          <fieldset className="v-export__row" disabled={running}>
            <legend>{t("export.captions")}</legend>
            {CAPTION_CHOICES.map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name="v-export-captions"
                  value={choice}
                  checked={captions === choice}
                  // Offered only where the writer says it can be honoured. A radio that starts a
                  // run which quietly burns them in instead is worse than one that is greyed out.
                  disabled={choice === "separate" && chosen?.subtitles !== true}
                  onChange={() => setCaptions(choice)}
                />
                {t(`export.captions.${choice}`)}
              </label>
            ))}
            {chosen?.subtitles !== true && (
              <p className="v-export__note">{t("export.captions.unsupported")}</p>
            )}
          </fieldset>
        )}

        <fieldset className="v-export__row" disabled={running}>
          <legend>{t("export.range")}</legend>
          <label>
            <input
              type="radio"
              name="v-export-range"
              value="project"
              checked={range === "project"}
              onChange={() => setRange("project")}
            />
            {t("export.rangeProject")}
          </label>
          {props.hasSelection && (
            <label>
              <input
                type="radio"
                name="v-export-range"
                value="selection"
                checked={range === "selection"}
                onChange={() => setRange("selection")}
              />
              {t("export.rangeSelection")}
            </label>
          )}
        </fieldset>

        {props.progress !== undefined && (
          <p className="v-export__progress" role="status">
            {t("export.progress", { percent: percentOf(props.progress) })}
          </p>
        )}

        {props.destinations !== undefined && props.destinations.length > 0 && (
          <label className="v-export__row">
            <span>{t("export.destination")}</span>
            <select
              value={props.publishTo ?? ""}
              data-testid="export-destination"
              onChange={(event) => props.onPublishTo?.(event.target.value)}
            >
              {/* The first entry is the one the editor has always done, and it stays the default:
                  a video that is uploaded by accident cannot be taken back by an undo. */}
              <option value="">{t("export.destination.none")}</option>
              {props.destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="v-export__actions">
          {running ? (
            <button className="v-button" onClick={props.onCancel}>
              {t("export.cancel")}
            </button>
          ) : (
            <button className="v-button" onClick={props.onClose}>
              {t("export.close")}
            </button>
          )}
          <button
            className="v-button v-button--primary"
            disabled={running || chosen === undefined}
            onClick={start}
          >
            {t("export.start")}
          </button>
        </div>
      </div>
    </div>
  );
}

// Whole percent, and the last frame is a hundred rather than ninety-nine: the run is over when the
// count reaches the total, and a bar that stops just short of the end reads as a failure.
export function percentOf(progress: ExportProgress): number {
  if (progress.total <= 0) return 0;
  return Math.floor((100 * Math.min(progress.done, progress.total)) / progress.total);
}

// The preferred format is the first one offered. If the machine cannot encode it the menu still
// works, and the reason belongs on the screen rather than in a console.
function missesPreferred(formats: readonly ExportFormatChoice[]): boolean {
  return formats.length > 0 && formats[0]!.video === false && formats.some((f) => f.video);
}

function withProjectRate(fps: Rate): Rate[] {
  const known = new Set(STANDARD_RATES.map(rateKey));
  return known.has(rateKey(fps)) ? [...STANDARD_RATES] : [...STANDARD_RATES, fps];
}

function dimension(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 16) return fallback;
  // Every codec here samples chroma at half resolution in both directions, so an odd edge is
  // either refused outright or silently rounded by the encoder.
  return Math.min(16384, value - (value % 2));
}

function megabits(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value * 1_000_000);
}

function useEscape(onClose: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, enabled]);
}
