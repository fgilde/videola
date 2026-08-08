import type { EffectManifest } from "./registry";

// An unsharp mask against the four neighbours: the picture plus what a one-pixel blur took away.
// Linear in the channel values, so premultiplied is the right space -- but extrapolating away from
// the average overshoots in both directions, and above `a` the result is not a colour any more.
//
// Alpha is carried through untouched on purpose. Sharpening it would ring along the edge of a
// cutout, which reads as a bright fringe rather than as detail.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
out vec4 color;

void main() {
  vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
  vec4 centre = texture(u_source, v_uv);
  vec4 around = 0.25 * (texture(u_source, v_uv + vec2(texel.x, 0.0))
    + texture(u_source, v_uv - vec2(texel.x, 0.0))
    + texture(u_source, v_uv + vec2(0.0, texel.y))
    + texture(u_source, v_uv - vec2(0.0, texel.y)));
  vec3 sharp = centre.rgb + (centre.rgb - around.rgb) * u_amount;
  color = vec4(clamp(sharp, vec3(0.0), vec3(centre.a)), centre.a);
}
`;

export const sharpen: EffectManifest = {
  id: "sharpen",
  name: { de: "Schärfen", en: "Sharpen" },
  category: "detail",
  inputs: 1,
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 4 }],
  fragmentSource: FRAGMENT_SOURCE,
};
