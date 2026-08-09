import type { EffectManifest } from "./registry";

// Both pictures travel, which is what makes this a push rather than a wipe: the incoming clip comes
// in from off-frame and shoves the outgoing one out the far side. Each fragment shows whichever of
// the two has arrived there, and both are sampled at their own displaced position.
//
// `heading / span` is one whole frame's worth of travel along the heading, so the two pictures move
// at the same rate the boundary between them does. Get that wrong and there is a gap.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_angle;
out vec4 color;

const float DEGREES = 0.017453293;

// Negated y for the same reason the wipe negates it: in a pass v_uv runs up the picture, and the
// angle is meant to read clockwise on screen.
void main() {
  vec2 heading = vec2(cos(u_angle * DEGREES), -sin(u_angle * DEGREES));
  float span = abs(heading.x) + abs(heading.y);
  float here = (dot(v_uv - 0.5, heading) + 0.5 * span) / span;
  vec2 travel = heading / span;
  color = here < u_progress
    ? texture(u_source, v_uv + travel * (1.0 - u_progress))
    : texture(u_second, v_uv - travel * u_progress);
}
`;

export const slide: EffectManifest = {
  id: "slide",
  name: { de: "Schieben", en: "Slide" },
  blurb: {
    de: "Schiebt beide Clips zusammen aus dem Bild.",
    en: "Pushes both clips across the frame together.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    // The direction the pair of pictures travels: at 0 both move right, so the incoming clip enters
    // from the left edge.
    { key: "angle", name: { de: "Winkel", en: "Angle" }, default: 0, min: 0, max: 360 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
