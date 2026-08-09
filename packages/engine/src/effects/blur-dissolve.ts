import type { EffectManifest } from "./registry";

// A dissolve that goes soft in the middle: both pictures blur as the mix crosses over and come back
// sharp at either end. The blur is what hides the double exposure a plain cross dissolve shows on a
// cut between two moving shots.
//
// One pass rather than the blur's two, and a ring of taps rather than a separable kernel: this is a
// radius that lives for half a second and is at its widest where the picture is half of each, so
// what it has to be is cheap and round. A separable version would need the chain to run a transition
// twice, which nothing in the frame graph does.
//
// `sin(progress * PI)` is the strength: nought at both ends, one in the middle. Sampling in
// premultiplied space is what keeps the soft edges from haloing -- the weights fall on `a * c` and
// `a` together.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_amount;
out vec4 color;

const float PI = 3.1415927;
const int TAPS = 8;

vec4 smear(sampler2D picture, vec2 texel, float radius) {
  vec4 sum = texture(picture, v_uv);
  if (radius <= 0.0) return sum;
  for (int tap = 0; tap < TAPS; tap += 1) {
    float turn = (float(tap) + 0.5) / float(TAPS) * 2.0 * PI;
    // Two rings rather than one: a single ring of eight is a visible octagon at any radius worth
    // having, and the inner one costs eight more samples of a texture already in cache.
    sum += texture(picture, v_uv + vec2(cos(turn), sin(turn)) * texel * radius);
    sum += texture(picture, v_uv + vec2(cos(turn), sin(turn)) * texel * radius * 0.5);
  }
  return sum / float(TAPS * 2 + 1);
}

void main() {
  vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
  float radius = sin(clamp(u_progress, 0.0, 1.0) * PI) * u_amount;
  color = mix(smear(u_source, texel, radius), smear(u_second, texel, radius), 1.0 - u_progress);
}
`;

export const blurDissolve: EffectManifest = {
  id: "blur-dissolve",
  name: { de: "Weichzeichnen-Blende", en: "Blur dissolve" },
  blurb: {
    de: "Blendet über und zeichnet dabei in der Mitte weich.",
    en: "Dissolves across, going soft in the middle.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    // Pixels of the frame at the widest point, like the blur's own spacing. At 0 this is a plain
    // cross dissolve, which is a real off position rather than a nearly-off one.
    { key: "amount", name: { de: "Stärke", en: "Amount" }, default: 12, min: 0, max: 48 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
