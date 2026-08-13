import { curveTable, readableCurve } from "@videola/core";

import type { LutTable } from "@videola/media";

import { blur } from "./blur";
import { blurDissolve } from "./blur-dissolve";
import { brightness } from "./brightness";
import { chromaKey } from "./chroma-key";
import { colorWheels } from "./color-wheels";
import { contrast } from "./contrast";
import { crossfade } from "./crossfade";
import { curves } from "./curves";
import { dip } from "./dip";
import { filmLook } from "./film-look";
import { directionalBlur } from "./directional-blur";
import { glitch } from "./glitch";
import { grain } from "./grain";
import { glow } from "./glow";
import { iris } from "./iris";
import { lut } from "./lut";
import { maskEllipse } from "./mask-ellipse";
import { maskRect } from "./mask-rect";
import { mosaic } from "./mosaic";
import { monochrome } from "./monochrome";
import { push } from "./push";
import { rgbSplit } from "./rgb-split";
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

/**
 * A tone curve: the control points a person drags, not a number they slide.
 *
 * The second reason `EffectManifest` needed a kind, and the first parameter here whose size the
 * project file chooses. What reaches the shader is a table sampled from these points -- see
 * `clampCurve` -- but what is stored, keyframed and edited is the points, because a table is
 * derivable from points and points are not derivable from a table.
 */
export interface CurveParam {
  kind: "curve";
  key: string;
  name: { de: string; en: string };
  default: readonly (readonly [number, number])[];
}

/**
 * A colour lookup table, named rather than carried: the value is the id of a library asset of kind
 * `lut`, and the table itself is that asset's bytes in OPFS.
 *
 * The one parameter here that never becomes a uniform. A 33-cube is 35937 triplets -- past every
 * uniform budget a driver has, and past what belongs in a project file beside a number -- so it
 * reaches the shader as a texture on the third unit instead, and the draw list carries the id that
 * says which one.
 *
 * There is no default table. An unset parameter draws through `IDENTITY_LUT`, which is the
 * untouched picture; a default that named some particular look would be a grade nobody asked for
 * on every clip this effect is added to.
 */
export interface LutParam {
  kind: "lut";
  key: string;
  name: { de: string; en: string };
}

export type Rgba = readonly [number, number, number, number];
export type VideoParam = EffectParam | ColorParam | CurveParam | LutParam;
/**
 * What `setUniforms` will take: a float, the components of a vector or a matrix, or the entries of
 * a table. Nothing shorter than seventeen numbers is ever a table, which is what keeps the shape of
 * the value enough to pick the call -- see `program.ts`.
 */
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
  //
  // Authored in the parameter's own kind rather than in the shape the uniform ends up as -- a
  // curve's telling setting is the points somebody would drag, not the table they sample to. It
  // goes through the same guard every other authored value does, which is what makes `unknown`
  // safe here and a preview outside its own declared range unable to paint a tile no control could.
  preview: Readonly<Record<string, unknown>>;
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
  // The two that make this a grading tool rather than a set of picture sliders, and the two a
  // scope is read against: the wheels put the black and white points where the waveform says they
  // belong, the curves shape what is between them.
  colorWheels,
  curves,
  // Last of the three that grade, because it is the one that answers to a file rather than to a
  // control: the wheels and the curves are what somebody dials, a table is what somebody was given.
  lut,
  // The two looks somebody reaches for by name rather than by parameter: black and white with the
  // warm end left in, and the faded print every phone editor calls "film". Both are one shader and
  // one dial, because what is wanted from them is a look and not three sliders to balance.
  monochrome,
  filmLook,
  vignette,
  blur,
  sharpen,
  // The three that answer a job rather than a taste. A blur strong enough to hide a face leaves the
  // shape of it readable and a mosaic does not; a directional smear is what a fast pan looks like and
  // no amount of the blur above will lean; a glow spreads what is bright and keeps what is not, which
  // is the one thing a blur cannot do at any setting.
  mosaic,
  directionalBlur,
  glow,
  // Grain and a colour fringe: the two that make a digital picture stop looking like a spreadsheet
  // of pixels. Both measure themselves in pixels of the frame, so they look the same at 720p and at
  // 4K rather than four times finer.
  grain,
  rgbSplit,
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
  // Push is not slide with a second layer: slide lays the new clip over the old, push moves both, as
  // though two frames of one strip were being pulled past the window. Glitch is the loud one, and it
  // is loud on purpose.
  push,
  glitch,
  iris,
  zoom,
  dip,
  blurDissolve,
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

