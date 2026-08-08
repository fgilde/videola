import type { EffectManifest } from "./registry";

// Darkens the corners and leaves alpha where it was. Scaling rgb down below `a` keeps the texel a
// valid premultiplied colour, so this needs no clamp and no unpremultiplication.
//
// The falloff is measured in `v_uv`, which is the *frame*, not the clip: the chain runs after the
// transform, so a clip that covers half the frame gets the half of the vignette it sits under. That
// is what a vignette is -- a property of the shot, not of the layer.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
uniform float u_size;
out vec4 color;

// Half the diagonal of the unit square: the distance to a corner, and so where the darkening is
// fully in effect.
const float CORNER = 1.4142136;

void main() {
  vec4 texel = texture(u_source, v_uv);
  float away = length((v_uv - 0.5) * 2.0);
  float keep = 1.0 - u_amount * smoothstep(u_size, CORNER, away);
  color = vec4(texel.rgb * keep, texel.a);
}
`;

export const vignette: EffectManifest = {
  id: "vignette",
  name: { de: "Vignettierung", en: "Vignette" },
  category: "color",
  inputs: 1,
  params: [
    { key: "amount", name: { de: "Stärke", en: "Amount" }, default: 0.5, min: 0, max: 1 },
    // Where the darkening begins, as a distance from the centre in half-frames. The ceiling stops
    // just short of the corner: at exactly `CORNER` the two edges of the smoothstep would coincide
    // and the driver is free to do anything it likes with the division that follows.
    { key: "size", name: { de: "Größe", en: "Size" }, default: 0.6, min: 0, max: 1.4 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
