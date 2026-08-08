import { describe, expect, it } from "vitest";

import type {
  Clip,
  Effect,
  EffectParamSnapshot,
  TransformSnapshot,
  MediaAsset,
  ParamValue,
  Project,
  Track,
  Transform,
  Transition,
} from "@videola/core";

import { blendState, drawList } from "./draw-list";
import type { DrawItem, DrawList } from "./draw-list";

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

// Not `Partial<Clip>`: `Clip` carries the index signature that keeps unknown fields alive, and
// a `Transition` does not fit through it.
function clip(over: Record<string, unknown> = {}): Clip {
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
    expect(ids(list(project([track("trk_1", clips)]), SECOND + 1))).toEqual(["clp_now"]);
  });

  it("treats a clip as half-open, so the cut between two clips shows exactly one", () => {
    const clips = [
      clip({ id: "clp_a", start: 0, duration: SECOND }),
      clip({ id: "clp_b", start: SECOND, duration: SECOND }),
    ];
    expect(ids(list(project([track("trk_1", clips)]), SECOND))).toEqual(["clp_b"]);
  });

  it("draws the tracks in array order, so index zero is the bottom of the stack", () => {
    const lower = track("trk_lower", [clip({ id: "clp_lower" })]);
    const upper = track("trk_upper", [clip({ id: "clp_upper" })]);
    expect(ids(list(project([lower, upper]), 0))).toEqual(["clp_lower", "clp_upper"]);
  });

  it("skips a hidden track", () => {
    const hidden = track("trk_1", [clip()], { hidden: true });
    expect(ids(list(project([hidden]), 0))).toEqual([]);
  });

  it("skips an audio track even when its clip points at a video medium", () => {
    const audio = track("trk_1", [clip()], { kind: "audio" });
    expect(ids(list(project([audio]), 0))).toEqual([]);
  });

  it("skips a clip whose medium has no picture", () => {
    const silent = clip({ source: { kind: "media", media: SOUND } });
    expect(ids(list(project([track("trk_1", [silent])]), 0))).toEqual([]);
  });

  it("skips a fully transparent clip instead of drawing a no-op", () => {
    const invisible = clip({ transform: transform({ opacity: 0 }) });
    expect(ids(list(project([track("trk_1", [invisible])]), 0))).toEqual([]);
  });

  it("skips a clip that is cropped down to nothing", () => {
    const gone = clip({ transform: transform({ crop: { left: 0.6, top: 0, right: 0.5, bottom: 0 } }) });
    expect(ids(list(project([track("trk_1", [gone])]), 0))).toEqual([]);
  });
});

