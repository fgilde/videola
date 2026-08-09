import { describe, expect, it } from "vitest";

import type { Clip, Effect, Project, Track } from "@videola/core";

import { IDENTITY_LUT, lutIds } from "./lut";

const A = `med_${"a".repeat(64)}`;
const B = `med_${"b".repeat(64)}`;

function graded(id: string, table: string | undefined, over: Record<string, unknown> = {}): Clip {
  const effect = {
    id: `eff_${id}`,
    effectType: "lut",
    enabled: true,
    params: table === undefined ? {} : { table: { kind: "choice", value: table } },
    keyframes: {},
  } as unknown as Effect;
  return {
    id,
    source: { kind: "media", media: A },
    start: 0,
    duration: 1000,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    blend: "normal",
    effects: [effect],
    keyframes: {},
    ...over,
  } as unknown as Clip;
}

function project(clips: Clip[]): Project {
  return {
    timeline: { tracks: [{ id: "trk_1", kind: "video", clips } as unknown as Track] },
  } as unknown as Project;
}

describe("IDENTITY_LUT", () => {
  // Two entries an axis is enough only because the interpolation is trilinear: each corner of the
  // cube carries its own coordinate, and the filter reproduces everything between them exactly.
  // A wrong bit order here would swap a channel on every clip whose table failed to load.
  it("carries each corner of the unit cube at its own coordinate", () => {
    const corner = (index: number): number[] => [...IDENTITY_LUT.rgba.slice(index * 4, index * 4 + 4)];

    expect(IDENTITY_LUT.size).toBe(2);
    expect(corner(0)).toEqual([0, 0, 0, 255]);
    expect(corner(1)).toEqual([255, 0, 0, 255]);
    expect(corner(2)).toEqual([0, 255, 0, 255]);
    expect(corner(4)).toEqual([0, 0, 255, 255]);
    expect(corner(7)).toEqual([255, 255, 255, 255]);
  });
});

describe("lutIds", () => {
  it("names every table a grade points at, once each", () => {
    const found = lutIds(project([graded("clp_1", A), graded("clp_2", B), graded("clp_3", A)]));

    expect(found.sort()).toEqual([A, B]);
  });

  it("names nothing for a grade with no table chosen", () => {
    expect(lutIds(project([graded("clp_1", undefined)]))).toEqual([]);
  });

  // A table cannot be interpolated, so the core never resolves one *between* keys -- but a track
  // still holds them, and a project that swaps look halfway through a clip would otherwise have
  // its second table read as missing and drawn as the untouched picture.
  it("reads the tables a keyframe track holds as well as the resting one", () => {
    const clip = graded("clp_1", A);
    (clip.effects[0] as unknown as { keyframes: unknown }).keyframes = {
      table: [{ time: 0, value: { kind: "choice", value: B }, interp: "hold" }],
    };

    expect(lutIds(project([clip])).sort()).toEqual([A, B]);
  });

  // `leafClips` walks through a compound and drops the group itself, which would lose a grade
  // somebody put on the whole group.
  it("reaches a grade on a compound clip and the clips inside it", () => {
    const inner = graded("clp_in", B);
    const group = graded("clp_group", A, {
      source: { kind: "compound", timeline: { tracks: [{ id: "trk_in", clips: [inner] }] } },
    });

    expect(lutIds(project([group])).sort()).toEqual([A, B]);
  });
});
