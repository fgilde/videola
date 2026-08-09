import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";

export interface StagePoint {
  x: number;
  y: number;
}

/** Which part of the box was taken hold of. A number is a corner, clockwise from the top left. */
export type StageGrab = "move" | "rotate" | 0 | 1 | 2 | 3;

export interface StageProps {
  /** The project's own resolution. The overlay works in project pixels from the frame's centre. */
  frame: { width: number; height: number };
  /** The four corners of the picture, clockwise from its top left, in project pixels. */
  quad: readonly StagePoint[];
  /** What the picture is called, so the box has a name a screen reader can say. */
  label: string;
  /**
   * A drag in progress. `delta` is the travel since the drag began and `pointer` where the pointer
   * is now, both in project pixels — the same units the transform is in, so nothing downstream has
   * to know about screens. `at` is where the drag began, which is what a rotation measures from.
   */
  onDrag: (grab: StageGrab, drag: { at: StagePoint; pointer: StagePoint; delta: StagePoint; even: boolean }) => void;
  /** The drag ended. A new one starts its own undo step. */
  onDrop: () => void;
}

// How far above the top edge the rotation handle stands, in project pixels at the frame's own
// height. Far enough to be a target of its own next to the corner it sits between.
const ROTATE_OFFSET = 0.06;

/**
 * The box around the picture, on the picture.
 *
 * Every editor puts the geometry of a shot on the frame itself, because that is where the answer
 * is: a number in a panel says 1.4, and only the picture says whether the face is still in shot.
 * The corners are what the compositor draws — `clipQuad` in the engine is checked against the very
 * matrix the GPU is handed — so the handles sit on the picture and not near it.
 */
export function Stage({ frame, quad, label, onDrag, onDrop }: StageProps): ReactElement {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ grab: StageGrab; at: StagePoint } | null>(null);
  // Handles are drawn in project units inside the viewBox, so their size has to be divided by
  // however many project pixels one screen pixel currently is, or they grow with the project's
  // resolution and vanish on a 4K timeline.
  const [perPixel, setPerPixel] = useState(1);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const measure = (): void => {
      const width = host.clientWidth;
      setPerPixel(width > 0 ? frame.width / width : 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [frame.width]);

  function projectPoint(event: PointerEvent<Element>): StagePoint {
    const host = hostRef.current;
    if (host === null) return { x: 0, y: 0 };
    const box = host.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - box.left) / box.width) * frame.width - frame.width / 2,
      y: ((event.clientY - box.top) / box.height) * frame.height - frame.height / 2,
    };
  }

  function grab(part: StageGrab) {
    return (event: PointerEvent<SVGElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = { grab: part, at: projectPoint(event) };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that has already gone is not one to capture. The move handler reads the same
        // ref either way, so nothing here depends on the capture succeeding.
      }
    };
  }

  function move(event: PointerEvent<SVGElement>): void {
    const drag = dragRef.current;
    if (drag === null) return;
    const pointer = projectPoint(event);
    onDrag(drag.grab, {
      at: drag.at,
      pointer,
      delta: { x: pointer.x - drag.at.x, y: pointer.y - drag.at.y },
      even: event.shiftKey,
    });
  }

  function drop(): void {
    if (dragRef.current === null) return;
    dragRef.current = null;
    onDrop();
  }

  const [topLeft, topRight] = quad;
  const rotateAt =
    topLeft === undefined || topRight === undefined
      ? undefined
      : outward(topLeft, topRight, quad, frame.height * ROTATE_OFFSET);
  const handle = 7 * perPixel;
  const path = quad.map((point) => `${point.x},${point.y}`).join(" ");
  const midTop =
    topLeft === undefined || topRight === undefined
      ? undefined
      : { x: (topLeft.x + topRight.x) / 2, y: (topLeft.y + topRight.y) / 2 };

  return (
    <div className="v-stage" ref={hostRef} data-testid="stage">
      <svg
        className="v-stage__svg"
        viewBox={`${-frame.width / 2} ${-frame.height / 2} ${frame.width} ${frame.height}`}
        preserveAspectRatio="none"
        role="group"
        aria-label={t("stage.label", { name: label })}
        onPointerMove={move}
        onPointerUp={drop}
        onPointerCancel={drop}
      >
        {rotateAt !== undefined && midTop !== undefined && (
          <line className="v-stage__tether" x1={midTop.x} y1={midTop.y} x2={rotateAt.x} y2={rotateAt.y} />
        )}
        <polygon
          className="v-stage__box"
          points={path}
          data-grab="move"
          aria-label={t("stage.move")}
          onPointerDown={grab("move")}
        />
        {rotateAt !== undefined && (
          <circle
            className="v-stage__handle v-stage__handle--rotate"
            cx={rotateAt.x}
            cy={rotateAt.y}
            r={handle}
            data-grab="rotate"
            aria-label={t("stage.rotate")}
            onPointerDown={grab("rotate")}
          />
        )}
        {quad.map((point, index) => (
          <rect
            key={index}
            className="v-stage__handle"
            x={point.x - handle}
            y={point.y - handle}
            width={handle * 2}
            height={handle * 2}
            data-grab={index}
            aria-label={t("stage.corner", { corner: String(index + 1) })}
            onPointerDown={grab(index as 0 | 1 | 2 | 3)}
          />
        ))}
      </svg>
    </div>
  );
}

// The rotation handle stands off the top edge along the picture's own outward normal, so a picture
// turned upside down has its handle below the frame's top rather than through its middle.
function outward(
  topLeft: StagePoint,
  topRight: StagePoint,
  quad: readonly StagePoint[],
  distance: number,
): StagePoint {
  const bottomRight = quad[2];
  const midTop = { x: (topLeft.x + topRight.x) / 2, y: (topLeft.y + topRight.y) / 2 };
  if (bottomRight === undefined) return midTop;
  const down = { x: bottomRight.x - topRight.x, y: bottomRight.y - topRight.y };
  const length = Math.hypot(down.x, down.y);
  if (length === 0) return midTop;
  return { x: midTop.x - (down.x / length) * distance, y: midTop.y - (down.y / length) * distance };
}
