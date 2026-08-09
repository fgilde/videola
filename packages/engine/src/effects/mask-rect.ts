import type { EffectManifest } from "./registry";

// A rectangle that keeps what is inside it and takes away what is outside.
//
// Multiplying all four channels is the whole shader, and it is only that short because the chain
// carries premultiplied alpha: there (rgb*a, a) times m is (rgb*a*m, a*m), which is the same colour
// at a lower coverage. On straight alpha the same line would darken the picture towards black as it
// faded it, and only the alpha channel could be touched. Nothing needs clamping either -- m is in
// [0, 1], so rgb never climbs above the alpha it is premultiplied by.
//
// `v_uv` runs UP the picture inside a pass, and every other measurement in the model runs down it
// (`transform.y`, `crop.top`). The flip is here so a mask centred at 0.25 sits in the upper quarter
// on screen, which is the only reading of "centre Y" an editor could act on. A rectangle is not
// symmetric about the middle row, so this is load-bearing rather than decorative.
//
// The mask is measured on the *frame*, not on the clip: the chain runs after the transform, the
// same place a vignette is measured. A clip that moves under a still mask is the reveal that buys;
// a mask that travels with its clip would need the chain to run in clip space.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_width;
uniform float u_height;
uniform float u_feather;
uniform float u_invert;
out vec4 color;

void main() {
  vec2 here = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 away = abs(here - vec2(u_centerX, u_centerY));
  vec2 reach = vec2(u_width, u_height) * 0.5;
  // Never zero: at a feather of nothing the two edges of the smoothstep would coincide, and the
  // driver may do as it likes with that. A thousandth of a frame is under a pixel at 1080p.
  float soft = max(u_feather, 0.001);
  vec2 kept = 1.0 - smoothstep(reach - soft, reach + soft, away);
  float mask = kept.x * kept.y;
  color = texture(u_source, v_uv) * mix(mask, 1.0 - mask, u_invert);
}
`;

export const maskRect: EffectManifest = {
  id: "mask-rect",
  name: { de: "Maske (Rechteck)", en: "Mask (rectangle)" },
  blurb: {
    de: "Lässt nur ein Rechteck stehen, der Rest wird durchsichtig.",
    en: "Keeps a rectangle and makes the rest transparent.",
  },
  category: "key",
  inputs: 1,
  preview: { width: 0.6, height: 0.6, feather: 0.08 },
  params: [
    // Fractions of the frame, from its top-left corner, so 0.5 is the middle whatever the output
    // size is -- the same reasoning that makes every measurement in a text style a fraction.
    // The range reaches past the frame on both sides because sliding a mask off the edge is how a
    // reveal is authored.
    { key: "centerX", name: { de: "Mitte X", en: "Centre X" }, default: 0.5, min: -1, max: 2 },
    { key: "centerY", name: { de: "Mitte Y", en: "Centre Y" }, default: 0.5, min: -1, max: 2 },
    // The full extent, not the half: "half the frame wide" is what 0.5 should mean on a slider.
    { key: "width", name: { de: "Breite", en: "Width" }, default: 0.5, min: 0, max: 2 },
    { key: "height", name: { de: "Höhe", en: "Height" }, default: 0.5, min: 0, max: 2 },
    // Straddles the edge, half inside and half out, so growing it does not move the boundary.
    { key: "feather", name: { de: "Weiche Kante", en: "Feather" }, default: 0, min: 0, max: 0.5 },
    // A fade between the mask and its opposite rather than a switch. The ends are the two settings
    // anyone wants; the middle is an even half, which is what a linear reading of the word gives.
    { key: "invert", name: { de: "Invertieren", en: "Invert" }, default: 0, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
