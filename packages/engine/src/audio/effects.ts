import { clampParam } from "../effects/registry";

import type { EffectParam } from "../effects/registry";

/**
 * A built effect: the node the signal passes through, and the knobs the graph may automate. One
 * node per effect, because all three of these are a single native one -- an effect that needs a
 * pair would return its input here and its output separately, and none does yet.
 */
export interface AudioEffectNode {
  node: AudioNode;
  knobs: ReadonlyMap<string, AudioParam>;
}

/**
 * The audio counterpart of `EffectManifest`, and deliberately not the same type: a video effect is
 * a fragment source and a pass count, an audio effect is a native node. They share `EffectParam`,
 * which is the part both surfaces put a slider on.
 */
export interface AudioEffectManifest {
  id: string;
  name: { de: string; en: string };
  params: readonly EffectParam[];
  build(ctx: BaseAudioContext): AudioEffectNode;
}

// A peaking band rather than a shelf or a cut: it is the only filter shape that can both add and
// remove at a chosen place, so one effect covers "less boxy" and "more air" without a second one.
//
// ponytail: no filter *type* knob, so this cannot be a high-pass. A type is a choice and the
// manifest carries floats only -- `ParamValue` already has a `choice` kind, and the day the
// inspector grows a select is the day this gains a `type` param and the shelves come with it.
const eq: AudioEffectManifest = {
  id: "eq",
  name: { de: "Equalizer", en: "Equaliser" },
  params: [
    {
      key: "frequency",
      name: { de: "Frequenz", en: "Frequency" },
      default: 1000,
      min: 20,
      max: 20000,
    },
    { key: "gain", name: { de: "Anhebung", en: "Gain" }, default: 0, min: -24, max: 24 },
    { key: "q", name: { de: "Güte", en: "Q" }, default: 1, min: 0.1, max: 18 },
  ],
  build(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "peaking";
    return {
      node: filter,
      knobs: new Map([
        ["frequency", filter.frequency],
        ["gain", filter.gain],
        // Spelled `q` on the outside because a parameter key becomes a JSON field and every other
        // one in the project is lower case; `Q` is the platform's spelling, not the format's.
        ["q", filter.Q],
      ]),
    };
  },
};

// The knee stays at the platform's default. It is a fifth slider on a strip that already has four,
// and the two settings anyone reaches for -- how loud before it acts and how hard -- are here.
const compressor: AudioEffectManifest = {
  id: "compressor",
  name: { de: "Kompressor", en: "Compressor" },
  params: [
    {
      key: "threshold",
      name: { de: "Schwelle", en: "Threshold" },
      default: -24,
      min: -60,
      max: 0,
    },
    { key: "ratio", name: { de: "Verhältnis", en: "Ratio" }, default: 4, min: 1, max: 20 },
    { key: "attack", name: { de: "Ansprechzeit", en: "Attack" }, default: 0.003, min: 0, max: 1 },
    { key: "release", name: { de: "Rückfallzeit", en: "Release" }, default: 0.25, min: 0, max: 1 },
  ],
  build(ctx) {
    const node = ctx.createDynamicsCompressor();
    return {
      node,
      knobs: new Map([
        ["threshold", node.threshold],
        ["ratio", node.ratio],
        ["attack", node.attack],
        ["release", node.release],
      ]),
    };
  },
};

// The same native node as the compressor, held at the settings that make a mastering stage: the
// highest ratio the platform offers, no knee to round the corner off, and an attack short enough
// that a transient does not slip past ahead of it. One knob is left, which is the whole of
// operating one -- offering the other four would be offering two compressors under two names.
//
// The knob is a threshold and is named one. `DynamicsCompressorNode` applies its own makeup gain,
// so the level that leaves sits well above the number set here -- measured, at ratio 20 and no
// knee, a full-scale tone comes out at -4 dBFS with the threshold at -12. A knob called "ceiling"
// would therefore be naming something the node does not deliver. What it does deliver is real and
// monotone: lower the threshold and the master gets quieter and more even.
const limiter: AudioEffectManifest = {
  id: "limiter",
  name: { de: "Limiter", en: "Limiter" },
  params: [
    { key: "threshold", name: { de: "Schwelle", en: "Threshold" }, default: -6, min: -40, max: 0 },
  ],
  build(ctx) {
    const node = ctx.createDynamicsCompressor();
    node.ratio.value = 20;
    node.knee.value = 0;
    node.attack.value = 0.001;
    node.release.value = 0.05;
    return { node, knobs: new Map([["threshold", node.threshold]]) };
  },
};

const MANIFESTS: readonly AudioEffectManifest[] = [eq, compressor, limiter];

export function audioEffect(type: string): AudioEffectManifest | undefined {
  return MANIFESTS.find((manifest) => manifest.id === type);
}

export function audioEffectManifests(): readonly AudioEffectManifest[] {
  return MANIFESTS;
}

export { clampParam };
export type { EffectParam };
