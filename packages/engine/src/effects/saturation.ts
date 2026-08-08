import type { EffectManifest } from "./registry";

// Mixing towards grey is linear in the channel values, so it needs no unpremultiplication: the
// weighted sum of `a * c` is `a` times the weighted sum of `c`. Past 1 the mix extrapolates and can
// push a channel over `a`, which is no longer a premultiplied colour -- hence the clamp.
//
// ponytail: BT.709 weights on the non-linear sRGB values the textures arrive in, which is luma
// rather than luminance. It is what every editor's saturation slider does; a colorimetric version
// needs the linear-light pipeline the compositor leaves as a marked simplification.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
out vec4 color;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 texel = texture(u_source, v_uv);
  vec3 grey = vec3(dot(texel.rgb, LUMA));
  vec3 mixed = clamp(mix(grey, texel.rgb, u_amount), vec3(0.0), vec3(texel.a));
  color = vec4(mixed, texel.a);
}
`;

export const saturation: EffectManifest = {
  id: "saturation",
  name: { de: "Sättigung", en: "Saturation" },
  category: "color",
  inputs: 1,
  // Zero is black and white, which is why this library has no separate monochrome effect: it would
  // be the same shader with the slider nailed down.
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 2 }],
  fragmentSource: FRAGMENT_SOURCE,
};
