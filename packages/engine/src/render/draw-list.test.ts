import { describe, expect, it } from "vitest";

import { MAX_COMPOUND_DEPTH } from "@videola/core";

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

  // The whole point of the batch: `clip.transform` is the value at rest, and once a field is on
  // the clock the geometry has to come from the resolved snapshot instead. Reading the static one
  // here is exactly the bug that left the keyframe switch off every transform row.
  it("places a clip by the resolved transform rather than by the static one", () => {
    const still = clip({ transform: transform({ x: 0 }) });
    const scene = project([track("trk_1", [still])]);
    const moved = list(scene, 0, new Map(), new Map([["clp_1", transform({ x: 960 })]]));

    const [item] = moved.items;
    if (item === undefined) throw new Error("expected one item");
    expect(corner(item, 0.5, 0.5)[0]).toBeCloseTo(1);
    // Without the snapshot the same project stays where the static transform puts it.
    expect(corner(only([still]), 0.5, 0.5)[0]).toBeCloseTo(0);
  });

  // Every field the snapshot carries has to win, not just the ones the matrix reads first: crop
  // also decides the sampled rectangle, and opacity can drop the clip out of the list entirely.
  it("takes crop and opacity from the snapshot too", () => {
    const scene = project([track("trk_1", [clip()])]);
    const cropped = list(
      scene,
      0,
      new Map(),
      new Map([["clp_1", transform({ crop: { left: 0.25, top: 0, right: 0, bottom: 0 } })]]),
    );
    expect(cropped.items[0]?.uv).toEqual([0.25, 0, 0.75, 1]);

    const faded = list(scene, 0, new Map(), new Map([["clp_1", transform({ opacity: 0 })]]));
    expect(faded.items).toEqual([]);
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

// The claim `clip.nest` makes, checked on the value the compositor executes: folding clips into a
// compound changes where they are written down and nothing about what is drawn. The comparison is
// against the draw list of the same clips *before* nesting -- checking that a compound "produced
// some items" would pass with the picture upside down.
function compound(over: Record<string, unknown>, tracks: Track[]): Clip {
  return clip({ source: { kind: "compound", timeline: { tracks } }, ...over });
}

describe("a compound clip in the draw list", () => {
  const inner = [
    clip({ id: "clp_a", start: 0, duration: 2 * SECOND }),
    clip({ id: "clp_b", start: 2 * SECOND, duration: 2 * SECOND, blend: "screen" }),
  ];
  const flat = project([track("trk_1", inner)]);
  const nested = project([
    track("trk_1", [
      compound({ id: "clp_group", start: 0, duration: 4 * SECOND }, [track("trk_in", inner)]),
    ]),
  ]);

  it("draws exactly what the same clips drew before they were folded", () => {
    for (let at = 0; at < 4 * SECOND; at += SECOND / 4) {
      expect(list(nested, at)).toEqual(list(flat, at));
    }
  });

  // A compound placed later reads its own timeline from the beginning: project time towards the
  // source, which is what keeps a nested sequence from following the outer playhead.
  it("shows its own timeline from the instant it has reached, not from the project's", () => {
    const moved = project([
      track("trk_1", [
        compound({ id: "clp_group", start: 10 * SECOND, duration: 4 * SECOND }, [
          track("trk_in", inner),
        ]),
      ]),
    ]);
    expect(ids(list(moved, 11 * SECOND))).toEqual(["clp_a"]);
    expect(ids(list(moved, 13 * SECOND))).toEqual(["clp_b"]);
    expect(ids(list(moved, 14 * SECOND))).toEqual([]);
  });

  // The head of a reversed clip maps one flick past the end of the range it consumes, and inside a
  // compound that is an instant the nested timeline does not have -- without the clamp the first
  // frame of a reversed compound is empty.
  it("plays its own timeline backwards when it is itself reversed", () => {
    const backwards = project([
      track("trk_1", [
        compound(
          {
            id: "clp_group",
            start: 0,
            duration: 4 * SECOND,
            speed: { rate: 1, reverse: true, preservePitch: true },
          },
          [track("trk_in", inner)],
        ),
      ]),
    ]);
    expect(ids(list(backwards, 0))).toEqual(["clp_b"]);
    expect(ids(list(backwards, 3 * SECOND))).toEqual(["clp_a"]);
  });

  // Trimming the compound cuts what is inside it, because the head it no longer covers is source
  // material it no longer consumes.
  it("hides what its own in point and duration no longer reach", () => {
    const trimmed = project([
      track("trk_1", [
        compound({ id: "clp_group", start: 0, duration: 2 * SECOND, inPoint: 2 * SECOND }, [
          track("trk_in", inner),
        ]),
      ]),
    ]);
    expect(ids(list(trimmed, 0))).toEqual(["clp_b"]);
  });

  it("places a nested clip where the compound's own transform puts it", () => {
    const shifted = project([
      track("trk_1", [
        compound(
          {
            id: "clp_group",
            start: 0,
            duration: 4 * SECOND,
            transform: transform({ scaleX: 0.5, scaleY: 0.5 }),
          },
          [track("trk_in", [inner[0]!])],
        ),
      ]),
    ]);
    const item = list(shifted, 0).items[0]!;
    // Half the frame, centred: the top-left corner of a full-frame clip lands halfway out.
    expect(corner(item, 0, 0)).toEqual([-0.5, 0.5]);
    expect(corner(item, 1, 1)).toEqual([0.5, -0.5]);
  });

  // A compound whose own transform is identity composes the same either way round, and so does a
  // nested clip that fills the frame -- so an order test needs both of them to be doing something.
  // Half the frame, and inside it a clip pushed a quarter of the frame to the right.
  it("applies its own placement outside the one the nested clip already has", () => {
    const both = project([
      track("trk_1", [
        compound(
          {
            id: "clp_group",
            start: 0,
            duration: 4 * SECOND,
            transform: transform({ scaleX: 0.5, scaleY: 0.5 }),
          },
          [track("trk_in", [clip({ id: "clp_a", transform: transform({ x: 480 }) })])],
        ),
      ]),
    ]);
    const item = list(both, 0).items[0]!;
    // 480 project pixels inside a group at half scale is 240 on screen, a quarter of the frame.
    expect(corner(item, 0.5, 0.5)[0]).toBeCloseTo(0.25);
    expect(corner(item, 0, 0)).toEqual([-0.25, 0.5]);
  });

  it("multiplies its opacity into the clips inside it", () => {
    const dimmed = project([
      track("trk_1", [
        compound(
          {
            id: "clp_group",
            start: 0,
            duration: 4 * SECOND,
            transform: transform({ opacity: 0.5 }),
          },
          [track("trk_in", [clip({ id: "clp_a", transform: transform({ opacity: 0.5 }) })])],
        ),
      ]),
    ]);
    expect(list(dimmed, 0).items[0]?.opacity).toBe(0.25);
  });

  // The chain runs the clip's own effects first and the group's over the result, which is the
  // order a frame graph would apply them in.
  it("runs its own effects after those of the clip inside it", () => {
    const chained = project([
      track("trk_1", [
        compound({ id: "clp_group", effects: [effect({ id: "eff_group", effectType: "contrast" })] }, [
          track("trk_in", [clip({ id: "clp_a", effects: [effect({ id: "eff_clip", effectType: "brightness" })] })]),
        ]),
      ]),
    ]);
    const resolved = params([
      ["eff_clip", [["amount", 1]]],
      ["eff_group", [["amount", 2]]],
    ]);
    expect(list(chained, 0, resolved).items[0]?.effects.map((pass) => pass.effect)).toEqual([
      "brightness",
      "contrast",
    ]);
  });

  it("stops at the nesting depth the loader accepts", () => {
    let deep = clip({ id: "clp_leaf", start: 0, duration: SECOND });
    for (let level = 0; level <= MAX_COMPOUND_DEPTH + 1; level += 1) {
      deep = compound({ id: `clp_${level}`, start: 0, duration: SECOND }, [
        track(`trk_${level}`, [deep]),
      ]);
    }
    expect(ids(list(project([track("trk_1", [deep])]), 0))).toEqual([]);
  });
});

// An adjustment track carries no picture. What it carries is a chain of effects that reaches
// every clip drawn below it, which is the whole reason `TrackKind` has the value -- and until this
// existed it had the value and nothing else.
describe("an adjustment track", () => {
  const graded = (over: Record<string, unknown> = {}): Clip =>
    clip({ id: "clp_grade", effects: [effect({ id: "eff_grade", effectType: "contrast" })], ...over });
  const resolved = params([["eff_grade", [["amount", 2]]]]);

  // Three seconds of picture under the layer, so a moment outside the layer's own clip still has
  // something drawn there -- otherwise "no grade here" and "nothing drawn here" would be the same
  // answer and the span check would prove nothing.
  function stack(over: Partial<Track> = {}, layer: Clip = graded()): Project {
    return project([
      track("trk_low", [clip({ id: "clp_low", start: 0, duration: 3 * SECOND })]),
      track("trk_grade", [layer], { kind: "adjustment", ...over }),
      track("trk_high", [clip({ id: "clp_high", start: 0, duration: 3 * SECOND })]),
    ]);
  }

  // Undefined rather than an empty list where the clip is not drawn at all, so a check for "no
  // grade" cannot be answered by a clip that is simply missing.
  const passesOn = (drawn: DrawList, id: string): string[] | undefined =>
    drawn.items.find((item) => item.clip === id)?.effects.map((pass) => pass.effect);

  // `tracks[0]` is the bottom, so a layer covers what is under it and leaves what is over it --
  // and checking only the first half would pass for a layer that covers everything.
  it("reaches the clips below it and not the ones above it", () => {
    const drawn = list(stack(), 0, resolved);
    expect(passesOn(drawn, "clp_low")).toEqual(["contrast"]);
    expect(passesOn(drawn, "clp_high")).toEqual([]);
  });

  it("still paints nothing of its own", () => {
    expect(ids(list(stack(), 0, resolved))).toEqual(["clp_low", "clp_high"]);
  });

  // The clip on the layer is what carries the span, so the grade starts and stops where it does.
  it("covers only the span of the clip that carries it", () => {
    const timed = stack({}, graded({ start: SECOND, duration: SECOND }));
    expect(passesOn(list(timed, 0, resolved), "clp_low")).toEqual([]);
    expect(passesOn(list(timed, SECOND, resolved), "clp_low")).toEqual(["contrast"]);
    expect(passesOn(list(timed, 2 * SECOND, resolved), "clp_low")).toEqual([]);
  });

  it("does nothing while its track is hidden or its layer faded out", () => {
    expect(passesOn(list(stack({ hidden: true }), 0, resolved), "clp_low")).toEqual([]);
    const faded = stack({}, graded({ transform: transform({ opacity: 0 }) }));
    expect(passesOn(list(faded, 0, resolved), "clp_low")).toEqual([]);
  });

  // The clip's own chain runs first and the layer's over the result: a grade is applied to the
  // picture as the clip finally looks, not to the picture before its own effects touched it.
  it("runs after the effects the clip itself carries", () => {
    const own = project([
      track("trk_low", [clip({ id: "clp_low", effects: [effect({ id: "eff_own", effectType: "blur" })] })]),
      track("trk_grade", [graded()], { kind: "adjustment" }),
    ]);
    const both = params([
      ["eff_own", [["radius", 1]]],
      ["eff_grade", [["amount", 2]]],
    ]);
    // blur is separable, so it is two passes of its own before the grade arrives.
    expect(passesOn(list(own, 0, both), "clp_low")).toEqual(["blur", "blur", "contrast"]);
  });

  // Two layers stacked: the lower one runs first, because that is the order they were put in.
  it("stacks with a second layer from the bottom up", () => {
    const two = project([
      track("trk_low", [clip({ id: "clp_low" })]),
      track("trk_a", [graded({ id: "clp_a", effects: [effect({ id: "eff_a", effectType: "contrast" })] })], { kind: "adjustment" }),
      track("trk_b", [graded({ id: "clp_b", effects: [effect({ id: "eff_b", effectType: "saturation" })] })], { kind: "adjustment" }),
    ]);
    const both = params([
      ["eff_a", [["amount", 2]]],
      ["eff_b", [["amount", 2]]],
    ]);
    expect(passesOn(list(two, 0, both), "clp_low")).toEqual(["contrast", "saturation"]);
  });

  // The second axis: a compound clip under a layer is drawn as the clips inside it, and every one
  // of them has to come out graded. Without this the grade would stop at the fold.
  it("reaches into a compound clip standing below it", () => {
    const folded = project([
      track("trk_low", [
        compound({ id: "clp_group", start: 0, duration: 2 * SECOND }, [
          track("trk_in", [clip({ id: "clp_a" }), clip({ id: "clp_b" })]),
        ]),
      ]),
      track("trk_grade", [graded()], { kind: "adjustment" }),
    ]);
    const drawn = list(folded, 0, resolved);
    expect(ids(drawn)).toEqual(["clp_a", "clp_b"]);
    expect(passesOn(drawn, "clp_a")).toEqual(["contrast"]);
    expect(passesOn(drawn, "clp_b")).toEqual(["contrast"]);
  });

  // Three chains in one item, and the only shape that pins their order: the clip's own effects run
  // first, then the layer standing over it inside the compound, then the compound's own over the
  // result. Without the compound carrying a chain of its own the last two could be swapped and the
  // list would look the same.
  it("runs between the clip it covers and the compound it stands in", () => {
    const folded = project([
      track("trk_1", [
        compound(
          {
            id: "clp_group",
            start: 0,
            duration: 2 * SECOND,
            effects: [effect({ id: "eff_group", effectType: "saturation" })],
          },
          [
            track("trk_in", [
              clip({ id: "clp_a", effects: [effect({ id: "eff_own", effectType: "sharpen" })] }),
            ]),
            track("trk_grade_in", [graded()], { kind: "adjustment" }),
          ],
        ),
      ]),
    ]);
    const all = params([
      ["eff_own", [["amount", 1]]],
      ["eff_grade", [["amount", 2]]],
      ["eff_group", [["amount", 2]]],
    ]);

    expect(passesOn(list(folded, 0, all), "clp_a")).toEqual(["sharpen", "contrast", "saturation"]);
  });

  // And the same rule one level down: a layer inside a compound covers what is inside it and stops
  // at the fold, rather than reaching out over the whole project.
  it("inside a compound clip covers only what is inside it", () => {
    const inside = project([
      track("trk_out", [clip({ id: "clp_outside" })]),
      track("trk_holder", [
        compound({ id: "clp_group", start: 0, duration: 2 * SECOND }, [
          track("trk_in", [clip({ id: "clp_inner" })]),
          track("trk_grade_in", [graded()], { kind: "adjustment" }),
        ]),
      ]),
    ]);
    const drawn = list(inside, 0, resolved);
    expect(passesOn(drawn, "clp_inner")).toEqual(["contrast"]);
    expect(passesOn(drawn, "clp_outside")).toEqual([]);
  });
});
