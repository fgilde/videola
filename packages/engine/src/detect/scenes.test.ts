import { describe, expect, it } from "vitest";

import { SCENE_DEFAULTS, sceneCuts, signatureDistance, SIGNATURE_SIZE } from "./scenes";

/** A run of quiet frames with spikes at the given positions, which is what a cut looks like. */
function distances(length: number, spikes: readonly [number, number][], quiet = 0.01): number[] {
  const out = Array.from({ length }, () => quiet);
  for (const [at, height] of spikes) out[at] = height;
  return out;
}

describe("which frame a cut lands on", () => {
  // The first frame of the new shot, not the last of the old one: a split at the last frame of the old
  // take would leave one frame of it at the head of the new clip, which is exactly the frame somebody
  // would then have to trim by hand.
  it("reports the first frame of the new shot", () => {
    expect(sceneCuts(distances(60, [[30, 0.5]]))).toEqual([31]);
  });

  it("finds several cuts in one recording", () => {
    expect(sceneCuts(distances(200, [[20, 0.4], [80, 0.6], [150, 0.35]]))).toEqual([21, 81, 151]);
  });

  it("finds nothing in a recording that never cuts", () => {
    expect(sceneCuts(distances(120, []))).toEqual([]);
  });
});

describe("what is not a cut", () => {
  // The reason a threshold alone is not enough, and the mistake every naive detector makes: a dissolve
  // changes the picture as much as a cut does, only spread out -- so it clears any threshold a cut
  // clears, on every one of its frames.
  it("reports a dissolve once at most, not once per frame", () => {
    const steady = Array.from({ length: 120 }, () => 0.01);
    for (let at = 40; at < 70; at += 1) steady[at] = 0.2;

    const cuts = sceneCuts(steady);

    expect(cuts.length).toBeLessThanOrEqual(1);
  });

  it("ignores a change too small to be a cut", () => {
    expect(sceneCuts(distances(60, [[30, 0.05]]))).toEqual([]);
  });

  // A pan or a hand across the lens moves everything a little, every frame. Loud enough in absolute
  // terms, level enough that nothing stands out -- which is what the prominence test answers.
  it("ignores a busy shot where every frame changes as much as its neighbours", () => {
    const busy = Array.from({ length: 120 }, (_, at) => 0.16 + 0.01 * Math.sin(at));

    expect(sceneCuts(busy)).toEqual([]);
  });

  it("takes the louder of two candidates inside one gap", () => {
    // A flash frame: two big changes a frame apart, and the join is the bigger of them.
    expect(sceneCuts(distances(80, [[40, 0.3], [41, 0.6]]))).toEqual([42]);
  });

  // Why the neighbourhood is a median and not a mean: a loud cut *inside the window* drags a mean up
  // far enough to hide the next one. Eight frames apart -- just past the gap, so both are candidates,
  // and close enough that each sits in the other's window. With a mean the modest one is missed, and a
  // card cut fast would lose half its joins.
  it("still finds a modest cut standing next to a loud one", () => {
    const found = sceneCuts(distances(80, [[32, 0.9], [40, 0.16]], 0.001));

    expect(found).toEqual([33, 41]);
  });

  it("keeps two real cuts that are further apart than the gap", () => {
    const found = sceneCuts(distances(120, [[30, 0.4], [45, 0.4]]), {
      ...SCENE_DEFAULTS,
      minGap: 8,
    });

    expect(found).toEqual([31, 46]);
  });
});

describe("how far apart two frames are", () => {
  it("is zero for the same picture and one for black against white", () => {
    const dark = new Float32Array(SIGNATURE_SIZE);
    const light = new Float32Array(SIGNATURE_SIZE).fill(1);

    expect(signatureDistance(dark, dark)).toBe(0);
    expect(signatureDistance(dark, light)).toBe(1);
  });

  it("is a mean rather than a maximum, so one moving cell is not a cut", () => {
    const still = new Float32Array(SIGNATURE_SIZE).fill(0.5);
    const oneCell = Float32Array.from(still);
    oneCell[10] = 1;

    expect(signatureDistance(still, oneCell)).toBeLessThan(0.01);
  });

  it("answers zero rather than dividing by nothing for an empty signature", () => {
    expect(signatureDistance(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});
