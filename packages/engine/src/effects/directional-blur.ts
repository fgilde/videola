import type { EffectManifest } from "./registry";

// A smear along one axis, which is what a fast pan or a whip looks like. Not motion blur: motion blur
// is derived from where the picture actually went between two instants, and that needs more than one
// decoded frame per output frame. This is the tool a person aims by hand, and it says so in its name.
//
// A single pass rather than the separable two the blur uses: the axis is not the texel grid, so the
// second sweep would smear across the direction rather than along it. Thirteen taps in one direction
// cost what the blur's eighteen do in two, and the taps are spread over the whole length so a long
// smear stays smooth instead of banding into copies.
//
// Premultiplied throughout, like every other average here: on straight values a transparent texel
// would count for as much as an opaque one and the smear would darken towards the edge of a cutout.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_length;
uniform float u_angle;
out vec4 color;

const int TAPS = 13;

void main() {
  vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
  float radians = u_angle * 0.017453292;
  // Clockwise on the screen, like the transform's own rotation: canvas and texture space both run y
  // down the picture, and an effect that turned the other way would disagree with the number in the
  // properties panel.
  vec2 axis = vec2(cos(radians), sin(radians)) * texel * u_length;
  vec4 sum = vec4(0.0);
  for (int tap = 0; tap < TAPS; tap += 1) {
    // -0.5 to 0.5 of the length, so the smear straddles the picture rather than pulling it to one
    // side: a blur that moved the subject would read as a mistake in the transform.
    float along = float(tap) / float(TAPS - 1) - 0.5;
    sum += texture(u_source, v_uv + axis * along);
  }
  color = sum / float(TAPS);
}
`;

export const directionalBlur: EffectManifest = {
  id: "directional-blur",
  name: { de: "Richtungsunschärfe", en: "Directional blur" },
  blurb: {
    de: "Zieht das Bild entlang einer Achse — wie ein schneller Schwenk.",
    en: "Smears the picture along one axis, the way a fast pan looks.",
  },
  category: "detail",
  inputs: 1,
  preview: { length: 40, angle: 0 },
  params: [
    { key: "length", name: { de: "Länge", en: "Length" }, default: 0, min: 0, max: 200 },
    { key: "angle", name: { de: "Winkel", en: "Angle" }, default: 0, min: -180, max: 180 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
