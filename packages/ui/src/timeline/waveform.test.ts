import { describe, expect, it } from "vitest";

import type { Peaks } from "@videola/media";

import { waveformPath } from "./waveform";

const given = (max: number[], min: number[]): Peaks => ({
  max: Float32Array.from(max),
  min: Float32Array.from(min),
});

describe("waveformPath", () => {
  it("runs down the peaks and back along the troughs as one closed shape", () => {
    const d = waveformPath(given([1, 1], [-1, -1]));

    expect(d).toBe("M0 0L1 0L1 2L0 2Z");
  });

  it("puts full scale on the edges of the box and silence on the centre line", () => {
    const d = waveformPath(given([1, 0], [-1, 0]));

    expect(d).toContain("0 0");
    expect(d).toContain("0 2");
    expect(d).toContain("1 0.99");
    expect(d).toContain("1 1.01");
  });

  // A strip with a gap in it reads as data that failed to load, not as a quiet passage.
  it("leaves a hairline where the signal is silent", () => {
    const d = waveformPath(given([0], [0]));

    expect(d).toBe("M0 0.99L0 1.01Z");
  });

  it("keeps samples past full scale inside the box", () => {
    const d = waveformPath(given([1.8], [-1.8]));

    expect(d).toBe("M0 0L0 2Z");
  });

  it("survives a sample that is not a number", () => {
    const d = waveformPath(given([Number.NaN], [Number.NaN]));

    expect(d).toBe("M0 0.99L0 1.01Z");
  });

  // The component asks for a path before the decode has finished, and an empty string is what makes
  // it render nothing at all rather than a flat line promising a signal it has not got.
  it("has no path for no peaks", () => {
    expect(waveformPath(given([], []))).toBe("");
  });

  it("draws only the buckets both halves agree on", () => {
    const d = waveformPath(given([1, 1, 1], [-1]));

    expect(d).toBe("M0 0L0 2Z");
  });
});
