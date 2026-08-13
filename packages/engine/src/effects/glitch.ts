import type { EffectManifest } from "./registry";

// The hand-over every short-form editor has: the picture tears into bands, the colour separates, and
// the new clip is underneath when it settles. Loud on purpose — it is the one transition somebody
// picks *because* it is loud.
//
// The tearing is strongest in the middle of the transition and gone at both ends, so the cut it
// makes is clean: a glitch that is still displacing rows at progress 1 leaves a torn first frame on
// the new clip, which reads as a decode fault rather than as an effect.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_amount;
uniform float u_bands;
out vec4 color;

float hash(float at) {
  return fract(sin(at * 78.233) * 43758.5453123);
}

void main() {
  float progress = clamp(u_progress, 0.0, 1.0);
  // A tent: nothing at either end, everything in the middle.
  float force = (1.0 - abs(progress * 2.0 - 1.0)) * u_amount;
  float band = floor(v_uv.y * max(u_bands, 1.0));
  // Each band jumps sideways by its own amount, and the amount is redrawn as the progress moves --
  // hashing the progress in coarse steps rather than continuously is what makes it stutter rather
  // than slide.
  float jump = (hash(band + floor(progress * 12.0) * 31.0) - 0.5) * force * 0.4;
  vec2 torn = clamp(vec2(v_uv.x + jump, v_uv.y), vec2(0.0), vec2(1.0));
  vec4 leaving = texture(u_source, torn);
  vec4 arriving = texture(u_second, torn);
  float blend = smoothstep(0.35, 0.65, progress);
  vec4 mixed = mix(leaving, arriving, blend);
  // And the colour comes apart with it, which is what says "glitch" rather than "torn". Both clips
  // are sampled and then mixed by the same blend: a sampler cannot be chosen by an expression in
  // GLSL ES, and picking one with a branch would be the same two fetches with a branch on top.
  float shift = force * 0.02;
  vec2 red_at = clamp(torn + vec2(shift, 0.0), vec2(0.0), vec2(1.0));
  vec2 blue_at = clamp(torn - vec2(shift, 0.0), vec2(0.0), vec2(1.0));
  float red = mix(texture(u_source, red_at).r, texture(u_second, red_at).r, blend);
  float blue = mix(texture(u_source, blue_at).b, texture(u_second, blue_at).b, blend);
  color = vec4(mix(mixed.rgb, vec3(red, mixed.g, blue), clamp(force, 0.0, 1.0)), mixed.a);
}
`;

export const glitch: EffectManifest = {
  id: "glitch",
  name: { de: "Bildstörung", en: "Glitch" },
  blurb: {
    de: "Reißt das Bild in Bänder und zieht die Farbe auseinander — laut, mit Absicht.",
    en: "Tears the picture into bands and pulls the colour apart — loud, on purpose.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5, amount: 1, bands: 14 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    { key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 2 },
    { key: "bands", name: { de: "Bänder", en: "Bands" }, default: 12, min: 2, max: 60 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
