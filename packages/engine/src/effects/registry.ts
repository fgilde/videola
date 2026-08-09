import { blur } from "./blur";
import { brightness } from "./brightness";
import { chromaKey } from "./chroma-key";
import { contrast } from "./contrast";
import { crossfade } from "./crossfade";
import { dip } from "./dip";
import { maskEllipse } from "./mask-ellipse";
import { maskRect } from "./mask-rect";
import { saturation } from "./saturation";
import { sharpen } from "./sharpen";
import { slide } from "./slide";
import { temperature } from "./temperature";
import { vignette } from "./vignette";
import { wipe } from "./wipe";
import { zoom } from "./zoom";

export interface EffectParam {
  // Optional, so every manifest written before there was a second kind still reads as a float --
  // including the audio ones, which have an AudioParam behind them and can never be anything else.
  kind?: "float";
  key: string;
  // Bilingual here for the same reason the effect's own name is: the inspector labels a row
  // without knowing which effect it belongs to, and adding an effect stays one file.
  name: { de: string; en: string };
  default: number;
  min: number;
  max: number;
}

/**
 * A colour a person picks, not a number they drag. The first parameter in this library that is not
 * a float, and the reason `EffectManifest` needed a kind at all: `ParamValue` has carried a colour
 * since the model was written, and until now nothing between the project file and the uniform could
 * say so.
 *
 * Straight rgba, each channel 0 to 1, premultiplied where it becomes a uniform -- the same way the
 * project background is read, and for the same reason.
 */
export interface ColorParam {
  kind: "color";
  key: string;
  name: { de: string; en: string };
  default: Rgba;
}

export type Rgba = readonly [number, number, number, number];
export type VideoParam = EffectParam | ColorParam;
/** What `setUniforms` will take: a float, or the components of a vector. */
export type Uniform = number | readonly number[];

export interface EffectManifest {
  id: string;
  // Carried here rather than in the i18n catalogues, so that adding an effect is one file and the
  // inspector needs to know nothing about any particular effect to label it.
  name: { de: string; en: string };
  // One sentence saying what the effect does to a picture. The browser puts it under the tile, and
  // a search over it is what finds "weichzeichnen" from the word "unscharf".
  blurb: { de: string; en: string };
  // What the inspector groups by. A category earns its place by having more than one member --
  // otherwise it is a heading over a single row.
  category: "color" | "detail" | "key" | "transition";
  // Two means the effect also samples `u_second`, which for a transition is the picture the
  // frame already holds.
  inputs: 1 | 2;
  // Separable kernels need the same shader run twice, once along each axis, and `u_pass` says
  // which sweep this is. Declared here rather than as a parameter: it is not a knob, and a
  // parameter is what the inspector puts a slider on.
  passes?: 2;
  params: readonly VideoParam[];
  // What the browser's tile is drawn with. Not the defaults: a gain of 1 and a warmth of 0 are the
  // untouched picture, so a tile drawn from the defaults would promise a brightness effect and show
  // one that does nothing. Each effect names the one setting that makes its own point -- which for
  // a dip is not the midpoint, because the middle of a dip is a black rectangle. Keys left out fall
  // back to the parameter's default.
  preview: Readonly<Record<string, Uniform>>;
  fragmentSource: string;
}

// What every fragment source in here may rely on, and what the compositor guarantees:
//   in vec2 v_uv        the fragment's place on the frame, y running UP the picture
//   uniform sampler2D u_source   the chain so far, premultiplied
//   uniform sampler2D u_second   the second input, premultiplied, only when `inputs` is 2
//   uniform float u_<key>        one per declared parameter
//   uniform float u_pass         which sweep this is, only when `passes` is 2
//
// `textureSize(u_source, 0)` is available and is how a kernel finds its texel size. There is no
// uniform for it: two sources of truth for the same number is how a resize leaves one of them stale.
//
// The y axis is worth a sentence because it is the one thing here that is not free to change. A pass
// draws the same quad it samples, so `v_uv` has to be the identity on the target -- and a target is
// stored the way GL stores one, first row at the bottom. The clip's own shader upstream of the chain
// runs y the other way, which is why an effect that cares about direction converts rather than
// assuming: a heading meant to read clockwise on screen is `vec2(cos a, -sin a)` here.
//
// Premultiplied is the contract that makes these shaders short: a crossfade is then a plain mix
// and a brightness change touches rgb alone. An effect that leaves rgb greater than a produces a
// colour no over-operator can composite, so whoever scales rgb clamps.
//
// ponytail: every parameter M1 has is a float on a slider, so the manifest carries neither a type
// nor a widget. `ParamValue` already knows five other kinds; the day an effect takes a colour,
// this is where `type` belongs.
const MANIFESTS: readonly EffectManifest[] = [
  brightness,
  contrast,
  saturation,
  temperature,
  vignette,
  blur,
  sharpen,
  chromaKey,
  // Two masks rather than one with a shape parameter: the manifest has no notion of a choice, and
  // a rectangle and an ellipse share four of six parameters but not a line of their falloff. In a
  // chain they intersect, because each multiplies the coverage the one before it left.
  //
  // ponytail: `effect.add` treats a repeated type as a no-op, so a clip carries at most one of each
  // shape. Two rectangles want the chain keyed by effect id rather than by type.
  maskRect,
  maskEllipse,
  crossfade,
  wipe,
  slide,
  zoom,
  dip,
];

export function effect(type: string): EffectManifest | undefined {
  return MANIFESTS.find((manifest) => manifest.id === type);
}

export function effectManifests(): readonly EffectManifest[] {
  return MANIFESTS;
}

// The one place that decides what a float parameter is worth as a uniform. A project file may carry
// a value outside the declared range, of a `ParamValue` kind that is not a number at all, or a NaN
// -- and all three reach uniform1f without complaint and paint the clip black.
export function clampParam(param: EffectParam, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return param.default;
  return Math.min(Math.max(value, param.min), param.max);
}

/**
 * The same guard for a colour, and the same rule: what does not read as this parameter's kind is
 * the default. A hand-authored project can put a float on a colour track, and four numbers is not
 * enough -- a NaN among them reaches uniform4fv without complaint and paints the clip black.
 *
 * Premultiplied on the way out, which is what makes the result a legal texel for everything
 * downstream of it: a colour is authored straight and composited premultiplied, and this is the
 * seam between the two.
 */
export function clampColor(param: ColorParam, value: unknown): readonly number[] {
  const straight = readable(value) ? value : param.default;
  const alpha = clamp01(straight[3]);
  return [
    clamp01(straight[0]) * alpha,
    clamp01(straight[1]) * alpha,
    clamp01(straight[2]) * alpha,
    alpha,
  ];
}

function readable(value: unknown): value is Rgba {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((channel) => typeof channel === "number" && Number.isFinite(channel))
  );
}

function clamp01(channel: number): number {
  return Math.min(Math.max(channel, 0), 1);
}

/** Whichever guard this parameter's kind calls for. Everything on the way to a uniform goes here. */
export function paramUniform(param: VideoParam, value: unknown): Uniform {
  return param.kind === "color" ? clampColor(param, value) : clampParam(param, value);
}

// The full uniform record a tile is drawn with. Through the same guards as every other path to a
// uniform, so a preview setting outside its own declared range cannot paint a tile that no slider
// could reach.
export function previewValues(manifest: EffectManifest): Record<string, Uniform> {
  const values: Record<string, Uniform> = {};
  for (const param of manifest.params) {
    values[param.key] = paramUniform(param, manifest.preview[param.key] ?? param.default);
  }
  return values;
}
