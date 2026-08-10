import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";

import {
  cmd,
  on,
  spreadEasing,
  spreadEasingEverywhere,
  type ClipId,
  type Command,
  type CurveShape,
  type Keyframe,
} from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import "../inspector/Inspector.css";
import type { LaneRow } from "./keyframes";

/**
 * The handle pair a `bezier` key falls back to, spelled as `DEFAULT_HANDLE_OUT`/`_IN` spell it in
 * keyframe.rs. A field that opened on a straight line would make the first drag invent a shape
 * rather than adjust one, and the two ends would disagree about what "no handles" looks like.
 */
export const DEFAULT_OUT: readonly [number, number] = [0.42, 0];
export const DEFAULT_IN: readonly [number, number] = [0.58, 1];

// How often the line is sampled from the core. Sixty-four across a hundred-unit box leaves no bend
// anybody can drag showing as a corner, and it is one call per redraw rather than one per pixel.
const SAMPLES = 64;

let gesture = 0;

export interface KeyframeCurveProps {
  clip: ClipId;
  row: LaneRow;
  /**
   * Every keyframe track this clip carries, so the shape can be handed to all of them at once. Absent
   * where the caller has only the one row — the button for it is then not drawn rather than drawn
   * doing what the button beside it already does.
   */
  rows?: readonly LaneRow[];
  /** The picked key. Its `handleOut` shapes the segment that starts here. */
  left: Keyframe;
  /** The key after it. Its `handleIn` shapes the same segment from the other end. */
  right: Keyframe;
  /** The core's own easing, sampled. Never recomputed here -- see the note on the plot below. */
  curveShape: CurveShape;
  dispatch: (command: Command, coalesceKey?: string) => void;
}

/**
 * The curve between two keyframes, drawn and dragged.
 *
 * **Where it sits, and why not in the lane.** The keyframe lane lives inside the timeline's own
 * scrolling content, on the timeline's own time axis -- that is what makes a key line up with the
 * ruler and the playhead without anything having to agree on where "now" is. A curve needs a value
 * axis the lane does not have, and a 26 px row (44 px under a finger) has nowhere to put one. It
 * also needs room across: a segment is usually a fraction of a second, which at the default zoom is
 * fifty pixels -- less than one touch target, so a handle on the timeline's axis could not be
 * dragged without zooming the whole timeline to it.
 *
 * So it is its own field, beside the interpolation the picked key is set to, in the bar that
 * already sits outside the scrolling area for the same reason: what a keyframe is set to has to
 * stay reachable while the lane it lives on is scrolled. The field's x is not a second time axis --
 * it is the segment's own 0..1, which is the unit square a bezier handle pair is already stored in.
 *
 * **The line comes out of Rust.** `curveShape` is `keyframe::segment_shape`, the very function
 * `interpolate` applies to move the picture. Easing written again here would pass every end-point
 * check ever written and be wrong in the middle, which is the one fault a curve editor must not
 * have.
 */
