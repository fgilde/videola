import { describe, expect, it } from "vitest";

import { clampParam, effect, effectManifests } from "./registry";

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
      for (const param of manifest.params) {
        expect(param.min).toBeLessThan(param.max);
        expect(param.default).toBeGreaterThanOrEqual(param.min);
        expect(param.default).toBeLessThanOrEqual(param.max);
      }
    }
  });

  // The manifest and its GLSL are two lists that can drift apart, and the drift is invisible:
  // `getUniformLocation` returns null for a name the shader never declared and `setUniforms`
  // skips it, so a parameter renamed on one side alone silently stops doing anything.
  it("declares a uniform in the shader for every parameter in the manifest", () => {
    for (const manifest of effectManifests()) {
      for (const param of manifest.params) {
        expect(manifest.fragmentSource).toContain(`uniform float u_${param.key};`);
      }
      const second = manifest.fragmentSource.includes("uniform sampler2D u_second;");
      expect(second).toBe(manifest.inputs === 2);
    }
  });

  it("pulls a value from outside the declared range back into it", () => {
    const amount = effect("brightness")!.params[0]!;

    expect(clampParam(amount, 9)).toBe(amount.max);
    expect(clampParam(amount, -1)).toBe(amount.min);
    expect(clampParam(amount, 2)).toBe(2);
  });

  // A NaN travels through uniform1f without complaint and paints the clip black, which looks like
  // a decoding failure rather than like a parameter.
  it("falls back to the default for a value that is not a number", () => {
    const amount = effect("brightness")!.params[0]!;

    expect(clampParam(amount, Number.NaN)).toBe(amount.default);
    expect(clampParam(amount, Number.POSITIVE_INFINITY)).toBe(amount.default);
  });
});
