import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";

import {
  cmd,
  on,
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
export function KeyframeCurve({
  clip,
  row,
  left,
  right,
  curveShape,
  dispatch,
}: KeyframeCurveProps): ReactElement {
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
      unit(1 - (event.clientY - box.top) / box.height),
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
          {[25, 50, 75].map((line) => (
            <g key={line}>
              <line className="v-curve__grid" x1={line} y1="0" x2={line} y2="100" />
              <line className="v-curve__grid" x1="0" y1={line} x2="100" y2={line} />
            </g>
          ))}
          {/* The travel that is evenly paced, so the shape of the one that is not reads as a
              departure from it rather than as a line on its own. */}
          <line className="v-curve__diagonal" x1="0" y1="100" x2="100" y2="0" />
          {/* Each handle tethered to the key it belongs to. Without the tether the two dots are
              points in a box, and which end of the segment each one governs is a guess. */}
          {bendable && (
            <>
              <line
                className="v-keycurve__tether"
                x1="0"
                y1="100"
                x2={out[0] * 100}
                y2={100 - out[1] * 100}
              />
              <line
                className="v-keycurve__tether"
                x1="100"
                y1="0"
                x2={into[0] * 100}
                y2={100 - into[1] * 100}
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
                style={{ left: `${unit(point[0]) * 100}%`, bottom: `${unit(point[1]) * 100}%` }}
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
                    unit(point[1] + step[1]),
                    `keyframe-curve-${(gesture += 1)}`,
                  );
                }}
              />
            );
          })}
      </div>
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

/**
 * A handle as it can be drawn and dragged: finite, and in the unit square.
 *
 * ponytail: an overshoot handle -- y outside 0..1, which is what a bounce is made of -- is stored,
 * loaded and animated correctly by the core, but is drawn pinned to the edge of the field here and
 * the first drag flattens it. Widen the field's viewBox past the unit square if bounce curves are
 * ever authored rather than merely loaded.
 */
function pair(
  value: readonly [number, number] | null | undefined,
  fallback: readonly [number, number],
): readonly [number, number] {
  if (value === null || value === undefined) return fallback;
  const [x, y] = value;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return fallback;
  return [x, y];
}

// The samples the core handed over, in the 0..100 box the viewBox declares, with y turned over the
// way a graph is read.
function pathOf(shape: readonly number[]): string {
  const last = shape.length - 1;
  if (last < 1) return "";
  return shape
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${((index / last) * 100).toFixed(2)} ${(100 - value * 100).toFixed(2)}`,
    )
    .join(" ");
}

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}
