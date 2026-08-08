import type { EffectManifest } from "./registry";

// The one effect in this library that is *meant* to change alpha, and that is a shader's business
// rather than the blend function's: the compositor keeps the alpha channel out of the blend
// equation so a mode cannot punch a hole, but a key that produces no transparency does nothing.
//
// Hue and saturation are ratios of the channels, and premultiplication scales all three by the same
// `a` -- so both are read straight off the premultiplied texel. Only the final scale has to keep rgb
// and a together, and multiplying the whole vec4 is exactly that.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_hue;
uniform float u_tolerance;
uniform float u_softness;
out vec4 color;

// A grey has no meaningful hue, so without a floor on saturation the whole picture keys out at
// whatever u_hue happens to be. Above the ceiling a pixel counts as fully coloured.
const float DULL = 0.15;
const float VIVID = 0.35;

void main() {
  vec4 texel = texture(u_source, v_uv);
  if (texel.a <= 0.0) {
    color = texel;
    return;
  }
  float high = max(max(texel.r, texel.g), texel.b);
  float low = min(min(texel.r, texel.g), texel.b);
  float chroma = high - low;
  float hue = 0.0;
  if (chroma > 0.0) {
    if (high == texel.r) hue = mod((texel.g - texel.b) / chroma, 6.0);
    else if (high == texel.g) hue = (texel.b - texel.r) / chroma + 2.0;
    else hue = (texel.r - texel.g) / chroma + 4.0;
    hue *= 60.0;
  }
  float saturation = high > 0.0 ? chroma / high : 0.0;
  // Hue is a circle, so 350 and 10 are twenty degrees apart rather than three hundred and forty.
  float away = abs(mod(hue - u_hue + 540.0, 360.0) - 180.0);
  float inside = 1.0 - smoothstep(u_tolerance, u_tolerance + max(u_softness, 0.001), away);
  float keep = 1.0 - inside * smoothstep(DULL, VIVID, saturation);
  color = texel * keep;
}
`;

export const chromaKey: EffectManifest = {
  id: "chromaKey",
  name: { de: "Chroma-Keying", en: "Chroma key" },
  category: "key",
  inputs: 1,
  params: [
    // Green, because that is what a screen is. Degrees round the colour circle, so 240 is the blue
    // screen and 0 the red one.
    { key: "hue", name: { de: "Farbton", en: "Hue" }, default: 120, min: 0, max: 360 },
    { key: "tolerance", name: { de: "Toleranz", en: "Tolerance" }, default: 25, min: 0, max: 180 },
    { key: "softness", name: { de: "Weichheit", en: "Softness" }, default: 15, min: 0, max: 180 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
