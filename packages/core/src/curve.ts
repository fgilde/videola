/**
 * A tone curve, from the control points a person drags to the numbers something else needs.
 *
 * It sits in `@videola/core` rather than in the engine because two very different consumers need
 * exactly the same answer out of it: the renderer samples it into the table its shader reads, and
 * the curve editor draws the line the user is dragging. A second implementation on the drawing
 * side would be a curve that looks like one thing and grades like another -- the one bug a curve
 * tool must not have.
 *
 * This is not keyframe resolution. Which points the curve has at a moment in time is the core's
 * answer and comes out of Rust; what those points mean for one tone is arithmetic with no time in
 * it, the same seam a colour is clamped and premultiplied at.
 */

/**
 * How many samples a shader's table carries.
 *
 * Thirty-two rather than the 256 an eight-bit reflex asks for. The table is read with a linear
 * interpolation between its entries, and the error that leaves is bounded by the curve's own
 * bend: an S-curve steep enough to be worth drawing is off by well under half of one 8-bit level
 * between two samples. 256 floats per channel, four channels, would also be a thousand uniform
 * components -- the whole budget a driver has to promise.
 */
export const CURVE_SAMPLES = 32;

/** The curve that changes nothing: out equals in, from black to white. */
export const IDENTITY_CURVE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
];

/**
 * The control points as the sampler will actually read them: finite, inside the unit square and in
 * ascending order of input.
 *
 * A project file is written by hand as often as by this application, so nothing here assumes the
 * points arrived sorted or in range. Points are dropped rather than the whole curve rejected --
 * the core already refused the two faults that matter (a non-finite number, a list longer than
 * anyone drags), and a curve with one stray point still has a shape worth showing.
 */
export function readableCurve(
  value: unknown,
  fallback: readonly (readonly [number, number])[] = IDENTITY_CURVE,
): readonly (readonly [number, number])[] {
  if (!Array.isArray(value)) return fallback;
  const points: [number, number][] = [];
  for (const point of value as unknown[]) {
    if (!Array.isArray(point) || point.length !== 2) continue;
    const [x, y] = point as unknown[];
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([clamp01(x), clamp01(y)]);
  }
  if (points.length === 0) return fallback;
  // A stable sort, so two points a user dragged onto the same input keep the order they were
  // authored in rather than swapping about as the curve is redrawn.
  points.sort((a, b) => a[0] - b[0]);
  return points;
}

/**
 * The curve's output for one input, both in 0..1.
 *
 * Monotone cubic between the points -- Fritsch-Carlson -- and not a plain cubic spline. The
 * difference is the whole reason to write more than four lines here: an ordinary spline through
 * three points a colourist would actually place overshoots between them, and an overshoot on a
 * tone curve is a bright rim along every edge where the picture crossed that tone. Monotone
 * limiting gives that up and can never leave the box its neighbouring points make.
 *
 * Outside the outermost points the curve is flat rather than extrapolated: a control point at
 * 0.2 says what happens at 0.2, and guessing a slope past the end of what was drawn is how a
 * curve that looked tame in the editor clips the blacks.
 */
export function curveAt(points: readonly (readonly [number, number])[], input: number): number {
  const at = clamp01(input);
  const last = points.length - 1;
  if (last < 0) return at;
  if (last === 0 || at <= points[0]![0]) return points[0]![1];
  if (at >= points[last]![0]) return points[last]![1];

  const tangents = monotoneTangents(points);
  let i = 0;
  while (i < last - 1 && at > points[i + 1]![0]) i += 1;
  const [x0, y0] = points[i]!;
  const [x1, y1] = points[i + 1]!;
  const span = x1 - x0;
  // Two points on the same input are a vertical step. There is no slope to take, so the later
  // point wins -- which is what the drawing does too, and a division here would be a NaN that
  // reaches a uniform and paints the clip black.
  if (span <= 0) return y1;
  const t = (at - x0) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * span * tangents[i]! +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * span * tangents[i + 1]!
  );
}

/**
 * The curve as the evenly spaced table a shader indexes, `size` entries from black to white.
 *
 * Flat where the table has nothing to say: an empty list of points is the identity, so an effect
 * whose parameter a project file left out does nothing rather than painting black.
 */
export function curveTable(
  points: readonly (readonly [number, number])[],
  size: number = CURVE_SAMPLES,
): number[] {
  const table: number[] = [];
  for (let i = 0; i < size; i += 1) {
    table.push(clamp01(curveAt(points, i / (size - 1))));
  }
  return table;
}

// The slope the curve is given at each point, limited so no segment can leave the box between its
// two ends. Without the limiting step this is the ordinary Catmull-Rom tangent and overshoots.
function monotoneTangents(points: readonly (readonly [number, number])[]): number[] {
  const last = points.length - 1;
  const secants: number[] = [];
  for (let i = 0; i < last; i += 1) {
    const run = points[i + 1]![0] - points[i]![0];
    secants.push(run <= 0 ? 0 : (points[i + 1]![1] - points[i]![1]) / run);
  }
  const tangents: number[] = [secants[0] ?? 0];
  for (let i = 1; i < last; i += 1) tangents.push((secants[i - 1]! + secants[i]!) / 2);
  tangents.push(secants[last - 1] ?? 0);

  for (let i = 0; i < last; i += 1) {
    const secant = secants[i]!;
    // A flat segment must stay flat at both ends, or the curve dips out of it and back.
    if (secant === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / secant;
    const b = tangents[i + 1]! / secant;
    const reach = a * a + b * b;
    if (reach <= 9) continue;
    const scale = 3 / Math.sqrt(reach);
    tangents[i] = scale * a * secant;
    tangents[i + 1] = scale * b * secant;
  }
  return tangents;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
