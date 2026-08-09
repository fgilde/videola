import type { EffectManifest } from "./registry";

/**
 * Lift, gamma and gain: the three knobs a colourist reaches for before any other.
 *
 * They are one effect rather than three because they are one line. Lift says where black goes and
 * gain says where white goes -- between them they define a straight line through the tone range --
 * and gamma bends what lies between without moving either end. Split into three effects, the chain
 * would run three unpremultiply/premultiply round trips and three clamps to compute one line, and
 * the middle one would be clamping a picture the last one is about to stretch again.
 *
 * Each wheel is a tint and a strength, which is what the two controls on a real panel are: the
 * wheel pushes the three channels apart and the ring moves all three together. A tint is stored as
 * a colour, so mid grey is no tint at all and the distance from mid grey is the push. It arrives
 * premultiplied like every colour that reaches a shader here, and is divided back out: alpha is
 * coverage, and a tint covers nothing.
 *
 * Non-linear in the channel values -- a gamma plainly so, but so is a lift, which adds a constant
 * that premultiplication would have scaled. Hence the round trip through straight alpha, and hence
 * the clamp to alpha on the way out: past that a texel is no longer a premultiplied colour and no
 * over-operator can composite it.
 */
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform vec4 u_liftTint;
uniform float u_liftAmount;
uniform vec4 u_gammaTint;
uniform float u_gammaAmount;
uniform vec4 u_gainTint;
uniform float u_gainAmount;
out vec4 color;

// How far a fully saturated tint pushes one channel. Half the distance the strength ring reaches,
// because a wheel is for balance and a ring is for exposure -- a tint able to swamp the ring turns
// the wheel into a second, clumsier brightness control.
const float TINT_REACH = 0.5;

vec3 wheel(vec4 tint, float amount) {
  vec3 straight = tint.a > 0.0 ? tint.rgb / tint.a : vec3(0.5);
  return (straight - 0.5) * TINT_REACH + amount;
}

void main() {
  vec4 texel = texture(u_source, v_uv);
  if (texel.a <= 0.0) {
    color = texel;
    return;
  }
  vec3 straight = texel.rgb / texel.a;
  vec3 black = wheel(u_liftTint, u_liftAmount);
  vec3 white = 1.0 + wheel(u_gainTint, u_gainAmount);
  // The printer-light line: lift is where nought lands, gain is where one lands, and everything
  // between rides on the straight line the two of them make.
  vec3 graded = black + straight * (white - black);
  // Bent afterwards, so the midtones move without either end of that line coming with them. The
  // floor keeps pow away from a negative base, which is undefined and comes back as a NaN.
  vec3 bend = 1.0 + wheel(u_gammaTint, u_gammaAmount);
  graded = pow(max(graded, vec3(0.0)), 1.0 / max(bend, vec3(0.05)));
  color = vec4(clamp(graded, vec3(0.0), vec3(1.0)) * texel.a, texel.a);
}
`;

const NEUTRAL: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 1];

export const colorWheels: EffectManifest = {
  id: "colorWheels",
  name: { de: "Farbräder", en: "Colour wheels" },
  blurb: {
    de: "Setzt Schwarzpunkt, Mitten und Weißpunkt getrennt, jeweils mit Farbstich und Stärke.",
    en: "Sets the black point, the midtones and the white point apart, each with a tint and a strength.",
  },
  category: "color",
  inputs: 1,
  // A cool foot and a warm head: the split tone everybody recognises, and a setting no slider at
  // its default could reach. Neutral tints with a strength of nought is the untouched picture.
  preview: {
    liftTint: [0.34, 0.44, 0.72, 1],
    gainTint: [0.76, 0.52, 0.3, 1],
    gammaAmount: -0.18,
  },
  params: [
    { kind: "color", key: "liftTint", name: { de: "Schatten-Ton", en: "Shadow tint" }, default: NEUTRAL },
    {
      key: "liftAmount",
      name: { de: "Schatten-Stärke", en: "Shadow strength" },
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    { kind: "color", key: "gammaTint", name: { de: "Mitten-Ton", en: "Midtone tint" }, default: NEUTRAL },
    {
      key: "gammaAmount",
      name: { de: "Mitten-Stärke", en: "Midtone strength" },
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    { kind: "color", key: "gainTint", name: { de: "Lichter-Ton", en: "Highlight tint" }, default: NEUTRAL },
    {
      key: "gainAmount",
      name: { de: "Lichter-Stärke", en: "Highlight strength" },
      default: 0,
      min: -0.5,
      max: 0.5,
    },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
