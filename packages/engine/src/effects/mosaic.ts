import type { EffectManifest } from "./registry";

// A number plate, a face, a screen full of somebody's messages. A blur strong enough to hide one of
// those still leaves the shape readable, and a mosaic does not -- which is why every editor has one
// and why this is the tool for that job rather than the blur beside it.
//
// One tap per cell, at the cell's centre. Averaging the whole cell would want as many samples as the
// cell is wide, and a cell is measured in tens of pixels: the centre of a cell is the colour of that
// part of the picture, and the point of the effect is precisely that the detail is gone.
//
// The cell grid is anchored to the frame, not to the picture, so a clip that moves under a mosaic
// does not drag the mosaic's own edges around with it -- the same choice the vignette makes.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_size;
out vec4 color;

void main() {
  vec2 frame = vec2(textureSize(u_source, 0));
  // Below one texel a cell is the texel itself, and dividing by zero would take the whole picture
  // with it. The slider therefore has a real off position: at 1 nothing is quantised.
  vec2 cell = max(vec2(u_size), vec2(1.0)) / frame;
  vec2 centre = (floor(v_uv / cell) + 0.5) * cell;
  color = texture(u_source, clamp(centre, vec2(0.0), vec2(1.0)));
}
`;

export const mosaic: EffectManifest = {
  id: "mosaic",
  name: { de: "Verpixeln", en: "Mosaic" },
  blurb: {
    de: "Fasst das Bild zu Kacheln zusammen — für Gesichter, Kennzeichen, Bildschirme.",
    en: "Reduces the picture to tiles — for faces, plates and screens.",
  },
  category: "detail",
  inputs: 1,
  preview: { size: 24 },
  // The edge of a cell in pixels of the frame. Sixteen is about what hides a face in a 1080p frame,
  // which is what this is for.
  params: [{ key: "size", name: { de: "Kachel", en: "Cell" }, default: 16, min: 1, max: 128 }],
  fragmentSource: FRAGMENT_SOURCE,
};
