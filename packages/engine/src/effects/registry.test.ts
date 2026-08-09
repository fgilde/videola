import { describe, expect, it } from "vitest";

import { clampColor, clampParam, effect, effectManifests, previewValues } from "./registry";
import type { ColorParam, EffectParam } from "./registry";

describe("the effect registry", () => {
  it("answers for an effect type it does not know instead of throwing", () => {
    expect(effect("no-such-effect")).toBeUndefined();
    expect(effect("brightness")?.id).toBe("brightness");
  });

  it("carries a name in both languages for every effect", () => {
    for (const manifest of effectManifests()) {
      expect(manifest.name.de.length).toBeGreaterThan(0);
      expect(manifest.name.en.length).toBeGreaterThan(0);
      expect(manifest.name.de).not.toBe(manifest.name.en);
    }
  });

  // The inspector labels a parameter row from the manifest and never from the catalogues, so a
  // parameter without a name would put an untranslated key like "amount" on screen.
  it("carries a name in both languages for every parameter", () => {
    for (const manifest of effectManifests()) {
      for (const param of manifest.params) {
        expect(param.name.de.length, `${manifest.id}.${param.key}`).toBeGreaterThan(0);
        expect(param.name.en.length, `${manifest.id}.${param.key}`).toBeGreaterThan(0);
        expect(param.name.de, `${manifest.id}.${param.key}`).not.toBe(param.name.en);
      }
    }
  });

  it("keeps every default inside the range the same manifest declares", () => {
    for (const manifest of effectManifests()) {
      for (const param of floats(manifest.params)) {
        expect(param.min).toBeLessThan(param.max);
        expect(param.default).toBeGreaterThanOrEqual(param.min);
        expect(param.default).toBeLessThanOrEqual(param.max);
      }
    }
  });

  // A colour is only a legal premultiplied texel while no channel is above its own alpha, and a
  // default is the one value nobody ever chose on purpose.
  it("keeps every colour default inside the unit cube", () => {
    for (const manifest of effectManifests()) {
      for (const param of colours(manifest.params)) {
        for (const channel of param.default) {
          expect(channel, `${manifest.id}.${param.key}`).toBeGreaterThanOrEqual(0);
          expect(channel, `${manifest.id}.${param.key}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  // The manifest and its GLSL are two lists that can drift apart, and the drift is invisible:
  // `getUniformLocation` returns null for a name the shader never declared and `setUniforms`
  // skips it, so a parameter renamed on one side alone silently stops doing anything.
  //
  // The kind is checked with the name, because that is the other half of the same drift: a colour
  // declared as `uniform float` links, takes the first component of nothing, and the effect quietly
  // reads a parameter no control writes.
  it("declares a uniform of the right type for every parameter in the manifest", () => {
    for (const manifest of effectManifests()) {
      for (const param of manifest.params) {
        const type = param.kind === "color" ? "vec4" : "float";
        expect(manifest.fragmentSource, `${manifest.id}.${param.key}`).toContain(
          `uniform ${type} u_${param.key};`,
        );
      }
      const second = manifest.fragmentSource.includes("uniform sampler2D u_second;");
      expect(second).toBe(manifest.inputs === 2);
    }
  });

  it("pulls a value from outside the declared range back into it", () => {
    const amount = effect("brightness")!.params[0] as EffectParam;

    expect(clampParam(amount, 9)).toBe(amount.max);
    expect(clampParam(amount, -1)).toBe(amount.min);
    expect(clampParam(amount, 2)).toBe(2);
  });

  // A NaN travels through uniform1f without complaint and paints the clip black, which looks like
  // a decoding failure rather than like a parameter.
  it("falls back to the default for a value that is not a number", () => {
    const amount = effect("brightness")!.params[0] as EffectParam;

    expect(clampParam(amount, Number.NaN)).toBe(amount.default);
    expect(clampParam(amount, Number.POSITIVE_INFINITY)).toBe(amount.default);
  });

  describe("a colour parameter", () => {
    const colour = colours(effect("dip")!.params)[0]!;

    // The reason a colour is premultiplied on the way to the uniform: half-covered white is 0.5,
    // not 1. Straight alpha is the reflex and it composites the dip twice as bright as it is.
    it("comes out premultiplied, like every other colour that reaches a shader", () => {
      expect(clampColor(colour, [1, 1, 1, 0.5])).toEqual([0.5, 0.5, 0.5, 0.5]);
    });

    // The gap nothing else covers: RGBA8 clamps a channel above one on its own, so a check that
    // only fed it 1.4 would prove nothing. Above *alpha* and below one is where a texel stops being
    // a legal premultiplied colour and no target notices.
    it("never lets a channel out above its own alpha", () => {
      const [r, g, b, a] = clampColor(colour, [0.9, 0.8, 0.7, 0.4]) as number[];
      expect(a).toBe(0.4);
      for (const channel of [r, g, b]) expect(channel).toBeLessThanOrEqual(a!);
    });

    it("falls back to its default for a value of the wrong kind, or one with a NaN in it", () => {
      const fallback = clampColor(colour, colour.default);
      expect(clampColor(colour, 0.5)).toEqual(fallback);
      expect(clampColor(colour, [1, 2, 3])).toEqual(fallback);
      expect(clampColor(colour, [1, Number.NaN, 0, 1])).toEqual(fallback);
    });

    // A preview setting is authored by hand in the same file as the parameter, so it is exactly as
    // able to be out of range as a project file is.
    it("is clamped in a tile too, not only in the timeline", () => {
      const values = previewValues({ ...effect("dip")!, preview: { colour: [4, 0, 0, 1] } });
      expect(values.colour).toEqual([1, 0, 0, 1]);
    });
  });
});

function floats(params: readonly { kind?: string }[]): EffectParam[] {
  return params.filter((param) => param.kind !== "color") as EffectParam[];
}

function colours(params: readonly { kind?: string }[]): ColorParam[] {
  return params.filter((param) => param.kind === "color") as ColorParam[];
}
