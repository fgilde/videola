import { useId, useRef, type ReactElement } from "react";

import type { Interp, Keyframe, Time } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import "./Inspector.css";

// Bezier is missing on purpose: M1 has no curve editing, and a handle nobody can drag is a
// setting that cannot be undone from the same surface that made it.
const OFFERED: readonly Interp[] = ["linear", "hold", "ease"];

export interface KeyframeStrip {
  at: Time;
  track: readonly Keyframe[];
  /**
   * False while the playhead stands outside the clip. A keyframe written there is never evaluated
   * for this clip, so the switch would report a state no picture ever shows.
   */
  settable: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onGoTo: (time: Time) => void;
  onInterp: (interp: Interp) => void;
}

export interface ParamRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number, coalesceKey?: string) => void;
  keyframes?: KeyframeStrip;
}

let gesture = 0;

export function ParamRow({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  keyframes,
}: ParamRowProps): ReactElement {
  const { formatNumber } = useI18n();
  const id = useId();
  // One drag is one undo step: every change under one grab carries one key, and the next grab
  // mints another. There is deliberately no release on pointerup -- between two grabs the only
  // thing that can change this value is the keyboard, and a pointer let go outside the window
  // never reports back anyway, so ending the run is the keystroke's job and not the release's.
  const coalesceKey = useRef<string | undefined>(undefined);

  return (
    <div className="v-param">
      <label className="v-param__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="v-param__slider"
        type="range"
        min={min}
        max={max}
        // A stepped range snaps whatever is assigned to it onto the nearest notch, so a row over
        // a keyframed parameter would report 0.48 where the core holds 0.5 -- the readout has to
        // be the core's number, not the widget's idea of it.
        step="any"
        value={value}
        disabled={disabled === true}
        onPointerDown={() => {
          coalesceKey.current = `inspector-${(gesture += 1)}`;
        }}
        onKeyDown={() => {
          coalesceKey.current = undefined;
        }}
        onChange={(event) => onChange(Number(event.target.value), coalesceKey.current)}
      />
      <output className="v-param__value" htmlFor={id}>
        {formatNumber(value)}
      </output>
      {keyframes !== undefined && <Keys strip={keyframes} name={label} />}
    </div>
  );
}

function Keys({ strip, name }: { strip: KeyframeStrip; name: string }): ReactElement {
  const { t } = useI18n();
  const here = keyframeAt(strip.track, strip.at);
  const previous = neighbour(strip.track, strip.at, -1);
  const next = neighbour(strip.track, strip.at, 1);

  return (
    <span className="v-param__keys">
      <button
        type="button"
        className="v-param__key"
        aria-label={t("inspector.keyframePrev", { name })}
        disabled={previous === undefined}
        onClick={() => previous !== undefined && strip.onGoTo(previous.time)}
      >
        <span aria-hidden="true">◀</span>
      </button>
      <button
        type="button"
        className="v-param__key"
        aria-label={t("inspector.keyframe", { name })}
        aria-pressed={here !== undefined}
        disabled={!strip.settable}
        onClick={() => (here === undefined ? strip.onAdd() : strip.onRemove())}
      >
        <span aria-hidden="true">{here === undefined ? "◇" : "◆"}</span>
      </button>
      <button
        type="button"
        className="v-param__key"
        aria-label={t("inspector.keyframeNext", { name })}
        disabled={next === undefined}
        onClick={() => next !== undefined && strip.onGoTo(next.time)}
      >
        <span aria-hidden="true">▶</span>
      </button>
      {here !== undefined && (
        <select
          className="v-param__interp"
          aria-label={t("inspector.interp", { name })}
          value={here.interp}
          onChange={(event) => strip.onInterp(event.target.value as Interp)}
        >
          {offeredFor(here.interp).map((interp) => (
            <option key={interp} value={interp}>
              {t(`interp.${interp}`)}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

// A keyframe loaded from a file may carry an interpolation this milestone cannot author. Listing
// it keeps the select truthful about what is set instead of displaying the first option instead.
function offeredFor(interp: Interp): readonly Interp[] {
  return OFFERED.includes(interp) ? OFFERED : [interp, ...OFFERED];
}

export function keyframeAt(track: readonly Keyframe[], at: Time): Keyframe | undefined {
  return track.find((entry) => entry.time === at);
}

/**
 * What a row is allowed to show for a resolved parameter. The same rule `clampParam` applies in the
 * engine before a value becomes a uniform or a filter frequency, so a row reports what is actually
 * drawn and heard. Repeated from the engine rather than imported because @videola/ui does not depend
 * on it -- and a slider reading 9 while the filter runs at 4 would be a lie about the one thing these
 * rows exist to display. A `ParamValue` of a kind that is not a number arrives from a hand-authored
 * project, which is why the type check is not dead code.
 */
export function shownValue(
  param: { default: number; min: number; max: number },
  value: unknown,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return param.default;
  return Math.min(Math.max(value, param.min), param.max);
}

// The core keeps every track sorted by time on every write, so the nearest one on a side is the
// first respectively the last of those beyond the playhead.
function neighbour(track: readonly Keyframe[], at: Time, direction: 1 | -1): Keyframe | undefined {
  const beyond = track.filter((entry) =>
    direction === 1 ? entry.time > at : entry.time < at,
  );
  return direction === 1 ? beyond[0] : beyond[beyond.length - 1];
}
