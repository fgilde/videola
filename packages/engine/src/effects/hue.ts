import type { EffectManifest } from "./registry";

// Turn the whole colour wheel: a green field becomes autumn, a blue sky becomes teal, and skin can be
// pushed back to where it belongs after a bad white balance. The saturation effect beside it decides
// how much colour there is; this decides which.
//
// Rotated in YIQ rather than converted to HSV and back. HSV needs branches to find the hue at all,
// and a hue near the wrap-around point comes out of the round trip a step away from where it went in;
// YIQ is a rotation of two axes, which is three multiplications and cannot wrap.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_angle;
out vec4 color;

const float DEGREES = 0.017453293;
const mat3 TO_YIQ = mat3(
  0.299, 0.596, 0.211,
  0.587, -0.274, -0.523,
  0.114, -0.322, 0.312);
const mat3 TO_RGB = mat3(
  1.0, 1.0, 1.0,
  0.956, -0.272, -1.106,
  0.621, -0.647, 1.703);

void main() {
  vec4 source = texture(u_source, v_uv);
  float alpha = max(source.a, 0.0001);
  vec3 yiq = TO_YIQ * (source.rgb / alpha);
  float turn = u_angle * DEGREES;
  float cosine = cos(turn);
  float sine = sin(turn);
  vec3 turned = vec3(yiq.x, yiq.y * cosine - yiq.z * sine, yiq.y * sine + yiq.z * cosine);
  color = vec4(clamp(TO_RGB * turned, 0.0, 1.0) * alpha, source.a);
}
`;

export const hue: EffectManifest = {
  id: "hue",
  name: { de: "Farbton", en: "Hue" },
  blurb: {
    de: "Dreht das ganze Farbrad — für eine andere Jahreszeit oder einen verrutschten Weißabgleich.",
    en: "Turns the whole colour wheel — for another season, or a white balance that slipped.",
  },
  category: "color",
  inputs: 1,
  preview: { angle: 120 },
  params: [{ key: "angle", name: { de: "Drehung", en: "Rotation" }, default: 0, min: -180, max: 180 }],
  fragmentSource: FRAGMENT_SOURCE,
};
