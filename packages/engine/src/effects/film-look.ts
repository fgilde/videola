import type { EffectManifest } from "./registry";

// The faded look every phone editor ships and calls "film", "vintage" or "retro": blacks lifted off
// zero, highlights pulled down, colour a little out of it. One control does all three, because
// what somebody wants from this is "a bit faded", not three sliders to balance.
//
// A lift is not a brightness change and this is the difference worth spending a shader on: raising
// brightness moves every level up and clips the white, while a lift raises the floor and leaves the
// ceiling, which is what a print with age on it does and what a black rectangle in a graded shot
// never has.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_fade;
uniform float u_warmth;
out vec4 color;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// A blue-grey floor rather than a neutral one: the fade of a print is not grey, and a neutral lift
// reads as a screen with the brightness turned up.
const vec3 FLOOR = vec3(0.055, 0.06, 0.085);

void main() {
  vec4 source = texture(u_source, v_uv);
  float alpha = max(source.a, 0.0001);
  vec3 straight = source.rgb / alpha;
  float fade = clamp(u_fade, 0.0, 1.0);
  // Lift the floor and drop the ceiling together, so the picture keeps its middle and loses its ends.
  vec3 lifted = FLOOR * fade + straight * (1.0 - fade * (1.0 - 0.86));
  float grey = dot(lifted, LUMA);
  vec3 muted = mix(lifted, vec3(grey), fade * 0.35);
  vec3 warmed = muted * mix(vec3(1.0), vec3(1.06, 1.0, 0.94), clamp(u_warmth, -1.0, 1.0));
  color = vec4(clamp(warmed, 0.0, 1.0) * alpha, source.a);
}
`;

export const filmLook: EffectManifest = {
  id: "film-look",
  name: { de: "Filmlook", en: "Film look" },
  blurb: {
    de: "Hebt die Schwarzwerte an und nimmt Farbe heraus — der ausgeblichene Look.",
    en: "Lifts the blacks and takes some colour out — the faded look.",
  },
  category: "color",
  inputs: 1,
  preview: { fade: 0.7, warmth: 0.5 },
  params: [
    { key: "fade", name: { de: "Ausbleichen", en: "Fade" }, default: 0.45, min: 0, max: 1 },
    { key: "warmth", name: { de: "Wärme", en: "Warmth" }, default: 0.3, min: -1, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
