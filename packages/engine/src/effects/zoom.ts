import type { EffectManifest } from "./registry";

// The incoming clip grows out of the middle of the frame while the outgoing one stays put. Dividing
// `v_uv` by the scale samples a wider area than the frame covers, which is what makes the picture
// appear smaller.
//
// The mask is the part that is easy to leave out and impossible to miss afterwards: outside [0, 1]
// there is no incoming picture, and CLAMP_TO_EDGE would smear its border row across everything
// around it. Multiplying the whole vec4 by the mask is the premultiplied way of saying "nothing
// here", so what remains is the outgoing clip rather than a streak.
//
// And that absence is why this composites rather than mixes. `mix` weights both sides, so where the
// incoming picture is missing it would still halve the alpha of what is already on the frame -- a
// transparent hole around a shrunken picture, which in a premultiplied canvas is the page showing
// through. An over-operator only ever adds.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_from;
out vec4 color;

void main() {
  float scale = mix(u_from, 1.0, u_progress);
  vec2 sampled = (v_uv - 0.5) / max(scale, 0.001) + 0.5;
  vec2 inside = step(vec2(0.0), sampled) * step(sampled, vec2(1.0));
  vec4 incoming = texture(u_source, sampled) * (inside.x * inside.y * u_progress);
  color = incoming + texture(u_second, v_uv) * (1.0 - incoming.a);
}
`;

export const zoom: EffectManifest = {
  id: "zoom",
  name: { de: "Zoomen", en: "Zoom" },
  category: "transition",
  inputs: 2,
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    // How small the incoming clip starts. Above 1 it starts oversized and shrinks into place, which
    // is the other half of the gesture and costs nothing to allow.
    { key: "from", name: { de: "Startgröße", en: "Start scale" }, default: 0.4, min: 0.05, max: 4 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
