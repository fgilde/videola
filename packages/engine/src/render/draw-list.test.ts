import { describe, expect, it } from "vitest";

import type { Clip, MediaAsset, Project, Track, Transform } from "@videola/core";

import { blendState, drawList } from "./draw-list";
import type { DrawItem } from "./draw-list";

const SECOND = 705_600_000;
const VIDEO = `med_${"a".repeat(64)}`;
const SOUND = `med_${"b".repeat(64)}`;
const SQUARE = `med_${"c".repeat(64)}`;

function transform(over: Partial<Transform> = {}): Transform {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: 1,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    ...over,
  };
}

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "clp_1",
    source: { kind: "media", media: VIDEO },
    start: 0,
    duration: SECOND,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: transform(),
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
    ...over,
  } as Clip;
}

function track(id: string, clips: Clip[], over: Partial<Track> = {}): Track {
  return {
    id,
    kind: "video",
    name: id,
    colorHex: "#2EA043",
    height: 64,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    clips,
    effects: [],
    ...over,
  } as Track;
}

function asset(id: string, width: number | null, height: number | null): MediaAsset {
  return {
    id,
    originalName: "clip.mp4",
    mime: "video/mp4",
    kind: width === null ? "audio" : "video",
    sizeBytes: 1n,
    duration: SECOND,
    width,
    height,
  } as MediaAsset;
}

function project(tracks: Track[], width = 1920, height = 1080, background = "#000000"): Project {
  return {
    schemaVersion: 1,
    meta: {},
    settings: {
      width,
      height,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: 48_000,
      colorSpace: "srgb",
      background,
    },
    library: [asset(VIDEO, 1920, 1080), asset(SOUND, null, null), asset(SQUARE, 480, 480)],
    timeline: { tracks },
    markers: [],
    master: { volume: 1, effects: [] },
  } as unknown as Project;
}

// The unit quad runs (0,0) top-left to (1,1) bottom-right; this is where a corner of it lands in
// clipspace, where (-1,-1) is bottom-left.
function corner(item: DrawItem, x: number, y: number): [number, number] {
  const m = (index: number): number => item.matrix[index] ?? Number.NaN;
  // The `+ 0` normalises the negative zero an unrotated matrix carries, which toEqual reports as
  // a difference from zero.
  return [m(0) * x + m(3) * y + m(6) + 0, m(1) * x + m(4) * y + m(7) + 0];
}

const ids = (list: { items: DrawItem[] }): string[] => list.items.map((item) => item.clip);

describe("drawList visibility", () => {
  it("takes a clip that covers the moment and leaves the ones that do not", () => {
    const clips = [
      clip({ id: "clp_before", start: 0, duration: SECOND }),
      clip({ id: "clp_now", start: SECOND, duration: SECOND }),
      clip({ id: "clp_after", start: 2 * SECOND, duration: SECOND }),
    ];
    expect(ids(drawList(project([track("trk_1", clips)]), SECOND + 1))).toEqual(["clp_now"]);
  });

  it("treats a clip as half-open, so the cut between two clips shows exactly one", () => {
    const clips = [
      clip({ id: "clp_a", start: 0, duration: SECOND }),
      clip({ id: "clp_b", start: SECOND, duration: SECOND }),
    ];
    expect(ids(drawList(project([track("trk_1", clips)]), SECOND))).toEqual(["clp_b"]);
  });

  it("draws the tracks in array order, so index zero is the bottom of the stack", () => {
    const lower = track("trk_lower", [clip({ id: "clp_lower" })]);
    const upper = track("trk_upper", [clip({ id: "clp_upper" })]);
    expect(ids(drawList(project([lower, upper]), 0))).toEqual(["clp_lower", "clp_upper"]);
  });

  it("skips a hidden track", () => {
    const hidden = track("trk_1", [clip()], { hidden: true });
    expect(ids(drawList(project([hidden]), 0))).toEqual([]);
  });

  it("skips an audio track even when its clip points at a video medium", () => {
    const audio = track("trk_1", [clip()], { kind: "audio" });
    expect(ids(drawList(project([audio]), 0))).toEqual([]);
  });

  it("skips a clip whose medium has no picture", () => {
    const silent = clip({ source: { kind: "media", media: SOUND } });
    expect(ids(drawList(project([track("trk_1", [silent])]), 0))).toEqual([]);
  });

  it("skips a fully transparent clip instead of drawing a no-op", () => {
    const invisible = clip({ transform: transform({ opacity: 0 }) });
    expect(ids(drawList(project([track("trk_1", [invisible])]), 0))).toEqual([]);
  });

  it("skips a clip that is cropped down to nothing", () => {
    const gone = clip({ transform: transform({ crop: { left: 0.6, top: 0, right: 0.5, bottom: 0 } }) });
    expect(ids(drawList(project([track("trk_1", [gone])]), 0))).toEqual([]);
  });
});

