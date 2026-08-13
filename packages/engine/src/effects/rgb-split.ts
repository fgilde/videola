import type { EffectManifest } from "./registry";

// Red one way, blue the other, green where it was: the fringe of a cheap lens, and the look every
// short-form editor calls "glitch" when it is pushed and "analogue" when it is not.
//
// Sampled in the picture's own space with a distance measured in pixels of the frame, so the split
// is the same width on screen whatever the project's resolution -- the same rule the grain follows.
// Each channel is fetched with its own alpha and the three are recombined straight, because a
// premultiplied sample carries the alpha of where it came from, and mixing three of those makes an
// edge that is transparent in one channel and not in the others.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_distance;
uniform float u_angle;
out vec4 color;

const float DEGREES = 0.017453293;

vec3 straightAt(vec2 at) {
  vec4 texel = texture(u_source, clamp(at, vec2(0.0), vec2(1.0)));
  return texel.rgb / max(texel.a, 0.0001);
}

void main() {
  vec2 frame = vec2(textureSize(u_source, 0));
  vec2 heading = vec2(cos(u_angle * DEGREES), -sin(u_angle * DEGREES)) * u_distance / frame;
  vec4 middle = texture(u_source, v_uv);
  float red = straightAt(v_uv + heading).r;
  float green = straightAt(v_uv).g;
  float blue = straightAt(v_uv - heading).b;
  color = vec4(clamp(vec3(red, green, blue), 0.0, 1.0) * middle.a, middle.a);
}
`;

export const rgbSplit: EffectManifest = {
  id: "rgb-split",
  name: { de: "Farbversatz", en: "RGB split" },
  blurb: {
    de: "Zieht Rot und Blau auseinander — von feiner Linsenfranse bis Glitch.",
    en: "Pulls red and blue apart — from a fine lens fringe to a full glitch.",
  },
  category: "detail",
  inputs: 1,
  preview: { distance: 6, angle: 0 },
  params: [
    { key: "distance", name: { de: "Abstand", en: "Distance" }, default: 3, min: 0, max: 40 },
    { key: "angle", name: { de: "Winkel", en: "Angle" }, default: 0, min: 0, max: 360 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
