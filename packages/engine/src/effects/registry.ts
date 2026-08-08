import { brightness } from "./brightness";
import { crossfade } from "./crossfade";

export interface EffectParam {
  key: string;
  // Bilingual here for the same reason the effect's own name is: the inspector labels a row
  // without knowing which effect it belongs to, and adding an effect stays one file.
  name: { de: string; en: string };
  default: number;
  min: number;
  max: number;
}

export interface EffectManifest {
  id: string;
  // Carried here rather than in the i18n catalogues, so that adding an effect is one file and the
  // inspector needs to know nothing about any particular effect to label it.
  name: { de: string; en: string };
  category: "color" | "transition";
  // Two means the effect also samples `u_second`, which for a transition is the picture the
  // frame already holds. Nothing else in M1 needs a second input.
  inputs: 1 | 2;
  params: readonly EffectParam[];
  fragmentSource: string;
}

// What every fragment source in here may rely on, and what the compositor guarantees:
//   in vec2 v_uv        the fragment's place on the frame, running with the picture
//   uniform sampler2D u_source   the chain so far, premultiplied
//   uniform sampler2D u_second   the second input, premultiplied, only when `inputs` is 2
//   uniform float u_<key>        one per declared parameter
//
// Premultiplied is the contract that makes these shaders short: a crossfade is then a plain mix
// and a brightness change touches rgb alone. An effect that leaves rgb greater than a produces a
// colour no over-operator can composite, so whoever scales rgb clamps.
//
// ponytail: every parameter M1 has is a float on a slider, so the manifest carries neither a type
// nor a widget. `ParamValue` already knows five other kinds; the day an effect takes a colour,
// this is where `type` belongs.
const MANIFESTS: readonly EffectManifest[] = [brightness, crossfade];

export function effect(type: string): EffectManifest | undefined {
  return MANIFESTS.find((manifest) => manifest.id === type);
}

export function effectManifests(): readonly EffectManifest[] {
  return MANIFESTS;
}

// The one place that decides what a parameter is worth as a uniform. A project file may carry a
// value outside the declared range, of a `ParamValue` kind that is not a number at all, or a NaN
// -- and all three reach uniform1f without complaint and paint the clip black.
export function clampParam(param: EffectParam, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return param.default;
  return Math.min(Math.max(value, param.min), param.max);
}
