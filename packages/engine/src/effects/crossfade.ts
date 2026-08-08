import type { EffectManifest } from "./registry";

// A transition is an effect with two inputs, not a second subsystem: `u_second` is the picture the
// frame already carries when the incoming clip's turn comes, `u_source` is that clip. Mixing
// premultiplied values is what makes this a single `mix` -- on straight alpha the same line would
// weight the colour of a nearly transparent pixel as if it were opaque.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
out vec4 color;

void main() {
  color = mix(texture(u_second, v_uv), texture(u_source, v_uv), u_progress);
}
`;

export const crossfade: EffectManifest = {
  id: "crossfade",
  name: { de: "Überblendung", en: "Cross dissolve" },
  category: "transition",
  inputs: 2,
  // Not authored by hand: the draw list works `progress` out of the transition's window and the
  // moment being drawn. It is declared all the same, because that is how it reaches the shader.
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
