import { describe, expect, it } from "vitest";

import { CURVE_SAMPLES, curveAt, curveTable, IDENTITY_CURVE, readableCurve } from "./curve";

const S_CURVE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.25, 0.15],
  [0.75, 0.85],
  [1, 1],
];

describe("a tone curve", () => {
  it("passes its own control points through untouched", () => {
    for (const [x, y] of S_CURVE) expect(curveAt(S_CURVE, x)).toBeCloseTo(y, 6);
  });

  it("leaves the picture alone when it is the straight line", () => {
    for (const at of [0, 0.1, 0.37, 0.5, 0.82, 1]) {
      expect(curveAt(IDENTITY_CURVE, at)).toBeCloseTo(at, 6);
    }
  });

  // The whole point of an S: it pulls the shadows down and the highlights up, and the two halves
  // are the mirror of each other about mid grey.
  it("darkens below the middle and lightens above it", () => {
    expect(curveAt(S_CURVE, 0.125)).toBeLessThan(0.125);
    expect(curveAt(S_CURVE, 0.875)).toBeGreaterThan(0.875);
    expect(curveAt(S_CURVE, 0.5)).toBeCloseTo(0.5, 6);
    expect(curveAt(S_CURVE, 0.125) + curveAt(S_CURVE, 0.875)).toBeCloseTo(1, 6);
  });

  // A curve is smooth or it is a set of straight segments with visible kinks in every gradient.
  // Straight lines between the points would put this sample at 0.09; the curve puts it lower,
  // because it is still flattening out of the origin.
  it("bends between its points rather than joining them with straight lines", () => {
    const straight = 0.15 * (0.15 / 0.25);
    expect(curveAt(S_CURVE, 0.15)).toBeLessThan(straight - 0.005);
  });

  // The reason for monotone limiting rather than an ordinary spline. A shelf followed by a steep
  // rise makes a plain Catmull-Rom curve dip below the shelf before it climbs, and a dip below the
  // black point of the segment is a dark rim along every edge that crossed that tone.
  it("never leaves the box between two neighbouring points", () => {
    const shelf: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.4, 0.05],
      [0.5, 0.05],
      [0.6, 0.95],
      [1, 1],
    ];
    for (let i = 0; i <= 200; i += 1) {
      const at = i / 200;
      const y = curveAt(shelf, at);
      expect(y, `at ${at}`).toBeGreaterThanOrEqual(0);
      expect(y, `at ${at}`).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i <= 40; i += 1) {
      const at = 0.4 + (i / 40) * 0.1;
      expect(curveAt(shelf, at), `flat at ${at}`).toBeCloseTo(0.05, 6);
    }
  });

  it("never falls where its points rise", () => {
    let previous = -1;
    for (let i = 0; i <= 400; i += 1) {
      const y = curveAt(S_CURVE, i / 400);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = y;
    }
  });

  // Past the outermost point there is nothing drawn, so there is nothing to extrapolate. A curve
  // whose darkest point sits at 0.2 says the same thing about 0.1 as about 0.2.
  it("holds flat outside the points that were drawn", () => {
    const inner: readonly (readonly [number, number])[] = [
      [0.2, 0.4],
      [0.8, 0.6],
    ];
    expect(curveAt(inner, 0)).toBeCloseTo(0.4, 6);
    expect(curveAt(inner, 0.1)).toBeCloseTo(0.4, 6);
    expect(curveAt(inner, 1)).toBeCloseTo(0.6, 6);
  });

  it("is a constant when a single point is all there is", () => {
    const one: readonly (readonly [number, number])[] = [[0.5, 0.25]];
    expect(curveAt(one, 0)).toBeCloseTo(0.25, 6);
    expect(curveAt(one, 1)).toBeCloseTo(0.25, 6);
  });

  // Two points on the same input is a step, not a division by zero: without the guard this is a
  // NaN, and a NaN through a uniform paints the clip black.
  it("takes a vertical step without producing a NaN", () => {
    const step: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.5, 0.2],
      [0.5, 0.8],
      [1, 1],
    ];
    for (let i = 0; i <= 100; i += 1) {
      expect(Number.isFinite(curveAt(step, i / 100))).toBe(true);
    }
    // A step is a step: the tone just below it and the tone just above it land on the two
    // different points, rather than on something averaged between them.
    expect(curveAt(step, 0.499)).toBeLessThan(0.21);
    expect(curveAt(step, 0.501)).toBeGreaterThan(0.79);
  });
});

describe("a curve read off a project file", () => {
  it("puts the points in order of their input", () => {
    expect(
      readableCurve([
        [1, 1],
        [0.5, 0.9],
        [0, 0],
      ]),
    ).toEqual([
      [0, 0],
      [0.5, 0.9],
      [1, 1],
    ]);
  });

  it("brings a point outside the unit square back into it", () => {
    expect(
      readableCurve([
        [-1, 4],
        [2, -3],
      ]),
    ).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("drops what is not a point and keeps what is", () => {
    expect(
      readableCurve([[0, 0], "nonsense", [0.5], [0.5, Number.NaN], [1, 1]]),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("falls back to the identity when nothing readable is left", () => {
    expect(readableCurve(0.5)).toEqual(IDENTITY_CURVE);
    expect(readableCurve([])).toEqual(IDENTITY_CURVE);
    expect(readableCurve(["nonsense"])).toEqual(IDENTITY_CURVE);
  });
});

describe("the table a shader reads", () => {
  it("runs from the curve at black to the curve at white", () => {
    const table = curveTable(S_CURVE);
    expect(table).toHaveLength(CURVE_SAMPLES);
    expect(table[0]).toBeCloseTo(0, 6);
    expect(table[CURVE_SAMPLES - 1]).toBeCloseTo(1, 6);
  });

  // Why 32 entries is enough: the shader mixes between neighbouring samples, and what that costs
  // against the curve itself has to stay under the one 8-bit level anybody could see.
  it("is close enough to the curve that a linear read between its entries cannot be seen", () => {
    const table = curveTable(S_CURVE);
    let worst = 0;
    for (let i = 0; i <= 1000; i += 1) {
      const at = i / 1000;
      const scaled = at * (CURVE_SAMPLES - 1);
      const low = Math.floor(scaled);
      const high = Math.min(low + 1, CURVE_SAMPLES - 1);
      const read = table[low]! + (table[high]! - table[low]!) * (scaled - low);
      worst = Math.max(worst, Math.abs(read - curveAt(S_CURVE, at)));
    }
    expect(worst * 255).toBeLessThan(0.5);
  });

  it("never lets an entry out of the unit range", () => {
    for (const entry of curveTable([[0, 1] as const, [1, 0] as const])) {
      expect(entry).toBeGreaterThanOrEqual(0);
      expect(entry).toBeLessThanOrEqual(1);
    }
  });
});
