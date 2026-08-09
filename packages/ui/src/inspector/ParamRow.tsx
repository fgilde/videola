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

/**
 * The three switches and the interpolation picker a keyframed parameter carries. Exported because
 * a curve is not a row -- it is a field with a heading -- and puts the same switches in that
 * heading rather than beside a slider it does not have.
 */
export function Keys({ strip, name }: { strip: KeyframeStrip; name: string }): ReactElement {
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

export interface ColorRowProps {
  label: string;
  /** Straight rgba, each channel 0 to 1, the way the model carries a colour. */
  value: readonly [number, number, number, number];
  onChange: (value: readonly [number, number, number, number]) => void;
}

/**
 * One colour, on the browser's own picker.
 *
 * A picker is the one control here that is not built out of tokens, because the platform already has
 * the whole thing -- an eyedropper, a wheel, a recent list and the system dialogue a person already
 * knows. What a custom one would add is a second set of bugs.
 *
 * ponytail: `input[type=color]` has no alpha, so this edits rgb and carries whatever alpha the model
 * held. Nothing in M1 authors a translucent one; a colour that needs alpha needs a second row for it.
 */
export function ColorRow({ label, value, onChange }: ColorRowProps): ReactElement {
  const id = useId();
  return (
    <div className="v-param">
      <label className="v-param__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="color"
        className="v-param__color"
        value={toHex(value)}
        onChange={(event) => onChange(fromHex(event.target.value, value[3]))}
      />
    </div>
  );
}

/**
 * What a row is allowed to show for a resolved colour: the same guard `clampColor` applies in the
 * engine, minus the premultiplication -- a picker shows the colour that was chosen, not the texel it
 * becomes. Repeated rather than imported for the same reason `shownValue` is.
 */
export function shownColor(
  param: { default: readonly [number, number, number, number] },
  value: unknown,
): readonly [number, number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((channel) => typeof channel === "number" && Number.isFinite(channel))
  ) {
    return param.default;
  }
  const held = value as number[];
  return [unit(held[0]!), unit(held[1]!), unit(held[2]!), unit(held[3]!)];
}

function unit(channel: number): number {
  return Math.min(Math.max(channel, 0), 1);
}

function toHex(value: readonly [number, number, number, number]): string {
  const digits = value
    .slice(0, 3)
    .map((channel) =>
      Math.round(unit(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${digits}`;
}

export interface LutChoice {
  id: string;
  name: string;
}

export interface LutRowProps {
  label: string;
  /** The library asset the grade names, or the empty string for none. */
  value: string;
  /** Every table in the project's library, which is the only place one can come from. */
  tables: readonly LutChoice[];
  onChange: (id: string) => void;
}

/**
 * The one row here that picks a file rather than a number.
 *
 * A picker over what the library holds, and nothing else: a table is imported like every other
 * medium, so the way to get one into this list is to drop a `.cube` on the editor. When the list is
 * empty the control says that instead of showing an empty menu -- a select with one option that
 * means "no" is a control that cannot do anything, and this panel already refuses those elsewhere.
 *
 * There are no keyframe switches. `ParamValue` will not interpolate between two names, so a
 * keyframe on this key could only ever hold -- and a row of switches that can only produce a hold
 * promises an animation the renderer will not give.
 *
 * A name the library no longer holds -- what a removed medium leaves behind -- shows as nothing
 * chosen, and that is the platform's own doing: a `select` whose value matches no option has a
 * selected index of -1 and reports the empty string. A guard of ours for it was written, then
 * deleted, because a counter-check could not make it fail.
 */
export function LutRow({ label, value, tables, onChange }: LutRowProps): ReactElement {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="v-param">
      <label className="v-param__label" htmlFor={id}>
        {label}
      </label>
      {tables.length === 0 ? (
        <span className="v-inspector__note">{t("inspector.lutNone")}</span>
      ) : (
        <select
          id={id}
          className="v-param__select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t("inspector.lutUnset")}</option>
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * What a row is allowed to show for a resolved table: the same guard `lutMedia` applies in the
 * engine before the compositor looks a texture up. Repeated rather than imported for the same
 * reason `shownValue` is -- and a picker standing on a name the renderer ignores would be a lie
 * about the one thing this row exists to display.
 */
export function shownLut(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The alpha comes from what was there rather than from the field, which has none of its own.
function fromHex(hex: string, alpha: number): readonly [number, number, number, number] {
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [0, 0, 0, alpha];
  return [channel(1), channel(3), channel(5), alpha];
}
