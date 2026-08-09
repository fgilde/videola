import type { EffectManifest } from "./registry";

// An edge that travels across the frame in a chosen direction. `here` is the fragment's place along
// that direction, normalised so 0 is the first corner the edge reaches and 1 the last -- which is
// what makes one `progress` cover the whole frame at any angle, rather than leaving a triangle
// behind on the diagonals.
//
// The edge itself travels `1 + softness`, so at full progress its trailing side has left the frame
// too. Without that the last band of the outgoing clip never quite goes.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_angle;
uniform float u_softness;
out vec4 color;

const float DEGREES = 0.017453293;

// Negated y, because in a pass v_uv runs up the picture and the angle is meant to read clockwise on
// screen -- the same convention as the transform's rotation.
void main() {
  vec2 heading = vec2(cos(u_angle * DEGREES), -sin(u_angle * DEGREES));
  float span = abs(heading.x) + abs(heading.y);
  float here = (dot(v_uv - 0.5, heading) + 0.5 * span) / span;
  float soft = max(u_softness, 0.001);
  float edge = u_progress * (1.0 + soft);
  color = mix(texture(u_source, v_uv), texture(u_second, v_uv),
    smoothstep(edge - soft, edge, here));
}
`;

export const wipe: EffectManifest = {
  id: "wipe",
  name: { de: "Wischen", en: "Wipe" },
  blurb: {
    de: "Schiebt eine Kante über das Bild und gibt den neuen Clip frei.",
    en: "Runs an edge across the frame and reveals the new clip.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5, softness: 0.03 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    // Degrees, clockwise on screen like every other angle in the renderer, because `v_uv` runs down
    // the picture: 0 wipes in from the left, 90 from the top.
    { key: "angle", name: { de: "Winkel", en: "Angle" }, default: 0, min: 0, max: 360 },
    { key: "softness", name: { de: "Weichheit", en: "Softness" }, default: 0.05, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
