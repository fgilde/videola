import { useId, useRef, type ReactElement } from "react";

import { cmd, type Command, type Project, type Track } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import "./Mixer.css";

// The accepted maximum for a track gain, as the core states it in `track.setVolume`.
const MAX_GAIN = 4;

export interface MixerProps {
  project: Project;
  /**
   * Programme loudness of the whole project in LUFS, or undefined while nothing has been measured.
   * Measuring means rendering the timeline, so it happens when it is asked for and not per frame.
   */
  loudness?: number;
  measuring?: boolean;
  dispatch: (command: Command, coalesceKey?: string) => void;
  onMeasure?: () => void;
}

export function Mixer({
  project,
  loudness,
  measuring,
  dispatch,
  onMeasure,
}: MixerProps): ReactElement {
  const { t } = useI18n();
  const tracks = project.timeline.tracks;

  return (
    <section className="v-mixer" aria-label={t("mixer.label")} data-testid="mixer">
      <div className="v-mixer__strips">
        {/* Left to right in the order the timeline stacks them from the top, so a strip sits above
            the track it belongs to rather than in the core's bottom-up order. */}
        {[...tracks].reverse().map((track) => (
          <Strip key={track.id} track={track} dispatch={dispatch} />
        ))}
      </div>

      {tracks.length === 0 && <p className="v-mixer__empty">{t("empty.noTracks")}</p>}

      <div className="v-mixer__loudness">
        <button
          type="button"
          className="v-button"
          disabled={measuring === true || onMeasure === undefined}
          onClick={() => onMeasure?.()}
        >
          {t(measuring === true ? "mixer.measuring" : "mixer.measure")}
        </button>
        <output className="v-mixer__reading" data-testid="mixer-loudness">
          {formatLufs(loudness, t)}
        </output>
      </div>
    </section>
  );
}

function Strip({
  track,
  dispatch,
}: {
  track: Track;
  dispatch: (command: Command, coalesceKey?: string) => void;
}): ReactElement {
  const { t } = useI18n();

  return (
    <div className="v-mixer__strip" data-track-id={track.id}>
      <span className="v-mixer__name" style={{ borderLeftColor: track.colorHex }}>
        {track.name}
      </span>
      <Fader
        label={t("mixer.volume", { name: track.name })}
        value={track.volume}
        max={MAX_GAIN}
        onChange={(value, key) => dispatch(cmd.trackSetVolume(track.id, value), key)}
      />
      <Fader
        label={t("mixer.pan", { name: track.name })}
        value={track.pan}
        min={-1}
        max={1}
        onChange={(value, key) => dispatch(cmd.trackSetPan(track.id, value), key)}
      />
      <div className="v-mixer__flags">
        {/* Mute beats solo in the graph, so the two buttons are independent here as well: a track
            that is both stays silent, and pressing solo on it must not quietly clear its mute. */}
        <button
          type="button"
          className="v-mixer__flag"
          aria-label={t("mixer.mute", { name: track.name })}
          aria-pressed={track.muted}
          onClick={() => dispatch(cmd.trackSetFlags(track.id, !track.muted))}
        >
          M
        </button>
        <button
          type="button"
          className="v-mixer__flag"
          aria-label={t("mixer.solo", { name: track.name })}
          aria-pressed={track.solo}
          onClick={() => dispatch(cmd.trackSetFlags(track.id, null, !track.solo))}
        >
          S
        </button>
      </div>
    </div>
  );
}

let gesture = 0;

// The same one-drag-one-undo-step rule the inspector's rows follow, and for the same reason: a
// fader pulled across its travel is one edit, not one per pixel.
function Fader({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (value: number, coalesceKey?: string) => void;
}): ReactElement {
  const { formatNumber } = useI18n();
  const id = useId();
  const coalesceKey = useRef<string | undefined>(undefined);

  return (
    <div className="v-mixer__fader">
      <label className="v-mixer__faderLabel" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step="any"
        value={value}
        onPointerDown={() => {
          coalesceKey.current = `mixer-${(gesture += 1)}`;
        }}
        onKeyDown={() => {
          coalesceKey.current = undefined;
        }}
        onChange={(event) => onChange(Number(event.target.value), coalesceKey.current)}
      />
      <output htmlFor={id}>{formatNumber(value)}</output>
    </div>
  );
}

// A silent programme has no loudness, and -Infinity LUFS on screen reads as a broken readout rather
// than as silence. Nothing measured yet and nothing to measure are different states and say so.
function formatLufs(
  loudness: number | undefined,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (loudness === undefined) return t("mixer.unmeasured");
  if (!Number.isFinite(loudness)) return t("mixer.silent");
  return t("mixer.lufs", { value: loudness.toFixed(1) });
}
