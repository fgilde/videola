import type { EffectManifest } from "./registry";

// Both clips move together: the outgoing one leaves in the direction of travel and the incoming one
// arrives behind it, as though they were two frames of one strip being pulled past the window. The
// slide beside it moves only the new clip over the old one, which reads as one picture laid on
// another rather than as one picture replacing another -- the difference is the whole reason both
// exist, and it is the transition every phone editor opens with.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_angle;
out vec4 color;

const float DEGREES = 0.017453293;

void main() {
  // Negated y, so the angle reads clockwise on screen like every other angle in this renderer.
  vec2 heading = vec2(cos(u_angle * DEGREES), -sin(u_angle * DEGREES));
  float travel = clamp(u_progress, 0.0, 1.0);
  vec2 outgoing = v_uv + heading * travel;
  vec2 incoming = v_uv + heading * (travel - 1.0);
  // Outside its own frame each clip contributes nothing at all rather than its clamped edge, which
  // is what would smear the last row of pixels across the picture behind it.
  vec4 leaving = any(lessThan(outgoing, vec2(0.0))) || any(greaterThan(outgoing, vec2(1.0)))
    ? vec4(0.0)
    : texture(u_source, outgoing);
  vec4 arriving = any(lessThan(incoming, vec2(0.0))) || any(greaterThan(incoming, vec2(1.0)))
    ? vec4(0.0)
    : texture(u_second, incoming);
  // Premultiplied, so the two halves add: at every fragment exactly one of them is inside its frame.
  color = leaving + arriving;
}
`;

export const push: EffectManifest = {
  id: "push",
  name: { de: "Schieben", en: "Push" },
  blurb: {
    de: "Schiebt den alten Clip hinaus und den neuen im selben Zug herein.",
    en: "Pushes the old clip out and the new one in with it, as one movement.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5, angle: 0 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    { key: "angle", name: { de: "Winkel", en: "Angle" }, default: 180, min: 0, max: 360 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
