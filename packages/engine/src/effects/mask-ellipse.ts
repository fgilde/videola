import type { EffectManifest } from "./registry";

// The same alpha arithmetic as the rectangular mask -- see mask-rect.ts for why multiplying all
// four channels is what a mask means on premultiplied colour, and why y is flipped here.
//
// The distance is measured in the ellipse's own units, where the boundary is exactly 1 whatever the
// axes are. That is what tells this apart from a rectangle at all: the corner of the bounding box
// sits at a radius of about 1.41 and is therefore outside, while the point on either axis is on the
// edge.
//
// ponytail: the feather is scaled by the mean of the two semi-axes, so on a strongly elongated
// ellipse the soft band is wider along the long axis than the short one. Dividing by the local
// gradient instead would make it uniform, at the price of a singularity at the centre that needs
// its own branch. Worth doing the day an ellipse is stretched far enough for anyone to see it.
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
  vec2 reach = max(vec2(u_width, u_height) * 0.5, vec2(1e-5));
  float radius = length((here - vec2(u_centerX, u_centerY)) / reach);
  float soft = max(u_feather, 0.001) / ((reach.x + reach.y) * 0.5);
  float mask = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, radius);
  color = texture(u_source, v_uv) * mix(mask, 1.0 - mask, u_invert);
}
`;

export const maskEllipse: EffectManifest = {
  id: "mask-ellipse",
  name: { de: "Maske (Ellipse)", en: "Mask (ellipse)" },
  category: "key",
  inputs: 1,
  params: [
    { key: "centerX", name: { de: "Mitte X", en: "Centre X" }, default: 0.5, min: -1, max: 2 },
    { key: "centerY", name: { de: "Mitte Y", en: "Centre Y" }, default: 0.5, min: -1, max: 2 },
    // The full extent of the bounding box, so a width of 0.5 covers half the frame -- the same
    // reading as the rectangle's, which is what lets the two be swapped without retyping the shape.
    { key: "width", name: { de: "Breite", en: "Width" }, default: 0.5, min: 0, max: 2 },
    { key: "height", name: { de: "Hoehe", en: "Height" }, default: 0.5, min: 0, max: 2 },
    { key: "feather", name: { de: "Weiche Kante", en: "Feather" }, default: 0, min: 0, max: 0.5 },
    { key: "invert", name: { de: "Invertieren", en: "Invert" }, default: 0, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