export function KeyframeCurve(props: KeyframeCurveProps): ReactElement {
  const { clip, row, left, right, curveShape, dispatch } = props;
  const { t } = useI18n();
  const field = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ end: End; key: string } | null>(null);
  const [held, setHeld] = useState<End | undefined>(undefined);
  const bendable = left.interp === "bezier";
  const out = pair(left.handleOut, DEFAULT_OUT);
  const into = pair(right.handleIn, DEFAULT_IN);

  const at = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = field.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0 || box.height <= 0) return [0, 0];
    // The field is read as a graph and the page runs top-down, so y is turned here -- the one
    // place in this component where the two directions meet.
    return [
      unit((event.clientX - box.left) / box.width),
      inField(fromField(1 - (event.clientY - box.top) / box.height)),
    ];
  };

  // Both handles go out on every write because that is the shape the keyframe carries: one pair per
  // key. Sending only the one under the hand would clear the other back to the default, which is
  // how the upsert used to flatten a curve nobody could put back.
  const moveTo = (end: End, x: number, y: number, key: string): void => {
    const point: [number, number] = [x, y];
    if (end === "out") {
      dispatch(
        cmd.keyframeSetHandles(
          on.clip(clip),
          row.effectType,
          row.key,
          left.time,
          left.handleIn ?? null,
          point,
        ),
        key,
      );
      return;
    }
    dispatch(
      cmd.keyframeSetHandles(
        on.clip(clip),
        row.effectType,
        row.key,
        right.time,
        point,
        right.handleOut ?? null,
      ),
      key,
    );
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, end: End): void => {
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not every environment implements capture; the drag still works inside the handle */
    }
    drag.current = { end, key: `keyframe-curve-${(gesture += 1)}` };
    setHeld(end);
  };

  const plot = pathOf(curveShape(left, right, SAMPLES));

  return (
    <div className="v-keycurve" data-testid="keyframe-curve">
      <div
        ref={field}
        className="v-curve"
        role="group"
        aria-label={t("keyframe.curveField")}
      >
        <svg className="v-curve__plot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {[0.25, 0.5, 0.75].map((line) => (
            <g key={line}>
              <line className="v-curve__grid" x1={line * 100} y1="0" x2={line * 100} y2="100" />
              <line
                className="v-curve__grid"
                x1="0"
                y1={down(line)}
                x2="100"
                y2={down(line)}
              />
            </g>
          ))}
          {/* Where the travel arrives and where it sets off. The field reaches past both, so
              without these two the overshoot has nothing to be an overshoot of. */}
          <line className="v-curve__bound" x1="0" y1={down(0)} x2="100" y2={down(0)} />
          <line className="v-curve__bound" x1="0" y1={down(1)} x2="100" y2={down(1)} />
          {/* The travel that is evenly paced, so the shape of the one that is not reads as a
              departure from it rather than as a line on its own. */}
          <line className="v-curve__diagonal" x1="0" y1={down(0)} x2="100" y2={down(1)} />
          {/* Each handle tethered to the key it belongs to. Without the tether the two dots are
              points in a box, and which end of the segment each one governs is a guess. */}
          {bendable && (
            <>
              <line
                className="v-keycurve__tether"
                x1="0"
                y1={down(0)}
                x2={out[0] * 100}
                y2={down(out[1])}
              />
              <line
                className="v-keycurve__tether"
                x1="100"
                y1={down(1)}
                x2={into[0] * 100}
                y2={down(into[1])}
              />
            </>
          )}
          <path className="v-curve__line" d={plot} />
        </svg>
        {bendable &&
          (["out", "in"] as const).map((end) => {
            const point = end === "out" ? out : into;
            return (
              <button
                key={end}
                type="button"
                className="v-curve__point"
                data-curve-handle={end}
                data-held={held === end || undefined}
                style={{
                  left: `${unit(point[0]) * 100}%`,
                  bottom: `${upField(inField(point[1])) * 100}%`,
                }}
                aria-label={t(`keyframe.handle.${end}`)}
                onPointerDown={(event) => startDrag(event, end)}
                onPointerMove={(event) => {
                  const grab = drag.current;
                  if (grab?.end !== end) return;
                  const [x, y] = at(event);
                  moveTo(end, x, y, grab.key);
                }}
                onPointerUp={() => {
                  drag.current = null;
                  setHeld(undefined);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setHeld(undefined);
                }}
                onKeyDown={(event) => {
                  const step = ARROWS[event.key];
                  if (step === undefined) return;
                  event.preventDefault();
                  moveTo(
                    end,
                    unit(point[0] + step[0]),
                    inField(point[1] + step[1]),
                    `keyframe-curve-${(gesture += 1)}`,
                  );
                }}
              />
            );
          })}
      </div>
      {/* A shape somebody spent a minute on is a shape they want for the whole move. Offered only
          where there is somewhere for it to go: a track of two keys has one segment, and this
          would be a button that changes nothing. */}
      {row.track.length > 2 && (
        <button
          type="button"
          className="v-keycurve__spread"
          onClick={() => {
            const key = `keyframe-spread-${(gesture += 1)}`;
            for (const command of spreadEasing(
              row.track,
              on.clip(clip),
              row.effectType,
              row.key,
              left,
            )) {
              dispatch(command, key);
            }
          }}
        >
          {t("keyframe.curveEverywhere")}
        </button>
      )}
      {/* The same shape on every parameter of the clip. An easing belongs to a key rather than to a
          moment, so the tracks need not line up in time: each key runs the shape over its own
          segment, which is what "make the rest match" means. Offered only where there is a second
          track to reach. */}
      {(props.rows ?? []).some((other) => other.id !== row.id) && (
        <button
          type="button"
          className="v-keycurve__spread"
          onClick={() => {
            const key = `keyframe-spread-all-${(gesture += 1)}`;
            for (const command of spreadEasingEverywhere(props.rows ?? [], on.clip(clip), left)) {
              dispatch(command, key);
            }
          }}
        >
          {t("keyframe.curveEveryParameter")}
        </button>
      )}
      {/* A field with no handles says why rather than looking broken. The presets are still a
          single click in the select beside it; this is the fourth option, not a replacement. */}
      {!bendable && <p className="v-keycurve__hint">{t("keyframe.curveNeedsBezier")}</p>}
      {/* The precedence rule, said where a curve is being drawn on a track that moves nothing. The
          lane says it too; a curve field that stayed silent would be the more convincing of the
          two surfaces about an edit with no effect. */}
      {row.overridden && <p className="v-keycurve__hint">{t("keyframe.curveOverridden")}</p>}
    </div>
  );
}