/**
 * The table a curve reaches the shader as: `CURVE_SAMPLES` outputs, evenly spaced from black to
 * white, which the shader reads with a mix between neighbours.
 *
 * Sampled here rather than stored sampled, and sampled per frame rather than cached: a keyframed
 * curve has different points at every moment, so a cache would need the resolved points as its
 * key -- which is the work it was meant to save. Thirty-two evaluations of a handful of cubic
 * segments, four times over, is nothing beside one pass of the shader that reads them.
 *
 * The same guard as everywhere else on this seam: what does not read as this parameter's kind is
 * the manifest's default, so a float on a curve track is the untouched picture rather than an
 * unset uniform, which is a table of zeroes and a black clip.
 */
export function clampCurve(param: CurveParam, value: unknown): readonly number[] {
  return curveTable(readableCurve(value, param.default));
}

/**
 * The library asset a lookup-table parameter names, or the empty string for none.
 *
 * The same rule as every other guard on this seam: what does not read as this parameter's kind is
 * "nothing chosen", which draws the identity table. A project file may carry a float, a curve or a
 * number on this key, and none of them is a medium.
 */
export function lutMedia(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Whichever guard this parameter's kind calls for. Everything on the way to a uniform goes here. */
export function paramUniform(param: VideoParam, value: unknown): Uniform {
  switch (param.kind) {
    case "color":
      return clampColor(param, value);
    case "curve":
      return clampCurve(param, value);
    case "lut":
      // Unreachable through `uniforms` and `previewValues`, which both skip this kind before they
      // get here: a table is a texture, and there is no uniform that could stand for one.
      throw new TypeError(`no uniform for a lookup table: ${param.key}`);
    default:
      return clampParam(param, value);
  }
}

// The full uniform record a tile is drawn with. Through the same guards as every other path to a
// uniform, so a preview setting outside its own declared range cannot paint a tile that no slider
// could reach.
export function previewValues(manifest: EffectManifest): Record<string, Uniform> {
  const values: Record<string, Uniform> = {};
  for (const param of manifest.params) {
    if (param.kind === "lut") continue;
    values[param.key] = paramUniform(param, manifest.preview[param.key] ?? param.default);
  }
  return values;
}

/**
 * The table a tile is drawn through, where the effect has one.
 *
 * A LUT's telling setting cannot be a media id: the browser draws its grid before anybody has
 * imported anything, and a tile for a grading effect that showed the untouched picture would be a
 * promise with nothing behind it -- the exact reason this effect was put off rather than half
 * built. So the manifest nominates a table by value, and the tile is a real run of the real shader
 * over a real table.
 */
export function previewLut(manifest: EffectManifest): LutTable | undefined {
  const param = manifest.params.find((entry) => entry.kind === "lut");
  if (param === undefined) return undefined;
  const table = manifest.preview[param.key];
  return isTable(table) ? table : undefined;
}

// A manifest is ours rather than untrusted, but `preview` is typed `unknown` on purpose so that
// every kind's value goes through its own guard; this is that guard.
function isTable(value: unknown): value is LutTable {
  if (typeof value !== "object" || value === null) return false;
  const table = value as Partial<LutTable>;
  return typeof table.size === "number" && table.rgba instanceof Uint8Array;
}
