import type { EffectManifest } from "./registry";

// Two halves rather than a mix of the clips: the outgoing one fades to a flat colour and the
// incoming one out of it. A cross dissolve through black is not the same picture -- both clips are
// half visible in the middle of one, and neither in the middle of this.
//
// `u_colour` arrives premultiplied like every other colour that reaches a shader here, so it goes
// into the mix as it is. At full alpha it covers the frame including wherever the clips are
// transparent, which is the point of a dip: what it hides is everything.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform vec4 u_colour;
out vec4 color;

void main() {
  float showing = abs(u_progress * 2.0 - 1.0);
  vec4 picture = u_progress < 0.5 ? texture(u_second, v_uv) : texture(u_source, v_uv);
  color = mix(u_colour, picture, showing);
}
`;

export const dip: EffectManifest = {
  id: "dip",
  name: { de: "Blende über Farbe", en: "Dip to colour" },
  blurb: {
    de: "Blendet über eine frei gewählte Farbe, statt die Clips zu mischen.",
    en: "Fades through a colour of your choosing instead of mixing the clips.",
  },
  category: "transition",
  inputs: 2,
  // Not the midpoint, and the colour is a warm one: in the middle a dip is nothing but the colour
  // it dips through, and a flat black rectangle says nothing about the effect that produced it.
  preview: { progress: 0.3, colour: [1, 0.98, 0.9, 1] },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    // The parameter this library grew a second kind for. Black at full cover is the dip everybody
    // means by the word, and it is what the grey level this replaced defaulted to.
    {
      kind: "color",
      key: "colour",
      name: { de: "Farbe", en: "Colour" },
      default: [0, 0, 0, 1],
    },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
