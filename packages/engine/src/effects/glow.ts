import type { EffectManifest } from "./registry";

// Light spilling out of the bright parts: a practical lamp, a sky through a window, white type on a
// dark plate. Two sweeps like the blur, and for the same reason -- but only what is above the
// threshold is spread, and the spread is *added* back rather than replacing the picture. That is what
// separates a glow from a soft-focus blur: the detail stays, the highlights bleed.
//
// The second pass carries the picture as well as the bright part, so the two cannot be told apart in
// one texture. They are kept apart by arithmetic instead: each pass adds the spread light to the
// picture it was given, so the first sweep spreads sideways and the second one spreads what the first
// produced downwards, and the untouched picture survives both. Slightly more light lands on a corner
// than a true two-dimensional kernel would put there, which is a glow being generous in exactly the
// place nobody measures.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
uniform float u_threshold;
uniform float u_radius;
uniform float u_pass;
out vec4 color;

const float WEIGHTS[5] = float[5](0.2270270, 0.1945946, 0.1216216, 0.0540541, 0.0162162);

// What counts as bright, in premultiplied values. Weighted the way an eye weighs the channels, so a
// saturated red does not glow like a white of the same numbers.
float brightness(vec4 texel) {
  return dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
}

vec3 bright(vec2 uv) {
  vec4 texel = texture(u_source, uv);
  float lit = brightness(texel);
  // Above the threshold and scaled by how far above: a hard cut would put a visible outline around
  // every bright area at the moment the threshold crossed it.
  return texel.rgb * clamp((lit - u_threshold) / max(1.0 - u_threshold, 0.001), 0.0, 1.0);
}

void main() {
  vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
  vec2 axis = u_pass < 0.5 ? vec2(texel.x, 0.0) : vec2(0.0, texel.y);
  vec2 stride = axis * u_radius;
  vec3 spread = bright(v_uv) * WEIGHTS[0];
  for (int tap = 1; tap < 5; tap += 1) {
    vec2 offset = stride * float(tap);
    spread += bright(v_uv + offset) * WEIGHTS[tap];
    spread += bright(v_uv - offset) * WEIGHTS[tap];
  }
  vec4 centre = texture(u_source, v_uv);
  // Clamped to the alpha, because premultiplied rgb above a is not a colour any compositor can put
  // over anything -- the same clamp brightness and the wheels make.
  color = vec4(min(centre.rgb + spread * u_amount, vec3(centre.a)), centre.a);
}
`;

export const glow: EffectManifest = {
  id: "glow",
  name: { de: "Leuchten", en: "Glow" },
  blurb: {
    de: "Lässt die hellen Stellen ausblühen, ohne die Zeichnung zu verlieren.",
    en: "Lets the bright parts bloom without losing the detail.",
  },
  category: "detail",
  inputs: 1,
  passes: 2,
  preview: { amount: 1.4, threshold: 0.5, radius: 8 },
  params: [
    { key: "amount", name: { de: "Stärke", en: "Amount" }, default: 0.6, min: 0, max: 3 },
    { key: "threshold", name: { de: "Schwelle", en: "Threshold" }, default: 0.7, min: 0, max: 1 },
    { key: "radius", name: { de: "Weite", en: "Radius" }, default: 6, min: 0, max: 32 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
