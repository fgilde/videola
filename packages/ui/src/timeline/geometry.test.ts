import { describe, expect, it } from "vitest";

import { FLICKS_PER_SECOND, type Clip, type Rate, type Track } from "@videola/core";

import {
  clampZoom,
  clipsInRange,
  frameDuration,
  MAX_ELEMENT_WIDTH_PX,
  MAX_FLICKS_PER_PIXEL,
  MIN_FLICKS_PER_PIXEL,
  rulerTicks,
  tickStep,
  timeToX,
  trackAt,
  trackHeight,
  trimZoneWidth,
  visibleRange,
  xToTime,
} from "./geometry";

const NTSC: Rate = { numerator: 30000, denominator: 1001 };
const PAL: Rate = { numerator: 25, denominator: 1 };

function clip(start: number, duration: number, id = "clp_x"): Clip {
  return { id, start, duration } as Clip;
}

function track(height: number, id = "trk_x"): Track {
  return { id, height } as Track;
}

describe("zoom", () => {
  it("keeps a sane value untouched", () => {
    expect(clampZoom(1_000_000)).toBe(1_000_000);
  });

  it("clamps beyond both ends", () => {
    expect(clampZoom(1)).toBe(MIN_FLICKS_PER_PIXEL);
    expect(clampZoom(Number.MAX_VALUE)).toBe(MAX_FLICKS_PER_PIXEL);
  });

  it("turns a non-finite zoom into the finest supported one instead of NaN", () => {
    expect(clampZoom(Number.NaN)).toBe(MIN_FLICKS_PER_PIXEL);
    expect(clampZoom(0)).toBe(MIN_FLICKS_PER_PIXEL);
  });

  // The content element is as wide as the project, so the zoom floor has to rise with the
  // project length. A fixed floor put a 24 hour project at 305 million pixels, ten times past
  // what a browser still lays out - it would have scrolled to a silently truncated end.
  it("keeps even the longest project the core accepts inside the element width", () => {
    for (const hours of [1, 6, 24]) {
      const duration = hours * 3600 * FLICKS_PER_SECOND;
      expect(timeToX(duration, clampZoom(1, duration))).toBeLessThanOrEqual(MAX_ELEMENT_WIDTH_PX);
    }
  });

  it("does not raise the floor for a project that fits anyway", () => {
    expect(clampZoom(1, 60 * FLICKS_PER_SECOND)).toBe(MIN_FLICKS_PER_PIXEL);
  });
});

describe("pixel and flick conversion", () => {
  it("round-trips a position", () => {
    expect(xToTime(timeToX(1_234_567_890, 1000), 1000)).toBe(1_234_567_890);
  });

  it("yields whole flicks even for a fractional pixel", () => {
    expect(Number.isInteger(xToTime(12.7, 333))).toBe(true);
  });
});

describe("visibleRange", () => {
  it("covers the viewport plus overscan on both sides", () => {
    expect(visibleRange(1000, 800, 1000, 200)).toEqual({ from: 800_000, to: 2_000_000 });
  });

  it("never reports a negative start", () => {
    expect(visibleRange(0, 800, 1000, 200).from).toBe(0);
  });
});

describe("clipsInRange", () => {
  const clips = [clip(0, 100, "a"), clip(100, 100, "b"), clip(1000, 100, "c")];

  it("keeps a clip that overlaps the window", () => {
    expect(clipsInRange(clips, { from: 150, to: 160 }).map((c) => c.id)).toEqual(["b"]);
  });

  it("treats clip bounds as half open, the same way the compositor does", () => {
    expect(clipsInRange(clips, { from: 100, to: 101 }).map((c) => c.id)).toEqual(["b"]);
  });

  it("drops everything outside the window", () => {
    expect(clipsInRange(clips, { from: 300, to: 400 })).toEqual([]);
  });
});

describe("tickStep", () => {
  it("grows the step so labels keep their minimum spacing", () => {
    const step = tickStep(1_000_000, PAL, 90);
    expect(step / 1_000_000).toBeGreaterThanOrEqual(90);
  });

  it("picks a whole frame when frames are wide enough on screen", () => {
    const frame = frameDuration(PAL);
    expect(tickStep(frame / 200, PAL, 90)).toBe(frame);
  });

  it("stays on whole seconds once frames are too dense", () => {
    expect(tickStep(FLICKS_PER_SECOND / 100, PAL, 90) % FLICKS_PER_SECOND).toBe(0);
  });

  it("derives the frame duration from the rational rate, not from a rounded one", () => {
    expect(frameDuration(NTSC)).toBe(Math.round((FLICKS_PER_SECOND * 1001) / 30000));
    expect(frameDuration(NTSC)).not.toBe(Math.round(FLICKS_PER_SECOND / 30));
  });

  it("survives a degenerate rate instead of returning NaN", () => {
    expect(frameDuration({ numerator: 30, denominator: 0 })).toBe(FLICKS_PER_SECOND);
  });
});

describe("rulerTicks", () => {
  it("starts at the first multiple inside the range", () => {
    expect(rulerTicks({ from: 250, to: 1000 }, 300)).toEqual([300, 600, 900]);
  });

  it("returns nothing for a degenerate step instead of looping", () => {
    expect(rulerTicks({ from: 0, to: 100 }, 0)).toEqual([]);
  });
});

describe("trackAt", () => {
  // tracks[0] is the bottom row, because the compositor draws index 0 lowest.
  const tracks = [track(72, "a"), track(72, "b"), track(100, "c")];

  it("maps the top of the area to the last track", () => {
    expect(trackAt(tracks, 0)).toBe(2);
  });

  it("maps the bottom of the area to tracks[0]", () => {
    expect(trackAt(tracks, 243)).toBe(0);
  });

  it("respects individual track heights", () => {
    expect(trackAt(tracks, 99)).toBe(2);
    expect(trackAt(tracks, 101)).toBe(1);
  });

  it("clamps above and below the area", () => {
    expect(trackAt(tracks, -500)).toBe(2);
    expect(trackAt(tracks, 5000)).toBe(0);
  });

  it("reports no row for an empty timeline", () => {
    expect(trackAt([], 10)).toBe(-1);
  });

  it("never lets a track row fall below the touch target", () => {
    expect(trackHeight(track(4))).toBeGreaterThanOrEqual(44);
  });
});

describe("trimZoneWidth", () => {
  it("gives a finger the full zone on a wide clip", () => {
    expect(trimZoneWidth(600, 44)).toBe(44);
  });

  it("never lets the two zones swallow the clip body", () => {
    expect(trimZoneWidth(60, 44)).toBe(20);
  });

  it("stays grabbable on a hairline clip", () => {
    expect(trimZoneWidth(1, 44)).toBeGreaterThan(0);
  });
});
