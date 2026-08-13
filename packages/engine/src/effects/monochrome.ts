import type { EffectManifest } from "./registry";

// Black and white, and the warm end of it in the same control. Two effects would be two shaders that
// differ by one mix, and "sepia" is what everybody calls black and white with the tint left in.
//
// Rec.709 luma, the same weights the scopes read and the saturation effect uses: a green field and a
// red one of the same luminance have to come out the same grey, or the picture reads as a mistake.
// Premultiplied throughout, so the tint scales with alpha like every other colour here.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
uniform float u_tone;
out vec4 color;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Where the warm end lands: a print-toned brown rather than orange, measured off a sepia print
// rather than picked. Split so shadows keep some blue, which is what stops the tint reading as a
// filter laid on top.
const vec3 WARM = vec3(1.07, 0.94, 0.76);
const vec3 COOL = vec3(0.88, 0.96, 1.12);

void main() {
  vec4 source = texture(u_source, v_uv);
  float alpha = max(source.a, 0.0001);
  vec3 straight = source.rgb / alpha;
  float grey = dot(straight, LUMA);
  // Below zero the tone runs cold, which is the other half of the look and costs one mix.
  vec3 tint = mix(vec3(1.0), u_tone >= 0.0 ? WARM : COOL, abs(u_tone));
  vec3 toned = clamp(vec3(grey) * tint, 0.0, 1.0);
  color = vec4(mix(straight, toned, clamp(u_amount, 0.0, 1.0)) * alpha, source.a);
}
`;

export const monochrome: EffectManifest = {
  id: "monochrome",
  name: { de: "Schwarzweiß", en: "Black and white" },
  blurb: {
    de: "Nimmt die Farbe heraus — mit Regler für einen warmen Sepia- oder kalten Ton.",
    en: "Takes the colour out — with a dial towards a warm sepia or a cold tone.",
  },
  category: "color",
  inputs: 1,
  preview: { amount: 1, tone: 0.6 },
  params: [
    { key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 1 },
    { key: "tone", name: { de: "Ton", en: "Tone" }, default: 0, min: -1, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
