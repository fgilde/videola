import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { stagePoint, stageScale, stageViewBox, type StageFrame, type StagePoint } from "./stageGeometry";

export interface MotionPathProps {
  frame: StageFrame;
  /**
   * The trajectory, sampled in project pixels. Sampled and not derived: what curve a segment takes
   * between two keys is the core's answer — easing, a bezier's handles, a hold — and a line drawn
   * from the keys alone would be a second, prettier claim about where the clip goes.
   */
  path: readonly StagePoint[];
  /** Where the keys themselves sit, in the order the track holds them. */
  keys: readonly StagePoint[];
  /** Which key the pointer is dragging, and where the pointer is now, in project pixels. */
  onDragKey: (index: number, at: StagePoint) => void;
  onDrop: () => void;
}

/**
 * The line a clip travels, on the picture it travels across.
 *
 * The geometry box says where a clip is; this says where it goes. Together they are what a panel of
 * numbers cannot be: a `position` track of six keys is twelve numbers in a list and one shape on
 * the frame, and only the shape says whether the subject leaves the picture on the way.
 */
export function MotionPath({ frame, path, keys, onDragKey, onDrop }: MotionPathProps): ReactElement {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [perPixel, setPerPixel] = useState(1);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const measure = (): void => setPerPixel(stageScale(host.clientWidth, frame));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [frame]);

  function at(event: PointerEvent<Element>): StagePoint {
    const host = hostRef.current;
    if (host === null) return { x: 0, y: 0 };
    return stagePoint(host.getBoundingClientRect(), frame, event.clientX, event.clientY);
  }

  function grab(index: number) {
    return (event: PointerEvent<SVGElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      dragging.current = index;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that has already gone is not one to capture; the move handler reads the ref.
      }
    };
  }

  function move(event: PointerEvent<SVGElement>): void {
    if (dragging.current === null) return;
    onDragKey(dragging.current, at(event));
  }

  function drop(): void {
    if (dragging.current === null) return;
    dragging.current = null;
    onDrop();
  }

  const handle = 6 * perPixel;
  const line = path.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="v-path" ref={hostRef} data-testid="motion-path">
      <svg
        className="v-path__svg"
        viewBox={stageViewBox(frame)}
        preserveAspectRatio="none"
        role="group"
        aria-label={t("path.label")}
        onPointerMove={move}
        onPointerUp={drop}
        onPointerCancel={drop}
      >
        {path.length > 1 && <polyline className="v-path__line" points={line} />}
        {keys.map((key, index) => (
          <circle
            key={index}
            className="v-path__key"
            cx={key.x}
            cy={key.y}
            r={handle}
            data-path-key={index}
            aria-label={t("path.key", { index: String(index + 1) })}
            onPointerDown={grab(index)}
          />
        ))}
      </svg>
    </div>
  );
}
