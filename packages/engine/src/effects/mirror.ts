import type { EffectManifest } from "./registry";

// One half of the frame reflected onto the other: a symmetry that makes a face uncanny, a landscape
// into a Rorschach and a dance shot into a kaleidoscope. It is in every phone editor because it costs
// nothing and reads as an effect immediately.
//
// The axis is a fraction of the frame rather than always the middle, so the mirror can be moved off
// centre -- which is the difference between a gimmick and a composition. Sampling folds around it
// rather than clamping, so nothing smears.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_axis;
uniform float u_vertical;
uniform float u_flip;
out vec4 color;

void main() {
  vec2 at = v_uv;
  float axis = clamp(u_axis, 0.0, 1.0);
  // One shader for both directions: the vertical switch picks which coordinate is folded, and the
  // flip switch picks which side of the axis is the one that gets kept.
  float here = u_vertical > 0.5 ? at.y : at.x;
  bool keep = u_flip > 0.5 ? here > axis : here < axis;
  float folded = keep ? here : axis * 2.0 - here;
  if (u_vertical > 0.5) {
    at.y = clamp(folded, 0.0, 1.0);
  } else {
    at.x = clamp(folded, 0.0, 1.0);
  }
  color = texture(u_source, at);
}
`;

export const mirror: EffectManifest = {
  id: "mirror",
  name: { de: "Spiegeln", en: "Mirror" },
  blurb: {
    de: "Klappt eine Hälfte des Bildes auf die andere — die Achse ist verschiebbar.",
    en: "Folds one half of the frame onto the other — and the axis can be moved.",
  },
  category: "detail",
  inputs: 1,
  preview: { axis: 0.5, vertical: 0, flip: 0 },
  params: [
    { key: "axis", name: { de: "Achse", en: "Axis" }, default: 0.5, min: 0, max: 1 },
    // Two switches rather than two effects, and floats because that is what a parameter is here.
    { key: "vertical", name: { de: "Waagerechte Achse", en: "Horizontal axis" }, default: 0, min: 0, max: 1 },
    { key: "flip", name: { de: "Andere Hälfte", en: "Other half" }, default: 0, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
