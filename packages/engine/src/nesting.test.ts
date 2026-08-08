import { describe, expect, it } from "vitest";

import { MAX_COMPOUND_DEPTH } from "@videola/core";

import type { Clip, Project, Track } from "@videola/core";

import { leafClips } from "./nesting";
import { clipHashes } from "./playback";

const SECOND = 705_600_000;
const VIDEO = `med_${"a".repeat(64)}`;

function clip(over: Record<string, unknown> = {}): Clip {
  return {
    id: "clp_1",
    source: { kind: "media", media: VIDEO },
    start: 0,
    duration: SECOND,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {},
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
    ...over,
  } as unknown as Clip;
}

function track(id: string, clips: Clip[]): Track {
  return { id, kind: "video", name: id, clips, effects: [] } as unknown as Track;
}

function compound(id: string, clips: Clip[], over: Record<string, unknown> = {}): Clip {
  return clip({ id, source: { kind: "compound", timeline: { tracks: [track(`${id}_in`, clips)] } }, ...over });
}

function project(clips: Clip[]): Project {
  return { timeline: { tracks: [track("trk_1", clips)] } } as unknown as Project;
}

describe("the clips a project actually has material for", () => {
  it("reaches through a compound clip and leaves the compound itself out", () => {
    const found = leafClips(project([compound("clp_group", [clip({ id: "clp_a" })])]));

    expect(found.map((entry) => entry.id)).toEqual(["clp_a"]);
  });

  it("reaches through several levels", () => {
    const deep = compound("clp_outer", [compound("clp_inner", [clip({ id: "clp_a" })])]);

    expect(leafClips(project([deep])).map((entry) => entry.id)).toEqual(["clp_a"]);
  });

  // The cap the loader enforces, mirrored here for the same reason the draw list mirrors it: a
  // walk without one is a stack overflow a project file can trigger.
  it("stops at the depth the loader accepts", () => {
    let deep = clip({ id: "clp_leaf" });
    for (let level = 0; level <= MAX_COMPOUND_DEPTH + 1; level += 1) {
      deep = compound(`clp_${level}`, [deep]);
    }

    expect(leafClips(project([deep]))).toEqual([]);
  });
});

// The draw list names a nested clip by its own id and playback looks its frames up by that id, so
// a hash table that stopped at the top level would put every nested clip in the picture with no
// medium behind it.
describe("the media hashes playback decodes from", () => {
  it("answers for a clip inside a compound", () => {
    const hashes = clipHashes(project([compound("clp_group", [clip({ id: "clp_a" })])]));

    expect([...hashes.keys()]).toEqual(["clp_a"]);
    expect(hashes.get("clp_a")).toBe("a".repeat(64));
  });

  it("has nothing to say about the compound itself", () => {
    const hashes = clipHashes(project([compound("clp_group", [clip({ id: "clp_a" })])]));

    expect(hashes.has("clp_group")).toBe(false);
  });
});
