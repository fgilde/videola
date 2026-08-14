import type { EffectManifest } from "./registry";

// A dissolve that arrives in an order: the new clip comes in through the dark parts of the outgoing
// one first, or the bright parts, and the picture appears to be eaten rather than faded. It is what
// makes a cut to a night shot feel like the lights going out instead of like a mix.
//
// The threshold is compared against the outgoing clip's own luminance, so what decides the order is
// the picture rather than a shape laid over it -- which is the whole difference between this and a
// wipe. `softness` is the width of the band that is in between, and a band of zero would alias into
// hard speckles on any gradient.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_softness;
uniform float u_invert;
out vec4 color;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 leaving = texture(u_source, v_uv);
  vec4 arriving = texture(u_second, v_uv);
  float luma = dot(leaving.rgb / max(leaving.a, 0.0001), LUMA);
  float order = u_invert > 0.5 ? 1.0 - luma : luma;
  float soft = max(u_softness, 0.01);
  // The edge travels 1 + soft so the last band goes too, the same correction the wipe makes.
  float edge = clamp(u_progress, 0.0, 1.0) * (1.0 + soft);
  color = mix(leaving, arriving, smoothstep(edge - soft, edge, 1.0 - order));
}
`;

export const lumaDissolve: EffectManifest = {
  id: "luma-dissolve",
  name: { de: "Helligkeitsblende", en: "Luma dissolve" },
  blurb: {
    de: "Der neue Clip kommt durch die dunklen Stellen des alten herein — oder durch die hellen.",
    en: "The new clip arrives through the dark parts of the old one — or through the bright ones.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5, softness: 0.15, invert: 0 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    { key: "softness", name: { de: "Weichheit", en: "Softness" }, default: 0.2, min: 0.01, max: 1 },
    { key: "invert", name: { de: "Hell zuerst", en: "Bright first" }, default: 0, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
