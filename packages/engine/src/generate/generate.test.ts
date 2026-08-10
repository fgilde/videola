import { describe, expect, it } from "vitest";

import type { Clip, JsonValue, Transform } from "@videola/core";

import { countdownNumber, generatorKey, paintGenerator, paintsGenerator } from "./generator";
import { generatorMotion } from "./motion";
import { textStyle } from "./text";

const SECOND = 705_600_000;
const FRAME = { width: 1920, height: 1080 };

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

function title(style: Record<string, JsonValue>, over: Record<string, unknown> = {}): Clip {
  return {
    id: "clp_1",
    source: { kind: "generator", generator: { type: "text", content: "Hello", style } },
    start: 0,
    duration: 4 * SECOND,
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

// The style comes off a project file, a template or an agent, so these are rejections rather than
// defaults: what matters is that an unusable value never reaches the canvas, where a bad colour
// leaves `fillStyle` where it was and a bad font string silently gives a ten-pixel title.
describe("a text style from outside", () => {
  it("keeps a colour that is not a colour away from the canvas", () => {
    expect(textStyle({ color: "chartreuse" }).color).toBe("#ffffff");
    expect(textStyle({ color: "#ff0000; background: url(x)" }).color).toBe("#ffffff");
    expect(textStyle({ color: 17 as unknown as JsonValue }).color).toBe("#ffffff");
    expect(textStyle({ color: "#0f0" }).color).toBe("#0f0");
    expect(textStyle({ color: "#11223344" }).color).toBe("#11223344");
  });

  // An empty background means no box, which is a real value and not a missing one.
  it("tells an absent background from a broken one", () => {
    expect(textStyle({}).background).toBe("");
    expect(textStyle({ background: "" }).background).toBe("");
    expect(textStyle({ background: "transparent" }).background).toBe("");
    expect(textStyle({ background: "#000000aa" }).background).toBe("#000000aa");
  });

  it("strips a family name down to what a font shorthand can hold", () => {
    expect(textStyle({ fontFamily: 'Impact"; font-size: 2px' }).fontFamily).toBe("Impact font-size 2px");
    expect(textStyle({ fontFamily: "!!!" }).fontFamily).toBe("sans-serif");
    expect(textStyle({ fontFamily: "Helvetica Neue, Arial" }).fontFamily).toBe("Helvetica Neue, Arial");
  });

  it("pulls a number back into its range and refuses one that is not a number", () => {
    expect(textStyle({ fontSize: 900 }).fontSize).toBe(1);
    expect(textStyle({ fontSize: -3 }).fontSize).toBe(0.005);
    expect(textStyle({ fontSize: Number.NaN }).fontSize).toBe(0.09);
    expect(textStyle({ lineHeight: "big" as unknown as JsonValue }).lineHeight).toBe(1.25);
  });

  it("falls back to no animation for a move nobody implements", () => {
    expect(textStyle({ animateIn: "explode" }).animateIn).toBe("none");
    expect(textStyle({ animateIn: "rise" }).animateIn).toBe("rise");
  });
});

describe("a title's motion", () => {
  // The common path has to stay free: a clip nobody animated must come back with the very transform
  // it was given, or every project pays for the feature.
  it("leaves a clip with no animation exactly where it was", () => {
    const clip = title({});

    expect(generatorMotion(clip, SECOND, FRAME)).toEqual(clip.transform);
  });

  it("leaves a clip that is not a title alone", () => {
    const media = title({ animateIn: "fade" }, {
      source: { kind: "media", media: `med_${"a".repeat(64)}` },
    });

    expect(generatorMotion(media, 0, FRAME)).toEqual(media.transform);
  });

  it("fades in over its own length and not the clip's", () => {
    const clip = title({ animateIn: "fade", animateInSeconds: 1 });

    expect(generatorMotion(clip, 0, FRAME).opacity).toBe(0);
    expect(generatorMotion(clip, SECOND / 2, FRAME).opacity).toBeCloseTo(0.5);
    expect(generatorMotion(clip, SECOND, FRAME).opacity).toBe(1);
    expect(generatorMotion(clip, 2 * SECOND, FRAME).opacity).toBe(1);
  });

  // Both ends run through the same function, so a title that rises into place goes back down out of
  // it. Two tables for the two ends is how they come to disagree.
  it("takes the same path out that it took in", () => {
    const clip = title({ animateIn: "rise", animateOut: "rise", animateInSeconds: 1,
      animateOutSeconds: 1 });

    const entering = generatorMotion(clip, SECOND / 2, FRAME);
    const leaving = generatorMotion(clip, 3.5 * SECOND, FRAME);

    expect(entering.y).toBeGreaterThan(0);
    expect(entering.y).toBeCloseTo(leaving.y);
    expect(generatorMotion(clip, 2 * SECOND, FRAME).y).toBe(0);
  });

  it("travels a fraction of the frame rather than a fixed number of pixels", () => {
    const clip = title({ animateIn: "rise", animateInSeconds: 1 });

    const wide = generatorMotion(clip, 0, FRAME).y;
    const tall = generatorMotion(clip, 0, { width: 1080, height: 1920 }).y;

    expect(tall / wide).toBeCloseTo(1920 / 1080);
  });

  it("grows into place instead of moving", () => {
    const clip = title({ animateIn: "grow", animateInSeconds: 1 });

    const start = generatorMotion(clip, 0, FRAME);

    expect(start.scaleX).toBeCloseTo(0.85);
    expect(start.scaleY).toBeCloseTo(0.85);
    expect(start.y).toBe(0);
    expect(generatorMotion(clip, SECOND, FRAME).scaleX).toBe(1);
  });

  // The reason the animation is a transform and not a repaint: a loop changes the picture on screen
  // every frame while the glyphs are rasterised once.
  it("pulses on both sides of its resting size", () => {
    const clip = title({ loop: "pulse", loopSeconds: 2 });

    expect(generatorMotion(clip, SECOND / 2, FRAME).scaleX).toBeGreaterThan(1);
    expect(generatorMotion(clip, 1.5 * SECOND, FRAME).scaleX).toBeLessThan(1);
    expect(generatorMotion(clip, 2 * SECOND, FRAME).scaleX).toBeCloseTo(1);
  });

  it("multiplies into the transform the clip already carries", () => {
    const clip = title({ animateIn: "grow", animateInSeconds: 1 },
      { transform: transform({ opacity: 0.5, scaleX: 2, scaleY: 2, y: 100 }) });

    const start = generatorMotion(clip, 0, FRAME);

    expect(start.opacity).toBe(0);
    expect(start.scaleX).toBeCloseTo(1.7);
    expect(start.y).toBe(100);
  });

  // An animation of no length is over before it began. Dividing by it would give an infinity that
  // clamps to 1 by accident rather than on purpose.
  it("treats an animation of no length as no animation", () => {
    const clip = title({ animateIn: "fade", animateInSeconds: 0 });

    expect(generatorMotion(clip, 0, FRAME).opacity).toBe(1);
  });
});

// The whole reason a countdown is different from every other generator: its picture depends on when
// it is asked for, and the number is what the cache is keyed on.
describe("a countdown", () => {
  it("holds each number for a whole second and stops at zero", () => {
    expect(countdownNumber(3, 0)).toBe(3);
    expect(countdownNumber(3, 0.99)).toBe(3);
    expect(countdownNumber(3, 1)).toBe(2);
    expect(countdownNumber(3, 2.5)).toBe(1);
    expect(countdownNumber(3, 3)).toBe(0);
    expect(countdownNumber(3, 40)).toBe(0);
  });

  // Every number here comes off a project file, and a NaN would reach `String()` and paint "NaN"
  // across the frame.
  it("paints nothing rather than nonsense for a value from outside", () => {
    expect(countdownNumber(Number.NaN, 1)).toBe(0);
    expect(countdownNumber(3, Number.NaN)).toBe(0);
    expect(countdownNumber(-5, 0)).toBe(0);
    expect(countdownNumber(3.7, 0)).toBe(3);
    expect(countdownNumber(3, -2)).toBe(3);
  });
});

// A shape name is a free string in the model. What must not happen is a clip drawn as a white
// rectangle because the name was not understood: the draw list reads this and leaves it out.
describe("which generators have pixels", () => {
  it("takes the shapes it can draw and refuses the rest", () => {
    expect(paintsGenerator({ type: "shape", shape: "circle", color: "#fff" })).toBe(true);
    expect(paintsGenerator({ type: "shape", shape: "hexagon", color: "#fff" })).toBe(false);
    expect(paintsGenerator({ type: "shape", shape: "", color: "#fff" })).toBe(false);
  });

  it("draws a countdown, which the model has always carried", () => {
    expect(paintsGenerator({ type: "countdown", fromSeconds: 3 })).toBe(true);
  });
});

// A fake canvas, because what matters here is which glyphs were asked for and jsdom has no 2D
// context. Only the handful of members `paintText` touches: a missing one would throw rather than
// pass quietly, which is the failure mode a stub has to have.
function recorder(): { ctx: OffscreenCanvasRenderingContext2D; drawn: string[]; fills: number } {
  const drawn: string[] = [];
  const state = { fills: 0 };
  const ctx = {
    font: "",
    letterSpacing: "",
    textAlign: "center",
    textBaseline: "middle",
    lineWidth: 0,
    lineJoin: "round",
    fillStyle: "",
    strokeStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    clearRect: () => {},
    fillRect: () => {
      state.fills += 1;
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    arc: () => {},
    ellipse: () => {},
    fill: () => {
      state.fills += 1;
    },
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText: (text: string) => drawn.push(text),
    strokeText: () => {},
  };
  return {
    ctx: ctx as unknown as OffscreenCanvasRenderingContext2D,
    drawn,
    get fills() {
      return state.fills;
    },
  };
}

// The instant reaches the paint. Everything else in this renderer paints the same picture whenever it
// is asked; a countdown is the exception, and a picture that ignored the time it was handed would
// stand on its first number for the whole clip.
describe("painting a countdown", () => {
  it("draws the number the moment stands on", () => {
    const first = recorder();
    paintGenerator(first.ctx, { type: "countdown", fromSeconds: 3 }, FRAME, 0);
    expect(first.drawn).toEqual(["3"]);

    const later = recorder();
    paintGenerator(later.ctx, { type: "countdown", fromSeconds: 3 }, FRAME, 1.4);
    expect(later.drawn).toEqual(["2"]);
  });

  it("draws nothing once the count is out", () => {
    const spent = recorder();
    paintGenerator(spent.ctx, { type: "countdown", fromSeconds: 3 }, FRAME, 3);
    expect(spent.drawn).toEqual([]);
  });
});

describe("painting a shape", () => {
  it("fills for a shape it knows and leaves the frame alone for one it does not", () => {
    for (const shape of ["rectangle", "square", "ellipse", "circle", "triangle"]) {
      const drawn = recorder();
      paintGenerator(drawn.ctx, { type: "shape", shape, color: "#ff0000" }, FRAME);
      expect(drawn.fills).toBe(1);
      expect(drawn.ctx.fillStyle).toBe("#ff0000");
    }
    const unknown = recorder();
    paintGenerator(unknown.ctx, { type: "shape", shape: "hexagon", color: "#ff0000" }, FRAME);
    expect(unknown.fills).toBe(0);
  });

  // A colour off a project file reaches `fillStyle`, where an unparseable one leaves it at whatever
  // it was -- which is why it falls back here instead.
  it("keeps a colour that is not a colour off the canvas", () => {
    const drawn = recorder();
    paintGenerator(drawn.ctx, { type: "shape", shape: "circle", color: "rebeccapurple" }, FRAME);
    expect(drawn.ctx.fillStyle).toBe("#ffffff");
  });
});

// A generator's picture is painted once and held, which is what keeps a text layout off every frame.
// A countdown is the one that has to be repainted anyway, and the key is where that is decided: a key
// that ignored the instant would leave the first number standing for the whole clip.
describe("when a generator's picture has to be painted again", () => {
  const countdown = { type: "countdown", fromSeconds: 3 } as const;

  it("repaints a countdown once a second and not once a frame", () => {
    expect(generatorKey(countdown, FRAME, 0)).toBe(generatorKey(countdown, FRAME, 0.9));
    expect(generatorKey(countdown, FRAME, 0)).not.toBe(generatorKey(countdown, FRAME, 1));
  });

  it("holds every other generator whatever the instant", () => {
    const title = { type: "text", content: "Hello", style: {} } as const;
    expect(generatorKey(title, FRAME, 0)).toBe(generatorKey(title, FRAME, 12));
  });

  it("repaints on an edit and on a change of output size", () => {
    const other = { type: "countdown", fromSeconds: 5 } as const;
    expect(generatorKey(countdown, FRAME, 0)).not.toBe(generatorKey(other, FRAME, 0));
    expect(generatorKey(countdown, FRAME, 0)).not.toBe(
      generatorKey(countdown, { width: 3840, height: 2160 }, 0),
    );
  });
});
