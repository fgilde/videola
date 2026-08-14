import type { EffectParam } from "../effects/registry";
import { denoiseChannel, DENOISE_DEFAULTS } from "./denoise";

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

// A plain gain, and the only insert here that does nothing at all until it is automated. That is
// what it is for: ducking needs somewhere to write a curve, and a bus fader is one number rather
// than a keyframe track. Ahead of the fader like every other insert, so the fader still rides the
// ducked signal and pulling it down does not undo the duck.
//
// The range is the fader's, so a duck can be written in the same numbers a strip already shows.
const gain: AudioEffectManifest = {
  id: "gain",
  name: { de: "Verstärkung", en: "Gain" },
  params: [
    { key: "gain", name: { de: "Verstärkung", en: "Gain" }, default: 1, min: 0, max: 4 },
  ],
  build(ctx) {
    const node = ctx.createGain();
    return { node, knobs: new Map([["gain", node.gain]]) };
  },
};

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

// The two filters that do the work a "denoise" button is usually asked for. Neither is a denoiser:
// nothing here separates a voice from the noise it shares a band with. What they do is take away a
// band that carries nothing anyone wants -- handling rumble, wind and mains hum under a voice, and
// tape hiss or a fan over it -- and that is most of what a location recording needs.
//
// A cutoff and nothing else. A biquad's Q at the corner is a resonance, and a resonant high-pass on
// a voice is a howl at the frequency it was set to; one knob is the whole of operating one.
const lowCut: AudioEffectManifest = {
  id: "lowcut",
  name: { de: "Tiefensperre", en: "Low cut" },
  params: [
    {
      key: "frequency",
      name: { de: "Grenzfrequenz", en: "Cutoff" },
      // Under a speaking voice: the lowest note of a male voice is around 85 Hz, and everything
      // below is the room, the table and the wind.
      default: 80,
      min: 20,
      max: 500,
    },
  ],
  build(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.Q.value = Math.SQRT1_2;
    return { node: filter, knobs: new Map([["frequency", filter.frequency]]) };
  },
};

const highCut: AudioEffectManifest = {
  id: "highcut",
  name: { de: "Höhensperre", en: "High cut" },
  params: [
    {
      key: "frequency",
      name: { de: "Grenzfrequenz", en: "Cutoff" },
      // Above speech and below the top of the band: consonants live up to about 8 kHz, hiss goes
      // on well past it.
      default: 12000,
      min: 1000,
      max: 20000,
    },
  ],
  build(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = Math.SQRT1_2;
    return { node: filter, knobs: new Map([["frequency", filter.frequency]]) };
  },
};

// The two shelves the peaking band above could not be, and the reason they are two effects rather than
// one with a type knob: a manifest carries floats, a type is a choice, and a select on a strip is a
// different piece of work. A shelf lifts or drops everything past its corner rather than a band around
// it, which is what "more bass" and "less hiss" actually mean.
const bass: AudioEffectManifest = {
  id: "bass",
  name: { de: "Bass", en: "Bass" },
  params: [
    {
      key: "gain",
      name: { de: "Anhebung (dB)", en: "Gain (dB)" },
      default: 0,
      min: -18,
      max: 18,
    },
    {
      key: "frequency",
      name: { de: "Ecke", en: "Corner" },
      // Where a voice stops being a voice and starts being the room it stood in.
      default: 200,
      min: 40,
      max: 1000,
    },
  ],
  build(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowshelf";
    return {
      node: filter,
      knobs: new Map([
        ["gain", filter.gain],
        ["frequency", filter.frequency],
      ]),
    };
  },
};

const treble: AudioEffectManifest = {
  id: "treble",
  name: { de: "Höhen", en: "Treble" },
  params: [
    {
      key: "gain",
      name: { de: "Anhebung (dB)", en: "Gain (dB)" },
      default: 0,
      min: -18,
      max: 18,
    },
    {
      key: "frequency",
      name: { de: "Ecke", en: "Corner" },
      // Above the consonants: lifting from here is air, dropping from here is hiss.
      default: 6000,
      min: 1000,
      max: 16000,
    },
  ],
  build(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "highshelf";
    return {
      node: filter,
      knobs: new Map([
        ["gain", filter.gain],
        ["frequency", filter.frequency],
      ]),
    };
  },
};

