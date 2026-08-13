import type { EffectManifest } from "./registry";

// Film grain: the one thing that makes a digital picture stop looking like a spreadsheet of pixels,
// and the reason every editor ships it.
//
// The noise is a hash of the fragment's own place, not a texture: a grain texture is a file to ship,
// a texture unit to spend and a tiling seam to hide, and a hash costs three instructions. `seed`
// moves the field, so a clip can be given grain that does not sit in the same places as its
// neighbour's — the shader has no clock, and that is deliberate: a still frame of an export has to
// come out the same on every machine and on every re-render.
//
// It rides on luminance rather than on the channels: real grain is silver, it does not tint, and
// scaling rgb separately is how a green cast appears in the shadows.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_amount;
uniform float u_size;
uniform float u_seed;
out vec4 color;

float hash(vec2 at) {
  return fract(sin(dot(at, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec4 source = texture(u_source, v_uv);
  float alpha = max(source.a, 0.0001);
  vec3 straight = source.rgb / alpha;
  vec2 frame = vec2(textureSize(u_source, 0));
  // Grain measured in pixels of the frame, so it stays the same size on screen whether the project
  // is 720p or 4K -- a hash of v_uv alone gives 4K four times the grains of 720p.
  vec2 cell = floor(v_uv * frame / max(u_size, 1.0));
  float noise = hash(cell + vec2(u_seed * 17.0, u_seed * 31.0)) - 0.5;
  // Strongest in the mid-tones, gone in the blacks and the highlights, which is where film puts it:
  // grain in a clipped white reads as dirt on the lens.
  float luma = dot(straight, vec3(0.2126, 0.7152, 0.0722));
  float weight = 1.0 - abs(luma * 2.0 - 1.0);
  vec3 grained = clamp(straight + noise * u_amount * weight, 0.0, 1.0);
  color = vec4(grained * alpha, source.a);
}
`;

export const grain: EffectManifest = {
  id: "grain",
  name: { de: "Filmkorn", en: "Film grain" },
  blurb: {
    de: "Legt Korn über das Bild — in den Mitteltönen am stärksten, wie bei Film.",
    en: "Lays grain over the picture — strongest in the mid-tones, the way film does.",
  },
  category: "detail",
  inputs: 1,
  preview: { amount: 0.35, size: 2, seed: 1 },
  params: [
    { key: "amount", name: { de: "Stärke", en: "Amount" }, default: 0.12, min: 0, max: 0.6 },
    { key: "size", name: { de: "Korngröße", en: "Grain size" }, default: 1.5, min: 1, max: 12 },
    // Not a clock: an export re-run has to give the same picture, so the field moves only when
    // somebody moves it.
    { key: "seed", name: { de: "Streuung", en: "Seed" }, default: 1, min: 0, max: 100 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
