import type { EffectManifest } from "./registry";

// The hand-over that looks like the camera was thrown: both clips streak sideways, hardest in the
// middle where the change happens, and the streak is gone by the time either clip is standing still.
// Every phone editor has one, and it is the transition that hides a mismatched cut better than any
// dissolve — the eye cannot compare two frames it never saw sharp.
//
// A directional blur of the two clips rather than a slide with a blur laid over it: the smear has to
// be in the pictures, or the edge between them stays sharp inside a blurred frame and reads as a
// mistake. Nine taps along the heading is enough at this length; more is invisible and costs.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_angle;
uniform float u_amount;
out vec4 color;

const float DEGREES = 0.017453293;
const int TAPS = 9;

vec4 smear(sampler2D picture, vec2 at, vec2 step_by) {
  vec4 sum = vec4(0.0);
  for (int tap = 0; tap < TAPS; tap += 1) {
    float offset = float(tap) / float(TAPS - 1) - 0.5;
    sum += texture(picture, clamp(at + step_by * offset, vec2(0.0), vec2(1.0)));
  }
  return sum / float(TAPS);
}

void main() {
  float progress = clamp(u_progress, 0.0, 1.0);
  // A tent again: sharp at both ends, fully smeared in the middle. Squared, so the sharp end lasts
  // longer than the smear -- a whip that is still soft when the new clip arrives looks out of focus.
  float force = 1.0 - abs(progress * 2.0 - 1.0);
  vec2 frame = vec2(textureSize(u_source, 0));
  vec2 heading = vec2(cos(u_angle * DEGREES), -sin(u_angle * DEGREES)) * u_amount * force * force / frame;
  vec4 leaving = smear(u_source, v_uv, heading);
  vec4 arriving = smear(u_second, v_uv, heading);
  // The cut itself sits in the middle of the smear, where there is least to compare.
  color = mix(leaving, arriving, smoothstep(0.45, 0.55, progress));
}
`;

export const whipPan: EffectManifest = {
  id: "whip-pan",
  name: { de: "Schwenk", en: "Whip pan" },
  blurb: {
    de: "Beide Clips ziehen zur Seite, der Schnitt liegt mitten im Schmieren.",
    en: "Both clips streak sideways and the cut sits in the middle of the smear.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5, angle: 0, amount: 220 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    { key: "angle", name: { de: "Winkel", en: "Angle" }, default: 0, min: 0, max: 360 },
    // In pixels of the frame, like the blur beside it: 200 is a hard throw at 1080p.
    { key: "amount", name: { de: "Länge", en: "Length" }, default: 180, min: 0, max: 600 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
