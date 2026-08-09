import type { EffectManifest } from "./registry";

// Warming a picture is a gain on red against blue, which is a per-channel scale and therefore
// linear in premultiplied values. Green is the anchor: moving it too would shift the whole picture
// rather than its balance.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
out vec4 color;

void main() {
  vec4 texel = texture(u_source, v_uv);
  vec3 gains = vec3(1.0 + u_amount, 1.0, 1.0 - u_amount);
  color = vec4(clamp(texel.rgb * gains, vec3(0.0), vec3(texel.a)), texel.a);
}
`;

export const temperature: EffectManifest = {
  id: "temperature",
  name: { de: "Farbtemperatur", en: "Colour temperature" },
  blurb: {
    de: "Zieht das Bild ins Warme oder ins Kalte.",
    en: "Pulls the picture towards warm or towards cold.",
  },
  category: "color",
  inputs: 1,
  preview: { amount: 0.85 },
  // Signed, and zero is the untouched picture: one slider that runs from cold through neutral to
  // warm is what people reach for, rather than two that fight each other.
  params: [{ key: "amount", name: { de: "Wärme", en: "Warmth" }, default: 0, min: -1, max: 1 }],
  fragmentSource: FRAGMENT_SOURCE,
};
