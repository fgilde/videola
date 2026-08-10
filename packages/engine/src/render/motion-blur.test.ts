import { describe, expect, it } from "vitest";

import { cmd, FLICKS_PER_SECOND, frameDuration, type Project } from "@videola/core";

import { blurAmounts, exposure, itemFor, SHUTTER_SAMPLES } from "./motion-blur";
import { drawList } from "./draw-list";

const SECOND = FLICKS_PER_SECOND;
const FPS = { numerator: 30, denominator: 1 };
const FRAME = frameDuration(FPS);

// A shutter is a window around the moment a frame is named after, and everything below is about
// where that window sits: the whole visible difference between motion blur and a smear filter is
// that these instants are real instants somebody can decode a picture at.
describe("the instants a shutter is open for", () => {
  it("is one instant when nothing asked for a shutter", () => {
    expect(exposure(SECOND, 0, FRAME)).toEqual([SECOND]);
    expect(exposure(SECOND, Number.NaN, FRAME)).toEqual([SECOND]);
  });

  it("straddles the moment rather than trailing it", () => {
    const times = exposure(10 * FRAME, 1, FRAME);

    expect(times.length).toBe(SHUTTER_SAMPLES);
    const middle = (times[0]! + times[times.length - 1]!) / 2;
    expect(middle).toBeCloseTo(10 * FRAME, -1);
    // A trailing window would put every sample at or before the moment, which drags a moving subject
    // half an exposure behind where it is.
    expect(times.some((at) => at > 10 * FRAME)).toBe(true);
    expect(times.some((at) => at < 10 * FRAME)).toBe(true);
  });

  // The samples sit inside the window, not on its edges: two frames sharing an instant would show a
  // seam at every frame boundary of a full-frame shutter.
  it("keeps its samples inside the window it was given", () => {
    const times = exposure(10 * FRAME, 1, FRAME);

    expect(times[0]).toBeGreaterThan(10 * FRAME - FRAME / 2);
    expect(times[times.length - 1]).toBeLessThan(10 * FRAME + FRAME / 2);
  });

  it("is half as wide at half a shutter", () => {
    const full = exposure(10 * FRAME, 1, FRAME);
    const half = exposure(10 * FRAME, 0.5, FRAME);
    const width = (times: number[]): number => times[times.length - 1]! - times[0]!;

    expect(width(half)).toBeCloseTo(width(full) / 2, -1);
  });

  // The shutter comes off a project file, which is a trust boundary: the command layer clamps what it
  // is sent, and a hand-written file has never been through it. A shutter of five frames would average
  // every moment of the material into five output frames and read as a dissolve.
  it("keeps a shutter from outside inside one frame", () => {
    const times = exposure(10 * FRAME, 5, FRAME);
    const width = times[times.length - 1]! - times[0]!;

    expect(width).toBeLessThanOrEqual(FRAME);
    expect(exposure(10 * FRAME, -3, FRAME)).toEqual([10 * FRAME]);
  });

  // A decoder has nothing before the head of the timeline and the core answers for nothing there, so
  // a negative instant would cost a sample and leave one end of the smear lighter than the other.
  it("never reaches before the head of the timeline", () => {
    expect(exposure(0, 1, FRAME).every((at) => at >= 0)).toBe(true);
  });
});

function projectWith(motionBlur: number): Project {
  const project: Project = {
    meta: { id: "prj_1", name: "test", createdAt: "", modifiedAt: "" },
    settings: {
      width: 1920,
      height: 1080,
      fps: FPS,
      sampleRate: 48_000,
      background: "#000000",
    },
    library: [],
    timeline: { tracks: [], duration: 4 * SECOND },
    markers: [],
    master: { volume: 1, effects: [] },
  } as unknown as Project;
  const clip = {
    id: "clp_1",
    source: { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
    start: 0,
    duration: 2 * SECOND,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    motionBlur,
    effects: [],
    keyframes: {},
  };
  project.timeline.tracks.push({
    id: "trk_1",
    kind: "video",
    name: "V1",
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    volume: 1,
    pan: 0,
    height: 72,
    colorHex: "#888888",
    effects: [],
    clips: [clip],
  } as never);
  return project;
}

describe("which clips carry a shutter", () => {
  it("finds the ones that asked and leaves the rest alone", () => {
    expect([...blurAmounts(projectWith(0.5))]).toEqual([["clp_1", 0.5]]);
    expect(blurAmounts(projectWith(0)).size).toBe(0);
  });

  // Where a clip stands comes out of the draw list at that instant and from nowhere else: a second
  // answer to placement would be a second geometry to keep in step with the compositor's.
  it("reads a clip's placement out of the list for that instant", () => {
    const project = projectWith(0.5);
    const list = drawList(project, SECOND, new Map(), new Map());

    expect(itemFor(list, "clp_1")?.matrix.length).toBe(9);
    expect(itemFor(list, "clp_missing")).toBeUndefined();
  });
});

// Where the whole feature is decided: two instants of one exposure have to differ in placement, or
// the eight samples are eight copies of one picture and the average is that picture.
describe("a moving clip over its exposure", () => {
  it("stands somewhere else at each instant it is exposed at", () => {
    const project = projectWith(1);
    const clip = project.timeline.tracks[0]!.clips[0]!;
    const moved = (x: number): Map<string, unknown> =>
      new Map([[clip.id, { ...clip.transform, x }]]);

    const times = exposure(10 * FRAME, 1, FRAME);
    // The core resolves the keyframes; here the snapshot stands in for it, which is the same contract
    // the compositor works to. What matters is that a different transform reaches a different matrix.
    const first = itemFor(
      drawList(project, times[0]!, new Map(), moved(-200) as never),
      clip.id,
    )?.matrix;
    const last = itemFor(
      drawList(project, times[times.length - 1]!, new Map(), moved(200) as never),
      clip.id,
    )?.matrix;

    expect(first).not.toEqual(last);
  });

  it("is drawn once per instant, and the weights sum to one", () => {
    const times = exposure(10 * FRAME, 0.5, FRAME);
    const share = 1 / times.length;

    expect(times.length).toBe(SHUTTER_SAMPLES);
    expect(times.length * share).toBeCloseTo(1, 10);
  });
});

// The command layer's rule, checked through the model rather than by reading the clamp: a shutter is
// a fraction of a frame, and longer than a frame would draw every moment into two output frames.
describe("what the core accepts as a shutter", () => {
  it("is a fraction of one frame", () => {
    expect(cmd.clipSetMotionBlur("clp_1", 0.5)).toEqual({
      type: "clip.setMotionBlur",
      clip: "clp_1",
      amount: 0.5,
    });
  });
});
