import { describe, expect, it } from "vitest";

import { FLICKS_PER_SECOND, type Clip, type Effect, type Interp, type Keyframe } from "@videola/core";

import {
  isSpeedRow,
  keyframeSpan,
  laneRows,
  offeredFor,
  OFFERED_ON_SPEED,
  POSITION_TRACK,
} from "./keyframes";
import { makeClip } from "./Timeline.test";

const SECOND = FLICKS_PER_SECOND;

function key(seconds: number, interp: Interp = "linear"): Keyframe {
  return {
    time: Math.round(seconds * SECOND),
    value: { kind: "float", value: seconds },
    interp,
  } as unknown as Keyframe;
}

function effect(id: string, type: string, keyframes: Record<string, Keyframe[]>): Effect {
  return { id, effectType: type, enabled: true, params: {}, keyframes } as unknown as Effect;
}

// `Clip` carries the flattened `extra` map, so its index signature admits only JSON values and a
// `Partial<Clip>` cannot be written with real model objects in it. Every other test in this package
// goes through the same door.
function over(patch: { keyframes?: Record<string, Keyframe[]>; effects?: Effect[] }): Partial<Clip> {
  return patch as unknown as Partial<Clip>;
}

describe("laneRows", () => {
  it("lists one row per non-empty track, transform first and effects after", () => {
    const clip = makeClip(
      "clp_1",
      0,
      4 * SECOND,
      over({
        keyframes: { opacity: [key(0), key(2)] },
        effects: [effect("eff_1", "brightness", { amount: [key(1)] })],
      }),
    );

    expect(laneRows(clip).map((row) => [row.id, row.effectType, row.key])).toEqual([
      [":opacity", null, "opacity"],
      ["eff_1:amount", "brightness", "amount"],
    ]);
  });

  // An empty track loads -- `normalize` sorts tracks but drops none -- and the core falls back to
  // the static value the moment one runs empty. A row for it would draw an animation nobody has.
  it("leaves out a track that has no keyframes on it", () => {
    const clip = makeClip(
      "clp_1",
      0,
      4 * SECOND,
      over({
        keyframes: { x: [], opacity: [key(1)] },
        effects: [effect("eff_1", "brightness", { amount: [] })],
      }),
    );

    expect(laneRows(clip).map((row) => row.key)).toEqual(["opacity"]);
  });

  // The precedence rule the core applies has to be visible, not merely effective: a path resolves
  // last and overwrites both, so the two rows under it are keyframes that no picture obeys.
  it("marks x and y as overridden while a motion path exists", () => {
    const clip = makeClip(
      "clp_1",
      0,
      4 * SECOND,
      over({
        keyframes: {
          x: [key(0), key(2)],
          y: [key(0), key(2)],
          rotation: [key(0), key(2)],
          [POSITION_TRACK]: [key(0), key(2)],
        },
      }),
    );

    expect(Object.fromEntries(laneRows(clip).map((row) => [row.key, row.overridden]))).toEqual({
      x: true,
      y: true,
      rotation: false,
      [POSITION_TRACK]: false,
    });
  });

  it("leaves x and y alone when the path track is present but empty", () => {
    const clip = makeClip(
      "clp_1",
      0,
      4 * SECOND,
      over({ keyframes: { x: [key(0)], [POSITION_TRACK]: [] } }),
    );

    expect(laneRows(clip).map((row) => [row.key, row.overridden])).toEqual([["x", false]]);
  });

  // Two effects of one type is a project a hand can write, and the row identity a selection holds
  // on to must still tell the two apart -- the effect's own id does, its type does not.
  it("gives two effects of the same type distinct rows", () => {
    const clip = makeClip(
      "clp_1",
      0,
      4 * SECOND,
      over({
        effects: [
          effect("eff_1", "brightness", { amount: [key(1)] }),
          effect("eff_2", "brightness", { amount: [key(2)] }),
        ],
      }),
    );

    expect(laneRows(clip).map((row) => row.id)).toEqual(["eff_1:amount", "eff_2:amount"]);
  });
});

describe("keyframeSpan", () => {
  it("ends one flick before the clip does, where the clip still covers the moment", () => {
    expect(keyframeSpan(makeClip("clp_1", 2 * SECOND, 3 * SECOND))).toEqual({
      from: 2 * SECOND,
      to: 5 * SECOND - 1,
    });
  });

  it("never runs backwards on a clip of no length", () => {
    expect(keyframeSpan(makeClip("clp_1", SECOND, 0))).toEqual({ from: SECOND, to: SECOND });
  });
});

describe("offeredFor", () => {
  // The three presets stay one click and the curve joins them, rather than replacing them.
  it("offers the three presets and the curve", () => {
    expect(offeredFor("linear")).toEqual(["linear", "hold", "ease", "bezier"]);
  });

  // The one track a curve may not go on: `integrate` has no exact area under a bezier, and the
  // additivity `consumed_source` stands on would go with it. The core refuses the change, so the
  // entry is not there to click.
  it("leaves the curve off a rate track", () => {
    expect(offeredFor("linear", OFFERED_ON_SPEED)).toEqual(["linear", "hold", "ease"]);
  });

  // And a rate track that arrived carrying one anyway, from a file written by hand. Dropping it
  // from the list would make the picker read "Linear" for a keyframe that is not linear.
  it("keeps an interpolation it cannot author on the list, so the select stays truthful", () => {
    expect(offeredFor("bezier", OFFERED_ON_SPEED)).toEqual(["bezier", "linear", "hold", "ease"]);
  });
});

describe("isSpeedRow", () => {
  it("knows the clip's own rate track from an effect parameter of the same name", () => {
    expect(isSpeedRow({ effectType: null, key: "speed" })).toBe(true);
    expect(isSpeedRow({ effectType: "warp", key: "speed" })).toBe(false);
    expect(isSpeedRow({ effectType: null, key: "opacity" })).toBe(false);
  });
});

// The whole point of the lane: the times it draws are the times the timeline draws. A row built
// from a clip's track carries the keyframe's own `time`, which is the same absolute instant the
// playhead reports -- no clip-relative arithmetic anywhere between the two.
describe("lane time is timeline time", () => {
  it("hands the keyframe's own time through untouched, even on a clip that starts late", () => {
    const clip = makeClip(
      "clp_1",
      10 * SECOND,
      4 * SECOND,
      over({ keyframes: { opacity: [key(11), key(13)] } }),
    );

    expect(laneRows(clip)[0]?.track.map((entry) => entry.time)).toEqual([11 * SECOND, 13 * SECOND]);
  });
});
