import { describe, expect, it } from "vitest";

import type {
  Clip,
  EffectParamSnapshot,
  TransformSnapshot,
  MediaAsset,
  Project,
  Track,
  Transform,
} from "@videola/core";

import { drawList } from "./draw-list";
import type { DrawList } from "./draw-list";

// The resolved parameter batch is empty unless a case supplies its own -- most of these projects
// have no effect on any clip.
function list(
  project: Project,
  at: number,
  params: EffectParamSnapshot = new Map(),
  transforms: TransformSnapshot = new Map(),
): DrawList {
  return drawList(project, at, params, transforms);
}

const SECOND = 705_600_000;
const VIDEO = `med_${"a".repeat(64)}`;

function transform(over: Partial<Transform> = {}): Transform {
  return {
    x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1,
    crop: { left: 0, top: 0, right: 0, bottom: 0 }, ...over,
  };
}

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "clp_1", source: { kind: "media", media: VIDEO }, start: 0, duration: SECOND,
    inPoint: 0, speed: { rate: 1, reverse: false, preservePitch: true },
    transform: transform(), blend: "normal", fades: { inDuration: 0, outDuration: 0 },
    volume: 1, pan: 0, effects: [], keyframes: {}, ...over,
  } as Clip;
}

function track(id: string, clips: Clip[], over: Partial<Track> = {}): Track {
  return { id, kind: "video", name: id, hidden: false, clips, effects: [], ...over } as Track;
}

function project(tracks: Track[], background = "#000000"): Project {
  return {
    settings: { width: 1920, height: 1080, background },
    library: [{ id: VIDEO, width: 1920, height: 1080 } as MediaAsset],
    timeline: { tracks },
  } as unknown as Project;
}

const ids = (tracks: Track[], at: number): string[] =>
  list(project(tracks), at).items.map((item) => item.clip);

describe("drawList edges", () => {
  it("never shows a clip of duration zero", () => {
    expect(ids([track("t", [clip({ start: SECOND, duration: 0 })])], SECOND)).toEqual([]);
  });

  it("shows both of two overlapping clips on one track, in array order", () => {
    const clips = [
      clip({ id: "clp_a", start: 0, duration: 2 * SECOND }),
      clip({ id: "clp_b", start: SECOND, duration: 2 * SECOND }),
    ];
    expect(ids([track("t", clips)], SECOND + 1)).toEqual(["clp_a", "clp_b"]);
    // reversing the array reverses who wins -- the list has no z-order of its own
    expect(ids([track("t", [...clips].reverse())], SECOND + 1)).toEqual(["clp_b", "clp_a"]);
  });

  it("survives a negative moment and a clip that starts before zero", () => {
    expect(ids([track("t", [clip({ start: 0 })])], -1)).toEqual([]);
    expect(ids([track("t", [clip({ start: -SECOND, duration: 2 * SECOND })])], 0)).toEqual(["clp_1"]);
  });

  it("drops a compound clip instead of recursing into it", () => {
    const nested = clip({ source: { kind: "compound", clips: [] } as never });
    expect(ids([track("t", [nested])], 0)).toEqual([]);
  });

  it("paints nothing on an adjustment track", () => {
    expect(ids([track("t", [clip()], { kind: "adjustment" })], 0)).toEqual([]);
  });

  it("passes an opacity above one straight through without clamping", () => {
    const loud = clip({ transform: transform({ opacity: 4 }) });
    expect(list(project([track("t", [loud])]), 0).items[0]?.opacity).toBe(4);
  });

  it("passes a negative crop straight through as a uv outside the texture", () => {
    const bleed = clip({ transform: transform({ crop: { left: -0.5, top: 0, right: 0, bottom: 0 } }) });
    expect(list(project([track("t", [bleed])]), 0).items[0]?.uv).toEqual([-0.5, 0, 1.5, 1]);
  });

  it("emits a draw call for a clip scaled to zero area", () => {
    const flat = clip({ transform: transform({ scaleX: 0 }) });
    expect(ids([track("t", [flat])], 0)).toEqual(["clp_1"]);
  });

  it("takes the first library entry when two share an id", () => {
    const p = project([track("t", [clip()])]);
    (p.library as MediaAsset[]).push({ id: VIDEO, width: 100, height: 100 } as MediaAsset);
    const m = list(p, 0).items[0]?.matrix ?? [];
    expect((m[0] ?? 0) * 1920 * 0.5).toBeCloseTo(1920);
  });

  it("reads an eight digit background and premultiplies it", () => {
    const grey = (128 / 255) * (128 / 255);
    expect(list(project([], "#80808080"), 0).background).toEqual([grey, grey, grey, 128 / 255]);
  });
});
