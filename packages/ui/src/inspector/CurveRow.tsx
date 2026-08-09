import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";

import { curveAt, IDENTITY_CURVE, readableCurve } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import "./Inspector.css";

export type Point = readonly [number, number];

export interface CurveRowProps {
  label: string;
  /** The control points as the model carries them: `[input, output]`, both 0 to 1, x ascending. */
  value: readonly Point[];
  /** One call per change, with a key that says which changes belong to the same gesture. */
  onChange: (value: readonly Point[], coalesceKey?: string) => void;
  /**
   * True while the playhead stands outside a clip whose curve is keyframed. The field still shows
   * the shape the core resolved; there is simply no moment here for a drag to be written to.
   */
  disabled?: boolean;
  keyframes?: ReactElement;
}

// How far apart two points have to stay along the input axis. Without it a drag can put two points
// on the same tone, which is a vertical step -- legal, drawable, and impossible to pull apart again
// because both are now under the same finger.
const APART = 0.01;

// What one arrow key is worth. A fiftieth of the range is coarse enough to cross the box in a few
// seconds and fine enough to land on a tone that matters.
const STEP = 0.02;

// A press that travels less than this many pixels was a tap, not a drag. Four rather than nought,
// because a finger never holds still and a pointer with a heavy hand moves one or two.
const TAP_PX = 4;

let gesture = 0;

/**
 * A tone curve, drawn and dragged.
 *
 * The line is sampled from `curveAt` -- the same function the renderer samples its table from -- so
 * what is on screen and what is on the picture cannot disagree. That is the one bug a curve tool
 * must not have, and importing rather than reimplementing is what rules it out.
 *
 * The points are HTML buttons over the drawing rather than circles inside it. Three things come
 * free that way and none of them is free in SVG: the platform focuses and reaches them with the
 * keyboard, `--v-touch-target` sizes them from the same token as every other control, and a test
 * can measure the rectangle a finger has to hit. A circle in a scaled viewBox has a radius in user
 * units, and forty-four pixels is not a fixed number of those.
 *
 * The gestures, all three of them: drag a point to move it, tap the empty field to add one where
 * you tapped, tap a point to take it away. The two ends stay -- a curve with nothing at black and
 * nothing at white has no shape left to speak of.
 */
