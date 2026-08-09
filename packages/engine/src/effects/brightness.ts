import type { EffectManifest } from "./registry";

// Scaling rgb is the one colour operation that reads the same on straight and on premultiplied
// values, so brightness needs no conversion -- but it does need the clamp. Past `a` the texel is
// no longer a valid premultiplied colour, and the over-operator would let a half-transparent clip
// paint brighter than an opaque one at the same setting.
//
// ponytail: the overshoot is clipped rather than carried. An RGBA8 target cannot hold more than
// 1.0 anyway; keeping highlights needs a half-float chain and a tone curve at the end of it.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
out vec4 color;

void main() {
  vec4 texel = texture(u_source, v_uv);
  color = vec4(min(texel.rgb * u_amount, vec3(texel.a)), texel.a);
}
`;

export const brightness: EffectManifest = {
  id: "brightness",
  name: { de: "Helligkeit", en: "Brightness" },
  blurb: {
    de: "Hebt oder senkt die Helligkeit des ganzen Bildes.",
    en: "Lifts or lowers the whole picture.",
  },
  category: "color",
  inputs: 1,
  preview: { amount: 2.2 },
  // A gain, so 1 is the untouched picture and 0 is black. The ceiling is four stops of headroom,
  // which is as much as an 8-bit source can be pushed before it is only noise.
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 4 }],
  fragmentSource: FRAGMENT_SOURCE,
};