// Mains hum: one narrow notch, at 50 Hz in Europe and 60 in America, and a Q high enough that the
// note beside it survives. A low cut would take the hum and the bottom of the voice with it, which is
// why this is its own effect rather than a setting on that one.
const hum: AudioEffectManifest = {
  id: "hum",
  name: { de: "Brummfilter", en: "Hum filter" },
  params: [
    {
      key: "frequency",
      name: { de: "Netzfrequenz", en: "Mains frequency" },
      default: 50,
      min: 40,
      max: 70,
    },
    // Narrowness. Thirty is about a semitone wide at 50 Hz: wide enough to catch a hum that drifts,
    // narrow enough that the bass note next to it is still there.
    { key: "q", name: { de: "Schärfe", en: "Sharpness" }, default: 30, min: 1, max: 100 },
  ],
  build(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "notch";
    return {
      node: filter,
      knobs: new Map([
        ["frequency", filter.frequency],
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

const MANIFESTS: readonly AudioEffectManifest[] = [
  gain,
  eq,
  // The three that shape a voice by name rather than by frequency, which is how somebody who is not a
  // sound engineer asks for it: more bass, fewer highs, and the hum out.
  bass,
  treble,
  hum,
  lowCut,
  highCut,
  compressor,
  limiter,
];

/**
 * An effect that is not a node: it rewrites the samples once, before anything is scheduled.
 *
 * Spectral noise reduction cannot be an insert. It needs the *whole* recording to find the noise
 * floor -- the level each bin sits at in the pauses -- and a live node sees 128 samples at a time. So
 * it runs over the decoded buffer where the graph loads it, which is also why it costs nothing while
 * nothing asks for it: no clip carries it, no buffer is touched.
 *
 * A clip's chain only. Noise belongs to a recording, and a track carries a mix of them -- learning one
 * floor for two microphones would clean neither.
 */
export interface OfflineAudioEffect {
  id: string;
  name: { de: string; en: string };
  params: readonly EffectParam[];
  /** One channel in, one channel out, at the same length. */
  apply(
    channel: Float32Array<ArrayBuffer>,
    values: Readonly<Record<string, number>>,
  ): Float32Array<ArrayBuffer>;
}

const denoise: OfflineAudioEffect = {
  id: "denoise",
  name: { de: "Rauschunterdrückung", en: "Noise reduction" },
  params: [
    {
      key: "amount",
      name: { de: "Stärke", en: "Amount" },
      // How many times the measured floor is taken away. One leaves an audible remainder, three is
      // where the artefacts start being the loudest thing left.
      default: DENOISE_DEFAULTS.amount,
      min: 0,
      max: 4,
    },
    {
      key: "floorDb",
      name: { de: "Restpegel (dB)", en: "Floor (dB)" },
      // How far down a bin may be pushed. Never to silence: a bin gated off and on between windows is
      // the warble that gives cheap noise reduction away.
      default: DENOISE_DEFAULTS.floorDb,
      min: -60,
      max: 0,
    },
  ],
  apply(channel, values) {
    return denoiseChannel(channel, {
      amount: values.amount ?? DENOISE_DEFAULTS.amount,
      floorDb: values.floorDb ?? DENOISE_DEFAULTS.floorDb,
    });
  },
};

const OFFLINE: readonly OfflineAudioEffect[] = [denoise];

export function offlineAudioEffect(type: string): OfflineAudioEffect | undefined {
  return OFFLINE.find((manifest) => manifest.id === type);
}

export function offlineAudioEffects(): readonly OfflineAudioEffect[] {
  return OFFLINE;
}

export function audioEffect(type: string): AudioEffectManifest | undefined {
  return MANIFESTS.find((manifest) => manifest.id === type);
}

export function audioEffectManifests(): readonly AudioEffectManifest[] {
  return MANIFESTS;
}

// Part of the manifest's own shape, so a consumer that reads `params` has the type without needing
// to know the audio effects borrow it from the video registry.
export type { EffectParam };