export function CurveRow({
  label,
  value,
  onChange,
  disabled,
  keyframes,
}: CurveRowProps): ReactElement {
  const { t } = useI18n();
  const field = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ index: number; key: string; from: [number, number] } | null>(null);
  const [held, setHeld] = useState<number | undefined>(undefined);
  const points = value.length > 0 ? value : IDENTITY_CURVE;

  const at = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = field.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0 || box.height <= 0) return [0, 0];
    // The drawing runs bottom-up like a graph and the page runs top-down, so y is turned here --
    // the one place in this component where the two directions meet.
    return [
      unit((event.clientX - box.left) / box.width),
      unit(1 - (event.clientY - box.top) / box.height),
    ];
  };

  const moveTo = (index: number, x: number, y: number, key: string): void => {
    // Clamped between the neighbours rather than re-sorted afterwards: a point that overtakes its
    // neighbour changes its own index mid-drag, and the finger then carries on dragging whichever
    // point inherited the index.
    const low = index === 0 ? 0 : points[index - 1]![0] + APART;
    const high = index === points.length - 1 ? 1 : points[index + 1]![0] - APART;
    const next = points.map((point, i): Point => (i === index ? [clamp(x, low, high), y] : point));
    onChange(next, key);
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, index: number): void => {
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* not every environment implements capture; the drag still works inside the point */
    }
    drag.current = {
      index,
      key: `curve-${(gesture += 1)}`,
      from: [event.clientX, event.clientY],
    };
    setHeld(index);
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, index: number): void => {
    const grab = drag.current;
    drag.current = null;
    setHeld(undefined);
    if (grab === null) return;
    const travelled = Math.hypot(event.clientX - grab.from[0], event.clientY - grab.from[1]);
    if (travelled <= TAP_PX) remove(index);
  };

  const remove = (index: number): void => {
    if (index === 0 || index === points.length - 1 || points.length <= 2) return;
    onChange(
      points.filter((_, i) => i !== index),
      `curve-${(gesture += 1)}`,
    );
  };

  // A press on the field itself, which is everywhere no point already is. The new point lands on
  // the curve's own line at that input, so adding one changes nothing until it is dragged -- an
  // added point that moved the picture would be a curve editor that grades by being looked at.
  const add = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled === true) return;
    const [x] = at(event);
    const index = points.findIndex((point) => point[0] > x);
    if (index <= 0) return;
    const low = points[index - 1]![0] + APART;
    const high = points[index]![0] - APART;
    if (high < low) return;
    const placed = clamp(x, low, high);
    onChange(
      [...points.slice(0, index), [placed, unit(curveAt(points, placed))], ...points.slice(index)],
      `curve-${(gesture += 1)}`,
    );
  };

  return (
    <div className="v-param v-param--curve">
      <div className="v-param__curveHead">
        <span className="v-param__label">{label}</span>
        {keyframes}
      </div>
      <div
        ref={field}
        className="v-curve"
        role="group"
        aria-label={t("inspector.curveField", { name: label })}
        onPointerDown={add}
      >
        <svg className="v-curve__plot" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {/* Quarters, so the eye has something to read the shape against, and the diagonal, which
              is the curve that changes nothing. */}
          {[25, 50, 75].map((line) => (
            <g key={line}>
              <line className="v-curve__grid" x1={line} y1="0" x2={line} y2="100" />
              <line className="v-curve__grid" x1="0" y1={line} x2="100" y2={line} />
            </g>
          ))}
          <line className="v-curve__diagonal" x1="0" y1="100" x2="100" y2="0" />
          <path className="v-curve__line" d={pathOf(points)} />
        </svg>
        {points.map((point, index) => {
          const ends = index === 0 || index === points.length - 1;
          return (
            <button
              key={index}
              type="button"
              className="v-curve__point"
              data-held={held === index || undefined}
              disabled={disabled === true}
              style={{ left: `${point[0] * 100}%`, bottom: `${point[1] * 100}%` }}
              aria-label={t("inspector.curvePoint", {
                name: label,
                input: Math.round(point[0] * 100),
                output: Math.round(point[1] * 100),
              })}
              onPointerDown={(event) => startDrag(event, index)}
              onPointerMove={(event) => {
                if (drag.current?.index !== index) return;
                const [x, y] = at(event);
                moveTo(index, x, y, drag.current.key);
              }}
              onPointerUp={(event) => endDrag(event, index)}
              onPointerCancel={() => {
                drag.current = null;
                setHeld(undefined);
              }}
              onKeyDown={(event) => {
                const step = ARROWS[event.key];
                if (step !== undefined) {
                  event.preventDefault();
                  const key = `curve-${(gesture += 1)}`;
                  moveTo(index, point[0] + step[0], unit(point[1] + step[1]), key);
                  return;
                }
                if (!ends && (event.key === "Delete" || event.key === "Backspace")) {
                  event.preventDefault();
                  remove(index);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

const ARROWS: Record<string, [number, number] | undefined> = {
  ArrowLeft: [-STEP, 0],
  ArrowRight: [STEP, 0],
  ArrowUp: [0, STEP],
  ArrowDown: [0, -STEP],
};

/**
 * What a row is allowed to show for a resolved curve. The same guard the engine applies before the
 * points become a table, imported rather than repeated -- unlike the number and the colour above
 * it, because a curve is drawn from the very function that samples it and there was never a second
 * copy to keep in step.
 */
export function shownCurve(param: { default: readonly Point[] }, value: unknown): readonly Point[] {
  return readableCurve(value, param.default) as readonly Point[];
}

// The line, sampled often enough that no bend of a curve anybody can draw shows as a corner. In the
// 0..100 box the viewBox declares, with y turned over the way a graph is read.
const SAMPLES = 64;

function pathOf(points: readonly Point[]): string {
  const steps: string[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const x = i / (SAMPLES - 1);
    steps.push(`${i === 0 ? "M" : "L"}${(x * 100).toFixed(2)} ${(100 - curveAt(points, x) * 100).toFixed(2)}`);
  }
  return steps.join(" ");
}

function unit(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), Math.max(low, high));
}
