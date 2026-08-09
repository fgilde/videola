import { parseCube } from "@videola/media";

import type { EffectManifest } from "./registry";

/**
 * A colour lookup table: the picture's own colours, traded for the ones a table names.
 *
 * The table is a `sampler3D` on the third texture unit, and the hardware's trilinear filter is the
 * interpolation between its grid points -- which is why this shader is six lines and a curve's is
 * thirty. `textureSize` rather than a uniform for the grid size: two sources of truth for the same
 * number is how a 17-cube comes to be sampled as a 33.
 *
 * The half-texel offset is the whole of the addressing. A table of `n` entries has its first entry
 * at the centre of the first texel, not at its edge, so an input of 0 has to land at `0.5 / n` and
 * an input of 1 at `(n - 0.5) / n`. Without it every grade is shifted by half a grid step towards
 * black, which looks like a slightly wrong table rather than like a bug.
 *
 * Straight colour, not premultiplied, and that is not an optimisation -- it is what a colour
 * mapping means. A table asked what to do with `a * c` would answer for a colour the picture does
 * not contain, and a pixel at a third coverage over red would come back a different hue from the
 * same pixel at full coverage. Undone before the lookup and put back after, exactly as the curves
 * do it, and the pixel harness measures a half-covered pixel to keep it that way.
 *
 * The input the table is read against is the picture as it stands -- non-linear sRGB, the space
 * everything in this pipeline mixes in. That is the right space for a display-referred look, which
 * is what a `.cube` from a camera manufacturer or a look pack is. A table authored against linear
 * light or against a log curve expects its own input and will not be told otherwise here; the
 * guide says so rather than this shader guessing.
 */
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform highp sampler3D u_table;
uniform float u_amount;
out vec4 color;

void main() {
  vec4 texel = texture(u_source, v_uv);
  if (texel.a <= 0.0) {
    color = texel;
    return;
  }
  vec3 straight = clamp(texel.rgb / texel.a, 0.0, 1.0);
  float size = float(textureSize(u_table, 0).x);
  vec3 coord = (straight * (size - 1.0) + 0.5) / size;
  vec3 graded = mix(straight, texture(u_table, coord).rgb, u_amount);
  color = vec4(clamp(graded, 0.0, 1.0) * texel.a, texel.a);
}
`;

/**
 * The table the browser's tile is drawn through.
 *
 * A tile for this effect is the one place the "promise without cover" trap is unavoidable: the
 * effect's whole subject is a file the person has not chosen yet, and a tile drawn through the
 * identity table would be the source picture with a grading effect's name under it. So the tile
 * carries a real table of its own -- teal in the shadows, warm in the highlights, which is what
 * half the look packs ever sold do -- and it goes through the same parser a dropped `.cube` goes
 * through, so a broken parser takes the tile out with it rather than leaving it looking fine.
 *
 * Two entries an axis, because that is enough: trilinear interpolation between eight corners is
 * already a smooth grade, and eight rows fit in a source file where 35937 do not.
 */
const PREVIEW_CUBE = `TITLE "Teal and Orange"
LUT_3D_SIZE 2
0.00 0.05 0.12
1.00 0.05 0.00
0.00 0.85 0.20
1.00 0.85 0.10
0.00 0.20 0.80
1.00 0.10 0.70
0.00 0.95 0.90
1.00 0.95 0.85
`;

export const lut: EffectManifest = {
  id: "lut",
  name: { de: "Farbtabelle", en: "Lookup table" },
  blurb: {
    de: "Legt eine geladene .cube-Farbtabelle über das Bild.",
    en: "Puts a loaded .cube lookup table over the picture.",
  },
  category: "color",
  inputs: 1,
  preview: { table: parseCube(PREVIEW_CUBE) },
  params: [
    {
      kind: "lut",
      key: "table",
      name: { de: "Tabelle", en: "Table" },
    },
    // The knob every grading tool puts beside a LUT, and the reason this effect has a slider at
    // all: a look at full strength is rarely the one that was wanted, and halving it is not the
    // same as loading a weaker table.
    {
      key: "amount",
      name: { de: "Stärke", en: "Strength" },
      default: 1,
      min: 0,
      max: 1,
    },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