describe("drawList geometry", () => {
  const only = (clips: Clip[], width = 1920, height = 1080): DrawItem => {
    const list = drawList(project([track("trk_1", clips)], width, height), 0);
    const [item] = list.items;
    if (item === undefined) throw new Error("expected one item");
    return item;
  };

  it("fills the frame when source and project agree and nothing is transformed", () => {
    const item = only([clip()]);
    expect(corner(item, 0, 0)).toEqual([-1, 1]);
    expect(corner(item, 1, 1)).toEqual([1, -1]);
  });

  it("scales about the anchor", () => {
    const item = only([clip({ transform: transform({ scaleX: 0.5, scaleY: 0.5 }) })]);
    expect(corner(item, 0, 0)).toEqual([-0.5, 0.5]);
    expect(corner(item, 1, 1)).toEqual([0.5, -0.5]);
  });

  it("moves by project pixels with y running down the picture", () => {
    const item = only([clip({ transform: transform({ x: 960, y: 540 }) })]);
    const [x, y] = corner(item, 0.5, 0.5);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(-1);
  });

  // Clipspace is anisotropic: a square that ignores this comes out stretched by the frame's
  // aspect ratio, which is the classic first bug of every hand-written compositor.
  it("keeps a square source square in a wide project", () => {
    const item = only([clip({ source: { kind: "media", media: SQUARE } })], 1920, 1080);
    const width = corner(item, 1, 0)[0] - corner(item, 0, 0)[0];
    const height = corner(item, 0, 0)[1] - corner(item, 0, 1)[1];
    expect((width / 2) * 1920).toBeCloseTo(480);
    expect((height / 2) * 1080).toBeCloseTo(480);
  });

  it("turns clockwise about the anchor and leaves the anchor where it was", () => {
    const item = only([
      clip({ transform: transform({ rotation: 90, anchorX: 0, anchorY: 0 }) }),
    ]);
    const [ax, ay] = corner(item, 0, 0);
    expect(ax).toBeCloseTo(0);
    expect(ay).toBeCloseTo(0);
    // A quarter turn clockwise puts the picture's right edge below the anchor -- 1920 project
    // pixels down, which is more than the height of the frame.
    const [rx, ry] = corner(item, 1, 0);
    expect(rx).toBeCloseTo(0);
    expect(ry).toBeCloseTo((-2 * 1920) / 1080);
  });

  it("cuts crop out of the geometry and out of the sampled rectangle alike", () => {
    const item = only([
      clip({ transform: transform({ crop: { left: 0.25, top: 0, right: 0, bottom: 0.5 } }) }),
    ]);
    expect(item.uv).toEqual([0.25, 0, 0.75, 0.5]);
    // The kept part stays where it was: the left edge moves in by a quarter, the right edge and
    // the top do not move, and the bottom rises to the middle.
    expect(corner(item, 0, 0)).toEqual([-0.5, 1]);
    expect(corner(item, 1, 1)).toEqual([1, 0]);
  });
});

describe("drawList output state", () => {
  it("carries opacity and blend mode through untouched", () => {
    const item = drawList(
      project([track("trk_1", [clip({ blend: "screen", transform: transform({ opacity: 0.25 }) })])]),
      0,
    ).items[0];
    expect(item).toMatchObject({ opacity: 0.25, blend: "screen" });
  });

  it("reads the background out of the project settings", () => {
    expect(drawList(project([], 1920, 1080, "#3366CC"), 0).background).toEqual([0.2, 0.4, 0.8, 1]);
  });

  it("falls back to opaque black for a background it cannot read", () => {
    expect(drawList(project([], 1920, 1080, "transparent"), 0).background).toEqual([0, 0, 0, 1]);
  });
});

describe("blendState", () => {
  const ONE = 1;
  const ONE_MINUS_SRC_ALPHA = 0x0303;
  const ONE_MINUS_SRC_COLOR = 0x0301;
  const DST_COLOR = 0x0306;
  const FUNC_ADD = 0x8006;
  const FUNC_REVERSE_SUBTRACT = 0x800b;
  const MIN = 0x8007;
  const MAX = 0x8008;

  it("composites premultiplied source over destination for a normal clip", () => {
    expect(blendState("normal")).toEqual({
      equation: FUNC_ADD,
      src: ONE,
      dst: ONE_MINUS_SRC_ALPHA,
    });
  });

  it("keeps the over-operator part of every mode it can express", () => {
    expect(blendState("multiply")).toEqual({
      equation: FUNC_ADD,
      src: DST_COLOR,
      dst: ONE_MINUS_SRC_ALPHA,
    });
    expect(blendState("screen")).toEqual({
      equation: FUNC_ADD,
      src: ONE,
      dst: ONE_MINUS_SRC_COLOR,
    });
    expect(blendState("add")).toEqual({ equation: FUNC_ADD, src: ONE, dst: ONE });
    expect(blendState("subtract")).toEqual({
      equation: FUNC_REVERSE_SUBTRACT,
      src: ONE,
      dst: ONE,
    });
    expect(blendState("lighten").equation).toBe(MAX);
    expect(blendState("darken").equation).toBe(MIN);
  });

  it("falls back to normal for the modes fixed-function blending cannot express", () => {
    expect(blendState("overlay")).toEqual(blendState("normal"));
    expect(blendState("difference")).toEqual(blendState("normal"));
  });
});
