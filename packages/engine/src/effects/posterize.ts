import type { EffectManifest } from "./registry";

// Levels, not colours: the picture is snapped to a small number of steps per channel, which is what
// turns footage into something drawn. Four steps is a poster, twelve is a compression artefact on
// purpose, and two is a stencil.
//
// Rounded rather than floored, and scaled by `levels - 1` rather than by `levels`: flooring never
// reaches white, so a posterized picture came out a step dark everywhere and the brightest step of a
// blown-out sky was grey.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_levels;
out vec4 color;

void main() {
  vec4 source = texture(u_source, v_uv);
  float alpha = max(source.a, 0.0001);
  vec3 straight = source.rgb / alpha;
  float steps = max(floor(u_levels), 2.0) - 1.0;
  vec3 snapped = round(clamp(straight, 0.0, 1.0) * steps) / steps;
  color = vec4(snapped * alpha, source.a);
}
`;

export const posterize: EffectManifest = {
  id: "posterize",
  name: { de: "Farbreduktion", en: "Posterize" },
  blurb: {
    de: "Rastert die Farben auf wenige Stufen — aus Aufnahme wird Zeichnung.",
    en: "Snaps the colours to a few steps — footage becomes something drawn.",
  },
  category: "color",
  inputs: 1,
  preview: { levels: 4 },
  params: [{ key: "levels", name: { de: "Stufen", en: "Levels" }, default: 6, min: 2, max: 32 }],
  fragmentSource: FRAGMENT_SOURCE,
};
