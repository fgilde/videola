import { CURVE_SAMPLES, IDENTITY_CURVE } from "@videola/core";

import type { EffectManifest } from "./registry";

/**
 * Four tone curves: one on brightness and one on each of the three channels.
 *
 * Non-linear in the channel values, so it undoes the premultiplication first and puts it back
 * after -- the same reason contrast does, and with the same cost for getting it wrong: a curve
 * applied to `a * c` pushes a half-covered pixel about a point that is not where the curve's own
 * knee is, which is a coloured haze along every soft edge.
 *
 * The brightness curve is not the three channel curves set to the same shape, and that is the
 * whole reason there are four rather than three. It reads the Rec.709 luma of the pixel, asks the
 * curve what that tone should become, and scales all three channels by the ratio -- so the ratio
 * between them, and therefore the hue and the saturation, come out exactly as they went in. The
 * same shape driven through the three channel curves separately does not: applying one curve to
 * 0.8 and to 0.2 moves them by different amounts, which is a saturation change nobody asked for.
 * That is a difference worth measuring, and the pixel harness measures it.
 *
 * What a ratio cannot do is lift something that is already black -- nought times anything is still
 * nought. Raising the foot of the brightness curve therefore opens the shadows and leaves true
 * black alone, which is the honest behaviour: use lift on the colour wheels, whose whole job is to
 * add rather than to scale.
 *
 * Brightness first, then the channels. A colourist sets the contrast, sees the cast that brings
 * out, and trims it -- doing it the other way round means every channel trim has to be redone
 * after the next move on the master.
 */
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_luma[${CURVE_SAMPLES}];
uniform float u_red[${CURVE_SAMPLES}];
uniform float u_green[${CURVE_SAMPLES}];
uniform float u_blue[${CURVE_SAMPLES}];
out vec4 color;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float LAST = ${CURVE_SAMPLES - 1}.0;

// The table holds the curve at evenly spaced tones; between two of them the shape is close enough
// to straight that the mix is under half of one 8-bit level out. curve.ts measures that.
float shaped(float table[${CURVE_SAMPLES}], float value) {
  float scaled = clamp(value, 0.0, 1.0) * LAST;
  float low = floor(scaled);
  int index = int(low);
  return mix(table[index], table[min(index + 1, ${CURVE_SAMPLES - 1})], scaled - low);
}

void main() {
  vec4 texel = texture(u_source, v_uv);
  if (texel.a <= 0.0) {
    color = texel;
    return;
  }
  vec3 straight = texel.rgb / texel.a;
  float tone = dot(straight, LUMA);
  // A scale, not an offset: the three channels keep their ratio and the pixel keeps its colour.
  straight *= tone > 0.0 ? shaped(u_luma, tone) / tone : 1.0;
  vec3 graded = vec3(
    shaped(u_red, straight.r),
    shaped(u_green, straight.g),
    shaped(u_blue, straight.b)
  );
  color = vec4(clamp(graded, 0.0, 1.0) * texel.a, texel.a);
}
`;

// An S about mid grey, and only on brightness: the tile has to show what a curve is for, and a
// curve that tinted the picture would be showing what the colour wheels are for instead. A knee at
// a quarter and a shoulder at three quarters is the shape everybody draws first.
const PREVIEW_S: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.25, 0.08],
  [0.75, 0.92],
  [1, 1],
];

export const curves: EffectManifest = {
  id: "curves",
  name: { de: "Kurven", en: "Curves" },
  blurb: {
    de: "Zieht einzelne Tonwerte an Stützpunkten hoch oder herunter, für Helligkeit und je Kanal.",
    en: "Drags single tones up or down at control points, on brightness and on each channel.",
  },
  category: "color",
  inputs: 1,
  preview: { luma: PREVIEW_S },
  params: [
    {
      kind: "curve",
      key: "luma",
      name: { de: "Helligkeit", en: "Brightness" },
      default: IDENTITY_CURVE,
    },
    { kind: "curve", key: "red", name: { de: "Rot", en: "Red" }, default: IDENTITY_CURVE },
    { kind: "curve", key: "green", name: { de: "Grün", en: "Green" }, default: IDENTITY_CURVE },
    { kind: "curve", key: "blue", name: { de: "Blau", en: "Blue" }, default: IDENTITY_CURVE },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
