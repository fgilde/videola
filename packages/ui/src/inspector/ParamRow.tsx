import { useId, useRef, type ReactElement } from "react";

import type { Interp, Keyframe, Time } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { Icon } from "../primitives/Icon";
import { offeredFor } from "../timeline/keyframes";
import "./Inspector.css";

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
  /**
   * What a screen reader hears, when that has to say more than the label shows. A mixer strip
   * writes "Lautstärke" beside the fader and the track is named at the top of the strip -- but
   * out of that context a row called "Lautstärke" is one of four identical ones.
   */
  name?: string;
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
  name,
  value,
  min,
  max,
  disabled,
  onChange,
  keyframes,
}: ParamRowProps): ReactElement {
  const { formatNumber, t } = useI18n();
  const id = useId();
  // One drag is one undo step: every change under one grab carries one key, and the next grab
  // mints another. There is deliberately no release on pointerup -- between two grabs the only
  // thing that can change this value is the keyboard, and a pointer let go outside the window
  // never reports back anyway, so ending the run is the keystroke's job and not the release's.
  const coalesceKey = useRef<string | undefined>(undefined);

  const animated = keyframes !== undefined && keyframes.track.length > 0;

  return (
    <div className="v-param" data-animated={animated || undefined}>
      <label className="v-param__label" htmlFor={id}>
        {label}
        {/* What the row of switches below cannot say: they only ever report the playhead, so a
            parameter animated somewhere else looked exactly like one that is not animated at all.
            An image with a name rather than a bare tint, because "this is on the clock" is the
            fact, and a colour is only how it is drawn. */}
        {animated && (
          <span
            className="v-param__animated"
            role="img"
            aria-label={t("inspector.animated", { count: keyframes.track.length })}
            title={t("inspector.animated", { count: keyframes.track.length })}
          />
        )}
      </label>
      <input
        id={id}
        className="v-param__slider"
        type="range"
        aria-label={name}
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
      {keyframes !== undefined && <Keys strip={keyframes} name={name ?? label} />}
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
        <Icon name="chevronLeft" />
      </button>
      <button
        type="button"
        className="v-param__key"
        aria-label={t("inspector.keyframe", { name })}
        aria-pressed={here !== undefined}
        disabled={!strip.settable}
        onClick={() => (here === undefined ? strip.onAdd() : strip.onRemove())}
      >
        <Icon name={here === undefined ? "keyframe" : "keyframeSet"} />
      </button>
      <button
        type="button"
        className="v-param__key"
        aria-label={t("inspector.keyframeNext", { name })}
        disabled={next === undefined}
        onClick={() => next !== undefined && strip.onGoTo(next.time)}
      >
        <Icon name="chevronRight" />
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
