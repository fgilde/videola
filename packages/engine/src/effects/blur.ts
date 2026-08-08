import type { EffectManifest } from "./registry";

// Separable, so it declares `passes: 2` and the chain runs it twice: `u_pass` is 0 for the
// horizontal sweep and 1 for the vertical one. Nine taps in one direction and nine in the other is
// eighteen samples for a kernel that a single pass would need eighty-one for.
//
// A weighted average is the operation premultiplied alpha exists for. On straight values the colour
// of a transparent texel counts as much as an opaque one's, which is the dark halo around every
// blurred cutout; here the weights fall on `a * c` and `a` together and the edge stays clean.
//
// ponytail: the nine taps sit at a fixed spacing, so a large radius samples a comb rather than a
// disc and fine detail beats against it. The usual way out is to blur a half-size copy and let
// bilinear filtering fill in -- that needs the target pool the compositor already asks for.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
uniform float u_pass;
out vec4 color;

const float WEIGHTS[5] = float[5](0.2270270, 0.1945946, 0.1216216, 0.0540541, 0.0162162);

void main() {
  vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
  vec2 axis = u_pass < 0.5 ? vec2(texel.x, 0.0) : vec2(0.0, texel.y);
  vec2 stride = axis * u_amount;
  vec4 sum = texture(u_source, v_uv) * WEIGHTS[0];
  for (int tap = 1; tap < 5; tap += 1) {
    vec2 offset = stride * float(tap);
    sum += texture(u_source, v_uv + offset) * WEIGHTS[tap];
    sum += texture(u_source, v_uv - offset) * WEIGHTS[tap];
  }
  color = sum;
}
`;

export const blur: EffectManifest = {
  id: "blur",
  name: { de: "Weichzeichnen", en: "Blur" },
  category: "detail",
  inputs: 1,
  passes: 2,
  // Spacing between taps, in pixels of the frame. At 0 every tap lands on the same texel and the
  // weights sum to one, so the picture comes back untouched -- the slider has a real off position
  // rather than a nearly-off one.
  params: [{ key: "amount", name: { de: "Staerke", en: "Amount" }, default: 2, min: 0, max: 16 }],
  fragmentSource: FRAGMENT_SOURCE,
};
