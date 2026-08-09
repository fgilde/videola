import type { EffectManifest } from "./registry";

// Two halves rather than a mix of the clips: the outgoing one fades to a flat colour and the
// incoming one out of it. A cross dissolve through black is not the same picture -- both clips are
// half visible in the middle of one, and neither in the middle of this.
//
// The dip colour is opaque, so it covers the frame including wherever the clips are transparent.
// That is the point of a dip: what it hides is everything.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_level;
out vec4 color;

void main() {
  float showing = abs(u_progress * 2.0 - 1.0);
  vec4 picture = u_progress < 0.5 ? texture(u_second, v_uv) : texture(u_source, v_uv);
  color = mix(vec4(u_level, u_level, u_level, 1.0), picture, showing);
}
`;

export const dip: EffectManifest = {
  id: "dip",
  name: { de: "Schwarzblende", en: "Dip to colour" },
  blurb: {
    de: "Blendet über eine Farbe, statt die Clips zu mischen.",
    en: "Fades through a flat colour instead of mixing the clips.",
  },
  category: "transition",
  inputs: 2,
  // Not the midpoint: in the middle a dip is nothing but the colour it dips through, and a flat
  // black rectangle says nothing about the effect that produced it.
  preview: { progress: 0.3 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    // Grey, from black through to white: a flat vec4(l, l, l, 1) is already premultiplied for every
    // value of l, which is why the dip takes a level rather than a colour.
    { key: "level", name: { de: "Helligkeit", en: "Level" }, default: 0, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
