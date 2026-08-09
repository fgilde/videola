import type { Transform } from "@videola/core";

// Where a clip's picture actually lands, as four points. `quadMatrix` in draw-list.ts already
// answers that for the GPU, in clipspace and column-major; this answers it for anything that has
// to draw a box around the picture or turn a pointer into a new transform. The two are checked
// against each other rather than kept in step by hand — a handle that sat anywhere but on the
// corner of the picture would be a lie the editor tells about its own frame.
//
// Coordinates are the ones draw-list.ts defines: project pixels from the centre of the frame, y
// running down the picture, rotation in degrees turning clockwise on screen.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The corners of the drawn picture, clockwise from its top left. */
export function clipQuad(transform: Transform, source: Size): Point[] {
  const width = source.width * transform.scaleX;
  const height = source.height * transform.scaleY;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const crop = transform.crop;
  const left = crop.left;
  const top = crop.top;
  const right = 1 - crop.right;
  const bottom = 1 - crop.bottom;
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([u, v]) => {
    const offsetX = ((u as number) - transform.anchorX) * width;
    const offsetY = ((v as number) - transform.anchorY) * height;
    return {
      x: transform.x + cos * offsetX - sin * offsetY,
      y: transform.y + sin * offsetX + cos * offsetY,
    };
  });
}

/** The middle of the drawn picture — the point a rotation turns about on screen. */
export function quadCentre(quad: readonly Point[]): Point {
  const sum = quad.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / quad.length, y: sum.y / quad.length };
}

/** Moved by a pointer's travel, in project pixels. */
export function movedBy(transform: Transform, delta: Point): Transform {
  return { ...transform, x: transform.x + delta.x, y: transform.y + delta.y };
}

/**
 * Scaled by dragging one corner, with the opposite corner staying where it is.
 *
 * The pointer travel is turned back into the picture's own axes first, so a corner of a clip
 * turned 30 degrees still grows along the edge it is on rather than along the screen. `uniform`
 * takes the larger of the two factors for both axes, which is what a corner handle means
 * everywhere: keep the aspect and follow the diagonal.
 */
export function scaledBy(
  transform: Transform,
  corner: number,
  delta: Point,
  source: Size,
  uniform: boolean,
): Transform {
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // Into the picture's frame: the inverse rotation, which for a rotation is its transpose.
  const alongX = delta.x * cos + delta.y * sin;
  const alongY = -delta.x * sin + delta.y * cos;
  // Which way a corner pushes each axis. Clockwise from the top left, so 0 and 3 pull the left
  // edge and 0 and 1 pull the top one.
  const towardsX = corner === 1 || corner === 2 ? 1 : -1;
  const towardsY = corner === 2 || corner === 3 ? 1 : -1;
  const width = Math.max(1, source.width * transform.scaleX);
  const height = Math.max(1, source.height * transform.scaleY);
  let scaleX = transform.scaleX * (1 + (towardsX * alongX) / width);
  let scaleY = transform.scaleY * (1 + (towardsY * alongY) / height);
  if (uniform) {
    const factor = Math.abs(scaleX / transform.scaleX) > Math.abs(scaleY / transform.scaleY)
      ? scaleX / transform.scaleX
      : scaleY / transform.scaleY;
    scaleX = transform.scaleX * factor;
    scaleY = transform.scaleY * factor;
  }
  const kept = keepOpposite(transform, corner, scaleX, scaleY, source);
  return { ...transform, scaleX: bounded(scaleX), scaleY: bounded(scaleY), ...kept };
}

/**
 * Turned so that the pointer sits where the handle was grabbed.
 *
 * `from` and `to` are both measured from the centre of the picture, so this is the angle between
 * two rays and not a delta anyone has to accumulate — a drag that leaves the window and comes
 * back lands where the pointer is rather than where it would have been.
 */
export function rotatedTo(transform: Transform, from: Point, to: Point, snapTo = 0): Transform {
  const before = Math.atan2(from.y, from.x);
  const after = Math.atan2(to.y, to.x);
  const turned = ((after - before) * 180) / Math.PI;
  const raw = transform.rotation + turned;
  const rotation = snapTo > 0 ? Math.round(raw / snapTo) * snapTo : raw;
  return { ...transform, rotation: wrapped(rotation) };
}

// A corner handle holds the corner across from it still. Scaling alone moves both, because the
// picture grows about its anchor, so the position has to take back exactly what the growth added.
function keepOpposite(
  transform: Transform,
  corner: number,
  scaleX: number,
  scaleY: number,
  source: Size,
): Point {
  const opposite = (corner + 2) % 4;
  const before = clipQuad(transform, source)[opposite];
  const after = clipQuad({ ...transform, scaleX: bounded(scaleX), scaleY: bounded(scaleY) }, source)[
    opposite
  ];
  if (before === undefined || after === undefined) return { x: transform.x, y: transform.y };
  return { x: transform.x + before.x - after.x, y: transform.y + before.y - after.y };
}

// A picture cannot be turned inside out by a drag, and one scaled to nothing can never be grabbed
// again -- there would be no corner left to take hold of.
const MIN_SCALE = 0.01;

function bounded(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.max(MIN_SCALE, Math.abs(scale));
}

function wrapped(degrees: number): number {
  const turned = degrees % 360;
  return turned > 180 ? turned - 360 : turned <= -180 ? turned + 360 : turned;
}
