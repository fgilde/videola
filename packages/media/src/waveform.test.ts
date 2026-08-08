import { describe, expect, it } from "vitest";

import { peaks } from "./waveform";

const ramp = (length: number): Float32Array =>
  Float32Array.from({ length }, (_, i) => i / (length - 1));

describe("peaks", () => {
  it("keeps the extremes of every bucket, not an average", () => {
    const spike = new Float32Array(100);
    spike[50] = 1;
    spike[51] = -1;

    const { min, max } = peaks([spike], 10);

    expect(max[5]).toBe(1);
    expect(min[5]).toBe(-1);
    expect(max[0]).toBe(0);
  });

  it("returns exactly the number of buckets asked for", () => {
    // Sample counts that are no multiple of the bucket count are the normal case: the bucket count
    // is a pixel width. A stride computed by integer division would hand back 2999 buckets for a
    // 2000-pixel strip and paint the tail of the clip off the end of it.
    expect(peaks([ramp(2999)], 2000).max).toHaveLength(2000);
    expect(peaks([ramp(3)], 100).max).toHaveLength(100);
  });

  it("spreads the buckets over the whole signal", () => {
    const { max } = peaks([ramp(1000)], 4);

    expect(max[0]).toBeCloseTo(0.25, 2);
    expect(max[3]).toBeCloseTo(1, 2);
  });

  // The last bucket has to reach the last sample. A stride of `frames / buckets` rounded down
  // divides evenly here and nowhere else, so the tail of a clip falls off the end of the strip for
  // every length that is not a multiple of the pixel width.
  it("reads the last sample of a signal that divides unevenly", () => {
    const clap = new Float32Array(2999);
    clap[2998] = 1;
    clap[0] = -1;

    const { min, max } = peaks([clap], 2000);

    expect(max[1999]).toBe(1);
    expect(min[0]).toBe(-1);
  });

  it("mixes the channels down so a strip shows what a listener hears as one", () => {
    const left = Float32Array.from([1, 1, 1, 1]);
    const right = Float32Array.from([-1, -1, -1, -1]);

    expect(peaks([left, right], 1).max[0]).toBeCloseTo(0, 5);
    // Summing without dividing would read 2 here, which is off the top of any strip.
    expect(peaks([left, left], 1).max[0]).toBeCloseTo(1, 5);
  });

  it("gives up on nothing rather than on a shape a caller has to check", () => {
    expect(peaks([], 4).max).toHaveLength(4);
    expect(peaks([new Float32Array(0)], 4).max).toHaveLength(4);
    expect(peaks([ramp(100)], 0).max).toHaveLength(0);
  });

  // A bucket wider than the signal is what a zoomed-out clip looks like, and a bucket narrower than
  // one sample is what a zoomed-in one looks like. Neither may leave a hole in the strip.
  it("covers every bucket when there are fewer samples than buckets", () => {
    const { min, max } = peaks([Float32Array.from([1, -1])], 6);

    for (let i = 0; i < 6; i += 1) {
      expect(Number.isFinite(min[i]!)).toBe(true);
      expect(Number.isFinite(max[i]!)).toBe(true);
    }
    expect(max[0]).toBe(1);
    expect(min[5]).toBe(-1);
  });
});