describe("drawList geometry", () => {
  const only = (clips: Clip[], width = 1920, height = 1080): DrawItem => {
    const drawn = list(project([track("trk_1", clips)], width, height), 0);
    const [item] = drawn.items;
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
    const item = list(
      project([track("trk_1", [clip({ blend: "screen", transform: transform({ opacity: 0.25 }) })])]),
      0,
    ).items[0];
    expect(item).toMatchObject({ opacity: 0.25, blend: "screen" });
  });

  it("reads the background out of the project settings", () => {
    expect(list(project([], 1920, 1080, "#3366CC"), 0).background).toEqual([0.2, 0.4, 0.8, 1]);
  });

  // The clear colour lands in a premultiplied drawing buffer, so a translucent background has to
  // arrive premultiplied too, or the page composites it far too bright.
  it("premultiplies a background that carries alpha", () => {
    expect(list(project([], 1920, 1080, "#80808080"), 0).background).toEqual([
      (128 / 255) * (128 / 255),
      (128 / 255) * (128 / 255),
      (128 / 255) * (128 / 255),
      128 / 255,
    ]);
  });

  it("falls back to opaque black for a background it cannot read", () => {
    expect(list(project([], 1920, 1080, "transparent"), 0).background).toEqual([0, 0, 0, 1]);
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

function effect(over: Record<string, unknown> = {}): Effect {
  return {
    id: "eff_1",
    effectType: "brightness",
    enabled: true,
    params: {},
    keyframes: {},
    ...over,
  } as Effect;
}

function params(entries: [string, [string, number][]][]): EffectParamSnapshot {
  return new Map(
    entries.map(([id, values]) => [
      id,
      new Map(values.map(([key, value]) => [key, { kind: "float", value } as ParamValue])),
    ]),
  );
}

function only(clips: Clip[], at: number, resolved: EffectParamSnapshot = new Map()): DrawItem {
  const [item] = list(project([track("trk_1", clips)]), at, resolved).items;
  if (item === undefined) throw new Error("expected one item");
  return item;
}

describe("the effect chain in the draw list", () => {
  it("takes the value the core resolved and not the one written on the effect", () => {
    const authored = effect({ params: { amount: { kind: "float", value: 0.25 } } });
    const item = only([clip({ effects: [authored] })], 0, params([["eff_1", [["amount", 3]]]]));

    expect(item.effects).toEqual([{ effect: "brightness", values: { amount: 3 } }]);
  });

  // Where a keyframe track meets a clip boundary: the batch answers for the clip at 0.9 s and has
  // nothing to say a tenth of a second later, and the item is gone rather than stuck on its last
  // value -- because the clip is gone.
  it("follows the resolved value from moment to moment", () => {
    const clips = [clip({ effects: [effect()] })];

    expect(only(clips, 0, params([["eff_1", [["amount", 0]]]])).effects[0]?.values).toEqual({
      amount: 0,
    });
    expect(
      only(clips, 0.9 * SECOND, params([["eff_1", [["amount", 2]]]])).effects[0]?.values,
    ).toEqual({ amount: 2 });
    expect(list(project([track("trk_1", clips)]), SECOND, new Map()).items).toEqual([]);
  });

  it("falls back to the manifest default when the core answered for nothing", () => {
    const item = only([clip({ effects: [effect()] })], 0);

    expect(item.effects[0]?.values).toEqual({ amount: 1 });
  });

  // `ParamValue` has six kinds and a shader uniform takes one of them. A choice string reaching
  // uniform1f is a silent no-op; an int is a plausible-looking wrong number.
  it("ignores a resolved value of the wrong kind", () => {
    const wrong: EffectParamSnapshot = new Map([
      ["eff_1", new Map([["amount", { kind: "int", value: 3n } as ParamValue]])],
    ]);

    expect(only([clip({ effects: [effect()] })], 0, wrong).effects[0]?.values).toEqual({
      amount: 1,
    });
  });

  it("pulls a value from outside the declared range back in", () => {
    const item = only([clip({ effects: [effect()] })], 0, params([["eff_1", [["amount", 40]]]]));

    expect(item.effects[0]?.values.amount).toBe(4);
  });

  it("leaves out a disabled effect and one whose type it does not know", () => {
    const clips = [
      clip({
        effects: [
          effect({ id: "eff_off", enabled: false }),
          effect({ id: "eff_future", effectType: "bokeh-2030" }),
          effect({ id: "eff_1" }),
        ],
      }),
    ];

    expect(only(clips, 0).effects.map((pass) => pass.effect)).toEqual(["brightness"]);
  });

  // A transition takes two inputs and cannot run as a link in a one-input chain; letting it
  // through would leave `u_second` bound to whatever the last pass happened to leave there.
  it("refuses to run a two-input effect as a clip effect", () => {
    const clips = [clip({ effects: [effect({ effectType: "crossfade" })] })];

    expect(only(clips, 0).effects).toEqual([]);
  });
});

function transition(over: Partial<Transition> = {}): Transition {
  return {
    transitionType: "crossfade",
    duration: SECOND / 2,
    alignment: "in",
    params: {},
    ...over,
  } as Transition;
}

describe("a transition in the draw list", () => {
  it("runs from nothing to everything across its own window", () => {
    const clips = [clip({ transitionIn: transition() })];

    // Progress zero contributes nothing at all, so the clip is left out entirely.
    expect(list(project([track("trk_1", clips)]), 0, new Map()).items).toEqual([]);
    expect(only(clips, SECOND / 8).mix?.values.progress).toBeCloseTo(0.25);
    expect(only(clips, SECOND / 4).mix?.values.progress).toBeCloseTo(0.5);
  });

  // Past its window the clip is composited the ordinary way. A mix at full progress would paint
  // the whole frame, including where the clip is transparent, and wipe out what is under it.
  it("stops being a mix once the window is behind the moment", () => {
    const clips = [clip({ transitionIn: transition() })];

    expect(only(clips, SECOND / 2).mix).toBeUndefined();
    expect(only(clips, 0.9 * SECOND).mix).toBeUndefined();
  });

  // The two axes the compositor cannot keep apart: a half-opaque clip halfway through its
  // transition is a quarter mixed, not half and then half again.
  it("carries the clip's opacity in the same progress", () => {
    const clips = [
      clip({ transform: transform({ opacity: 0.5 }), transitionIn: transition() }),
    ];

    expect(only(clips, SECOND / 4).mix?.values.progress).toBeCloseTo(0.25);
  });

  it("ignores a transition type it does not know and one with no duration", () => {
    expect(only([clip({ transitionIn: transition({ transitionType: "no-such-wipe" }) })], 0).mix)
      .toBeUndefined();
    expect(only([clip({ transitionIn: transition({ duration: 0 }) })], 0).mix).toBeUndefined();
  });

  // A centred transition reaches back before the clip starts, where nothing is drawn, so the half
  // that is visible starts halfway through. Documented rather than desirable: it needs handles.
  it("starts a centred transition halfway through", () => {
    const clips = [clip({ transitionIn: transition({ alignment: "center" }) })];

    expect(only(clips, 0).mix?.values.progress).toBeCloseTo(0.5);
  });

  it("still runs the clip's own effects underneath the transition", () => {
    const clips = [clip({ effects: [effect()], transitionIn: transition() })];

    const item = only(clips, SECOND / 4, params([["eff_1", [["amount", 2]]]]));

    expect(item.effects).toEqual([{ effect: "brightness", values: { amount: 2 } }]);
    expect(item.mix?.effect).toBe("crossfade");
  });

  // A parameter the project never wrote reaches the shader as the manifest's default. Leaving it out
  // would set no uniform at all, and an unset uniform is zero -- which for a wipe's angle is a real
  // direction rather than an obvious mistake, so nothing downstream would ever report it.
  it("fills a transition parameter the project left out with the manifest's default", () => {
    const clips = [clip({ transitionIn: transition({ transitionType: "wipe" }) })];

    expect(only(clips, SECOND / 4).mix?.values).toEqual({
      progress: 0.5,
      angle: 0,
      softness: 0.05,
    });
  });

  it("clamps a transition parameter the project put outside its range", () => {
    const clips = [
      clip({
        transitionIn: transition({
          transitionType: "wipe",
          params: { angle: { kind: "float", value: 900 } },
        }),
      }),
    ];

    expect(only(clips, SECOND / 4).mix?.values.angle).toBe(360);
  });
});

describe("a generator clip in the draw list", () => {
  function generator(source: unknown, over: Record<string, unknown> = {}): Clip {
    return clip({ source, ...over });
  }

  const TITLE = {
    kind: "generator",
    generator: { type: "text", content: "Hello", style: {} },
  };

  // A generator has no source of its own, so it takes the frame's size -- and the proof is the matrix
  // rather than the number, because a size that does not reach the matrix reaches nothing.
  it("fills the frame, whatever the frame is", () => {
    const wide = only([generator(TITLE)], 0);
    expect(corner(wide, 0, 0)).toEqual([-1, 1]);
    expect(corner(wide, 1, 1)).toEqual([1, -1]);
  });

  it("leaves out a generator this renderer cannot paint", () => {
    const shape = { kind: "generator", generator: { type: "shape", shape: "star", color: "#fff" } };

    expect(list(project([track("trk_1", [generator(shape)])]), 0).items).toEqual([]);
  });

  // The animation is a transform, so the first moment of a fade-in is a clip at zero opacity -- and a
  // clip at zero opacity is not drawn at all, which is also a picture nobody has to paint.
  it("drops a title whose fade-in has not started", () => {
    const fading = generator({
      kind: "generator",
      generator: { type: "text", content: "Hello", style: { animateIn: "fade" } },
    });

    expect(list(project([track("trk_1", [fading])]), 0).items).toEqual([]);
    expect(list(project([track("trk_1", [fading])]), SECOND / 2).items).toHaveLength(1);
  });

  it("carries a title's fade into the mix of a transition on the same clip", () => {
    const fading = generator(
      {
        kind: "generator",
        generator: { type: "text", content: "Hello", style: { animateIn: "fade",
          animateInSeconds: 1 } },
      },
      { transitionIn: transition() },
    );

    // Halfway through a half-second dissolve, at a fade whose smoothstep has reached 0.15625.
    expect(only([fading], SECOND / 4).mix?.values.progress).toBeCloseTo(0.5 * 0.15625);
  });
});

describe("a separable effect in the draw list", () => {
  // One authored effect, two draws, and the order of the sweeps is what makes it separable rather
  // than the same blur applied twice along one axis.
  it("becomes two passes that differ only in which sweep they are", () => {
    const clips = [clip({ effects: [effect({ effectType: "blur" })] })];

    expect(only(clips, 0, params([["eff_1", [["amount", 3]]]])).effects).toEqual([
      { effect: "blur", values: { amount: 3, pass: 0 } },
      { effect: "blur", values: { amount: 3, pass: 1 } },
    ]);
  });

  it("leaves a single-pass effect as one pass, with no sweep to speak of", () => {
    const clips = [clip({ effects: [effect({ effectType: "contrast" })] })];

    expect(only(clips, 0, params([["eff_1", [["amount", 2]]]])).effects).toEqual([
      { effect: "contrast", values: { amount: 2 } },
    ]);
  });
});
