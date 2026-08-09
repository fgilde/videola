import { describe, expect, it } from "vitest";

import { measure, SCOPE_LEVELS, VECTOR_SIZE, VECTOR_TARGETS } from "./scopes";

// A buffer the way readPixels hands one over: premultiplied RGBA, four bytes a pixel.
function buffer(width: number, height: number, pixel: (x: number, y: number) => number[]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    bytes.set(pixel(i % width, Math.floor(i / width)), i * 4);
  }
  return bytes;
}

const OPAQUE = (r: number, g: number, b: number): number[] => [r, g, b, 255];

function spikes(counts: Uint32Array): number[] {
  const found: number[] = [];
  counts.forEach((count, level) => {
    if (count > 0) found.push(level);
  });
  return found;
}

describe("a reading of a flat picture", () => {
  const reading = measure(buffer(8, 4, () => OPAQUE(64, 128, 192)), 8, 4);

  // The one claim a histogram makes: how often each level occurs. A flat colour occurs everywhere.
  it("puts every pixel of a solid colour on one bar per channel", () => {
    expect(spikes(reading.histogram.red)).toEqual([64]);
    expect(spikes(reading.histogram.green)).toEqual([128]);
    expect(spikes(reading.histogram.blue)).toEqual([192]);
    expect(reading.histogram.red[64]).toBe(32);
  });

  // Rec.709 on 64/128/192 is 0.2126*64 + 0.7152*128 + 0.0722*192 = 119.1.
  it("weighs brightness the way a waveform monitor does, not as a plain average", () => {
    expect(spikes(reading.histogram.luma)).toEqual([119]);
    expect(reading.range).toEqual([119, 119]);
  });

  it("counts every pixel it was given", () => {
    expect(reading.measured).toBe(32);
  });

  it("lays the same bar under every column of the waveform", () => {
    expect(reading.columns).toBe(8);
    for (let column = 0; column < 8; column += 1) {
      expect(spikes(reading.waveform.subarray(column * SCOPE_LEVELS, (column + 1) * SCOPE_LEVELS)))
        .toEqual([119]);
    }
  });
});

describe("a waveform", () => {
  // What tells a waveform from a histogram: where in the frame the tone is. A picture that is dark
  // on the left and bright on the right has the same histogram as one that is the other way round.
  it("reports each column of the frame separately", () => {
    const reading = measure(buffer(4, 2, (x) => OPAQUE(x * 60, x * 60, x * 60)), 4, 2);
    const at = (column: number): number[] =>
      spikes(reading.waveform.subarray(column * SCOPE_LEVELS, (column + 1) * SCOPE_LEVELS));

    expect(at(0)).toEqual([0]);
    expect(at(1)).toEqual([60]);
    expect(at(2)).toEqual([120]);
    expect(at(3)).toEqual([180]);
  });

  // A column that carries two different tones has to show both, or the scope is reporting an
  // average and a clipped highlight over a dark field disappears into a midtone.
  it("stacks every tone a column carries rather than averaging them", () => {
    const reading = measure(buffer(2, 2, (_x, y) => OPAQUE(y === 0 ? 0 : 255, y === 0 ? 0 : 255, y === 0 ? 0 : 255)), 2, 2);
    const column = spikes(reading.waveform.subarray(0, SCOPE_LEVELS));

    expect(column).toEqual([0, 255]);
    expect(reading.range).toEqual([0, 255]);
  });
});

