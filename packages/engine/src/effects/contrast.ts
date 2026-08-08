import type { EffectManifest } from "./registry";

// The one colour operation in this library that is *not* linear in the channel values, so it is
// also the one that has to undo the premultiplication first. Pushing `a * c` around 0.5 pivots a
// half-transparent pixel about a point that is not grey, which shows up as a coloured haze along
// every soft edge.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
out vec4 color;

void main() {
  vec4 texel = texture(u_source, v_uv);
  if (texel.a <= 0.0) {
    color = texel;
    return;
  }
  vec3 straight = texel.rgb / texel.a;
  vec3 pushed = clamp((straight - 0.5) * u_amount + 0.5, 0.0, 1.0);
  color = vec4(pushed * texel.a, texel.a);
}
`;

export const contrast: EffectManifest = {
  id: "contrast",
  name: { de: "Kontrast", en: "Contrast" },
  category: "color",
  inputs: 1,
  // A slope about mid grey. 0 flattens the picture to that grey, 1 leaves it alone, and 4 is past
  // the point where an 8-bit source has any midtones left to separate.
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 4 }],
  fragmentSource: FRAGMENT_SOURCE,
};
