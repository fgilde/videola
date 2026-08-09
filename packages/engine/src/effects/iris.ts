import type { EffectManifest } from "./registry";

// A circle that opens on the incoming clip.
//
// Two things stop this being three lines. The first is that `v_uv` is a fraction of the frame in
// both directions, so on a 16:9 target one step across is not one step down -- without the aspect
// correction the circle is an ellipse. `textureSize` is where the shape learns what the frame is,
// the same way the two kernels do.
//
// The second is what full progress has to mean. Dividing by a fixed diagonal is right for a square
// frame with the circle in the middle and wrong everywhere else: on 16:9, or from a centre pushed
// into a corner, the farthest corner is farther away than that and the transition ends with wedges
// of the outgoing clip still standing. So the reach is measured -- the distance to the corner that
// is actually farthest from this centre, in the same corrected space the fragment is measured in.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_second;
uniform float u_progress;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_softness;
out vec4 color;

void main() {
  vec2 frame = vec2(textureSize(u_source, 0));
  vec2 shape = vec2(max(frame.x / frame.y, 1.0), max(frame.y / frame.x, 1.0));
  // The centre is given the way every other position in this library is: a fraction of the frame
  // from its top-left corner, which is the other way up from v_uv.
  vec2 middle = vec2(u_centerX, 1.0 - u_centerY);
  vec2 corner = max(abs(vec2(0.0) - middle), abs(vec2(1.0) - middle));
  float reach = length(corner * shape);
  float away = length((v_uv - middle) * shape) / max(reach, 0.0001);
  float soft = max(u_softness, 0.001);
  float edge = u_progress * (1.0 + soft);
  color = mix(texture(u_source, v_uv), texture(u_second, v_uv),
    smoothstep(edge - soft, edge, away));
}
`;

export const iris: EffectManifest = {
  id: "iris",
  name: { de: "Kreisblende", en: "Iris" },
  blurb: {
    de: "Öffnet einen Kreis auf dem neuen Clip.",
    en: "Opens a circle onto the new clip.",
  },
  category: "transition",
  inputs: 2,
  preview: { progress: 0.5, softness: 0.06 },
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    // Reaches past the frame on both sides for the same reason a mask's centre does: opening from
    // a corner, or from just off one, is how this is used for anything but a bullseye.
    { key: "centerX", name: { de: "Mitte X", en: "Centre X" }, default: 0.5, min: -1, max: 2 },
    { key: "centerY", name: { de: "Mitte Y", en: "Centre Y" }, default: 0.5, min: -1, max: 2 },
    { key: "softness", name: { de: "Weichheit", en: "Softness" }, default: 0.05, min: 0, max: 1 },
  ],
  fragmentSource: FRAGMENT_SOURCE,
};