describe("a vectorscope", () => {
  // A grey has no colour to plot, so it lands on the point where the two chroma axes cross. That
  // is the reading that says "this picture is neutral", and it is the one everybody looks for.
  it("puts every neutral pixel on the middle of the plane", () => {
    const reading = measure(buffer(4, 4, () => OPAQUE(128, 128, 128)), 4, 4);
    const lit = [...reading.vectorscope].filter((count) => count > 0);

    expect(lit).toEqual([16]);
    const middle = Math.round(0.5 * (VECTOR_SIZE - 1));
    expect(reading.vectorscope[middle * VECTOR_SIZE + middle]).toBe(16);
  });

  // And what the graticule is for: a saturated colour lands on its own target rather than
  // somewhere on the plane that only the code knows about.
  it("puts a colour bar on the box that is drawn for it", () => {
    for (const target of VECTOR_TARGETS) {
      const bar = [
        target.name === "R" || target.name === "Y" || target.name === "M" ? 191 : 0,
        target.name === "G" || target.name === "Y" || target.name === "C" ? 191 : 0,
        target.name === "B" || target.name === "C" || target.name === "M" ? 191 : 0,
      ];
      const reading = measure(buffer(2, 2, () => OPAQUE(bar[0]!, bar[1]!, bar[2]!)), 2, 2);
      const column = Math.round(target.x * (VECTOR_SIZE - 1));
      const row = Math.round(target.y * (VECTOR_SIZE - 1));
      // On the box rather than on one point of it: a bar drawn in whole bytes is a fraction of a
      // level off the three-quarter amplitude the target is worked out from, and a graticule box
      // is a box for exactly that reason.
      let inside = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          inside += reading.vectorscope[(row + dy) * VECTOR_SIZE + column + dx] ?? 0;
        }
      }

      expect(inside, target.name).toBe(4);
    }
  });

  it("keeps the six targets apart and off the middle", () => {
    const places = new Set(VECTOR_TARGETS.map((target) => `${target.x.toFixed(3)},${target.y.toFixed(3)}`));
    expect(places.size).toBe(6);
    for (const target of VECTOR_TARGETS) {
      expect(Math.hypot(target.x - 0.5, target.y - 0.5)).toBeGreaterThan(0.1);
    }
  });
});

describe("coverage", () => {
  // The chain carries premultiplied colour. Reading it as if it were straight makes a
  // half-transparent white read as a mid grey, and a scope that cannot be trusted about a title
  // over a picture is a scope.
  it("reads the colour a pixel has, not the colour times its coverage", () => {
    const reading = measure(buffer(2, 2, () => [128, 128, 128, 128]), 2, 2);

    expect(spikes(reading.histogram.red)).toEqual([255]);
    expect(reading.measured).toBe(4);
  });

  // Where nothing was drawn there is no colour to report. Counting it as black is what makes an
  // empty frame read as a well exposed one with the lens cap on.
  it("leaves out what was never drawn rather than counting it as black", () => {
    const reading = measure(buffer(4, 4, (x) => (x < 2 ? [0, 0, 0, 0] : OPAQUE(200, 200, 200))), 4, 4);

    expect(reading.measured).toBe(8);
    expect(spikes(reading.histogram.luma)).toEqual([200]);
    expect(reading.histogram.luma[0]).toBe(0);
  });

  // Scope and empty picture, crossed: the reading has to come out empty rather than out of a
  // division by nought, because a panel that divides by the count is what draws it.
  it("comes back empty from a frame nothing was drawn into", () => {
    const reading = measure(buffer(4, 4, () => [0, 0, 0, 0]), 4, 4);

    expect(reading.measured).toBe(0);
    expect(reading.range).toBeUndefined();
    expect([...reading.histogram.luma].every((count) => count === 0)).toBe(true);
    expect([...reading.vectorscope].every((count) => count === 0)).toBe(true);
  });

  it("comes back empty from no pixels at all", () => {
    const reading = measure(new Uint8Array(0), 0, 0);

    expect(reading.measured).toBe(0);
    expect(reading.columns).toBe(0);
    expect(reading.waveform).toHaveLength(0);
  });

  // A buffer shorter than the size it claims is what a read from a lost context hands back. The
  // walk has to stop at the bytes rather than at the claim.
  it("reads no further than the bytes it was given", () => {
    const reading = measure(buffer(2, 1, () => OPAQUE(255, 255, 255)), 4, 4);

    expect(reading.measured).toBe(2);
  });
});
