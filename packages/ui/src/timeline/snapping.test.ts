import { describe, expect, it } from "vitest";

import { FLICKS_PER_SECOND, type Project } from "@videola/core";

import { snapCandidates, snapSpan, snapTime, type SnapCandidate } from "./snapping";

const SECOND = FLICKS_PER_SECOND;
const WIDE: SnapOptionsFixture = { radiusPx: 10, flicksPerPixel: 1000 };

interface SnapOptionsFixture {
  radiusPx: number;
  flicksPerPixel: number;
  gridStep?: number;
}

describe("snapTime", () => {
  const candidates: SnapCandidate[] = [
    { time: 100_000, kind: "clipEdge" },
    { time: 200_000, kind: "marker" },
  ];

  it("pulls to the nearest candidate inside the radius", () => {
    expect(snapTime(105_000, candidates, WIDE)).toEqual({
      time: 100_000,
      candidate: { time: 100_000, kind: "clipEdge" },
    });
  });

  it("leaves the value alone and reports nothing when no candidate is near", () => {
    expect(snapTime(150_000, candidates, WIDE)).toEqual({ time: 150_000 });
  });

  // The whole point of measuring the radius in pixels: the same gap in flicks is a different
  // gap on screen at a different zoom, and a radius kept in flicks would swallow whole seconds.
  it("keeps the radius constant in pixels across zoom levels", () => {
    const gap = 9_000;
    expect(snapTime(100_000 + gap, candidates, { radiusPx: 10, flicksPerPixel: 1000 }).candidate)
      .toBeDefined();
    expect(snapTime(100_000 + gap, candidates, { radiusPx: 10, flicksPerPixel: 100 }).candidate)
      .toBeUndefined();
  });

  it("prefers the more deliberate line when two are equally close", () => {
    const tied: SnapCandidate[] = [
      { time: 90_000, kind: "grid" },
      { time: 110_000, kind: "playhead" },
    ];
    expect(snapTime(100_000, tied, WIDE).candidate?.kind).toBe("playhead");
  });

  it("offers the nearest grid line when a grid step is given", () => {
    expect(snapTime(102_000, [], { ...WIDE, gridStep: 50_000 })).toEqual({
      time: 100_000,
      candidate: { time: 100_000, kind: "grid" },
    });
  });

  // A zero step falls out as NaN on its own, but a negative one produces perfectly plausible
  // grid lines running backwards - only the guard keeps that out.
  it("ignores a degenerate grid step instead of building a grid from it", () => {
    expect(snapTime(102_000, [], { ...WIDE, gridStep: 0 })).toEqual({ time: 102_000 });
    expect(snapTime(102_000, [], { ...WIDE, gridStep: -50_000 })).toEqual({ time: 102_000 });
  });

  it("snaps nothing when the radius is zero, which is how snapping gets turned off", () => {
    expect(snapTime(100_001, candidates, { radiusPx: 0, flicksPerPixel: 1000 }).candidate)
      .toBeUndefined();
  });
});

describe("snapSpan", () => {
  const neighbour: SnapCandidate[] = [{ time: 300_000, kind: "clipEdge" }];

  it("snaps the trailing edge when it is the closer one", () => {
    const result = snapSpan(196_000, 100_000, neighbour, WIDE);
    expect(result.time).toBe(200_000);
    expect(result.candidate).toEqual({ time: 300_000, kind: "clipEdge" });
  });

  it("snaps the leading edge when that is the closer one", () => {
    const result = snapSpan(296_000, 100_000, neighbour, WIDE);
    expect(result.time).toBe(300_000);
  });

  it("leaves the span alone when neither edge is near anything", () => {
    expect(snapSpan(0, 100_000, neighbour, WIDE)).toEqual({ time: 0 });
  });
});

describe("snapCandidates", () => {
  function project(): Project {
    return {
      timeline: {
        tracks: [
          { id: "trk_1", clips: [{ id: "clp_1", start: 0, duration: SECOND }] },
          { id: "trk_2", clips: [{ id: "clp_2", start: 2 * SECOND, duration: SECOND }] },
        ],
      },
      markers: [
        { id: "mrk_1", time: 5 * SECOND, label: "m", colorHex: "#fff" },
        { id: "mrk_2", time: 900 * SECOND, label: "far", colorHex: "#fff" },
      ],
    } as unknown as Project;
  }

  const range = { from: 0, to: 10 * SECOND };

  it("collects both edges of every clip on every track", () => {
    const times = snapCandidates(project(), { range })
      .filter((candidate) => candidate.kind === "clipEdge")
      .map((candidate) => candidate.time);
    expect(times).toEqual([0, SECOND, 2 * SECOND, 3 * SECOND]);
  });

  it("leaves out the clip being dragged, so it cannot snap to itself", () => {
    const times = snapCandidates(project(), { range, exclude: "clp_1" })
      .filter((candidate) => candidate.kind === "clipEdge")
      .map((candidate) => candidate.time);
    expect(times).toEqual([2 * SECOND, 3 * SECOND]);
  });

  it("includes the playhead only when one is given", () => {
    expect(snapCandidates(project(), { range }).some((c) => c.kind === "playhead")).toBe(false);
    expect(
      snapCandidates(project(), { range, playhead: SECOND }).some((c) => c.kind === "playhead"),
    ).toBe(true);
  });

  it("keeps the list to what is on screen", () => {
    const markers = snapCandidates(project(), { range }).filter((c) => c.kind === "marker");
    expect(markers).toEqual([{ time: 5 * SECOND, kind: "marker" }]);
  });
});