type End = "out" | "in";

// A twentieth of the box per press: across it in a second of held key, and fine enough to land on
// a shape somebody meant.
const STEP = 0.05;

const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-STEP, 0],
  ArrowRight: [STEP, 0],
  ArrowUp: [0, STEP],
  ArrowDown: [0, -STEP],
};

/** A handle as it can be drawn and dragged: finite, and inside what the field shows. */
function pair(
  value: readonly [number, number] | null | undefined,
  fallback: readonly [number, number],
): readonly [number, number] {
  if (value === null || value === undefined) return fallback;
  const [x, y] = value;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return [x, y];
}

// The samples the core handed over, in the 0..100 box the viewBox declares. `down` is the one place
// a value becomes a y, so the line, the handles, the tethers and the two bounds cannot disagree
// about where 1 is.
function pathOf(shape: readonly number[]): string {
  const last = shape.length - 1;
  if (last < 1) return "";
  return shape
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${((index / last) * 100).toFixed(2)} ${down(value).toFixed(2)}`,
    )
    .join(" ");
}

// A value, as the y a page draws it at: the field's own fraction, turned over, times a hundred.
function down(value: number): number {
  return 100 - upField(value) * 100;
}

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * How far past the unit square the field reaches, above and below, as a fraction of it.
 *
 * A bounce is made of a handle whose y is outside 0..1: the travel goes past its destination and
 * comes back, or dips under its start before setting off. The core stores, loads and animates that
 * correctly — only the field used to pin it to the edge, so the first drag flattened a shape nobody
 * could put back. A third either way is what an overshoot is: enough for every bounce anyone hand
 * authors, and little enough that the unit square is still most of what is on screen.
 */
const OVERSHOOT = 1 / 3;

const SPAN = 1 + 2 * OVERSHOOT;

/** A handle's y, as the fraction up the field it is drawn at. Where the three places agree. */
export function upField(y: number): number {
  return (y + OVERSHOOT) / SPAN;
}

/** And back: the fraction up the field a pointer sits at, as a handle's y. */
export function fromField(fraction: number): number {
  return fraction * SPAN - OVERSHOOT;
}

/** Clamped to what the field shows rather than to the unit square. */
export function inField(y: number): number {
  if (!Number.isFinite(y)) return 0;
  return Math.min(Math.max(y, -OVERSHOOT), 1 + OVERSHOOT);
}
