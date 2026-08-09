import { timeToSeconds } from "@videola/core";
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";

import type {
  Clip,
  Effect,
  EffectParams,
  Keyframe,
  MediaAsset,
  ParamValue,
  Project,
  Time,
  Track,
} from "@videola/core";

import { audioEffect, audioEffectManifests } from "./effects";
import { AudioGraph } from "./graph";
import type { AudioBufferSource } from "./graph";

const SAMPLE_RATE = 48_000;
const SECOND = 705_600_000;
const MEDIA = `med_${"a".repeat(64)}`;

// Two tones far enough apart that a filter can take one and leave the other. Neither is near a
// multiple of the other, so what a Goertzel reads at one is not the other's harmonic.
const LOW_HZ = 200;
const HIGH_HZ = 6000;

// A real renderer, not a stand-in: every number below came out of node-web-audio-api running the
// nodes the manifests built. An effect that is wired up but never reaches the signal fails here.
function context(seconds: number): BaseAudioContext {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  return ctx as unknown as BaseAudioContext;
}

function signal(ctx: BaseAudioContext, shape: (seconds: number) => number): AudioBufferSource {
  return {
    async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
      const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
      const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) data[i] = shape(i / SAMPLE_RATE);
      buffer.copyToChannel(data, 0);
      buffer.copyToChannel(data, 1);
      return buffer;
    },
  };
}

// Half amplitude each, so the pair never clips before a filter has had a look at it.
const twoTones = (ctx: BaseAudioContext): AudioBufferSource =>
  signal(
    ctx,
    (t) => 0.5 * Math.sin(2 * Math.PI * LOW_HZ * t) + 0.5 * Math.sin(2 * Math.PI * HIGH_HZ * t),
  );

function effect(effectType: string, params: Record<string, number> = {}): Effect {
  return {
    id: `eff_${effectType}`,
    effectType,
    enabled: true,
    params: Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, { kind: "float", value }]),
    ),
    keyframes: {},
  } as unknown as Effect;
}

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "clp_1",
    source: { kind: "media", media: MEDIA },
    start: 0,
    duration: 4 * SECOND,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {},
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
    ...over,
  } as Clip;
}

function track(id: string, clips: Clip[], over: Partial<Track> = {}): Track {
  return {
    id,
    kind: "audio",
    name: id,
    colorHex: "#2EA043",
    height: 60,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    clips,
    effects: [],
    ...over,
  } as Track;
}

function project(tracks: Track[], master: Partial<{ volume: number; effects: Effect[] }> = {}): Project {
  const asset: MediaAsset = {
    id: MEDIA,
    originalName: "tone.wav",
    mime: "audio/wav",
    kind: "audio",
    sizeBytes: 1n,
    duration: 10 * SECOND,
    width: null,
    height: null,
    fps: null,
    sampleRate: SAMPLE_RATE,
    channels: 2,
  };
  return {
    schemaVersion: 1,
    meta: { id: "prj_1", title: "", tags: [] },
    settings: {
      width: 1920,
      height: 1080,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: SAMPLE_RATE,
      colorSpace: "srgb",
      background: "#000000",
    },
    library: [asset],
    timeline: { tracks },
    markers: [],
    master: { volume: master.volume ?? 1, effects: master.effects ?? [] },
  } as unknown as Project;
}

async function render(
  ctx: BaseAudioContext,
  source: AudioBufferSource,
  built: Project,
  params?: EffectParams,
): Promise<Float32Array> {
  const graph = new AudioGraph(ctx, source, params);
  await graph.prepare(built);
  graph.startAt(0, 0);
  const rendered = await (ctx as unknown as OfflineAudioContext).startRendering();
  return rendered.getChannelData(0) as unknown as Float32Array;
}

// How much of one frequency a stretch of samples holds. The same filter the export harness runs
// over the decoded file, so "the tone survived" means the same thing on both sides of the encoder.
function toneStrength(samples: Float32Array, hertz: number, from = 0, to = samples.length): number {
  const w = (2 * Math.PI * hertz) / SAMPLE_RATE;
  const c = 2 * Math.cos(w);
  let first = 0;
  let second = 0;
  for (let i = from; i < to; i += 1) {
    const next = samples[i]! + c * first - second;
    second = first;
    first = next;
  }
  return (first * first + second * second - c * first * second) / (to - from);
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / (to - from));
}

function peak(samples: Float32Array, from = 0, to = samples.length): number {
  let found = 0;
  for (let i = from; i < to; i += 1) found = Math.max(found, Math.abs(samples[i]!));
  return found;
}

const sample = (seconds: number): number => Math.round(seconds * SAMPLE_RATE);

describe("the audio effect registry", () => {
  it("finds every manifest it lists and nothing else", () => {
    for (const manifest of audioEffectManifests()) {
      expect(audioEffect(manifest.id)).toBe(manifest);
    }
    expect(audioEffect("brightness")).toBeUndefined();
  });

  // A knob the graph cannot reach is a slider that moves nothing, which is the whole failure this
  // milestone exists to end. Checked here rather than per effect so a fourth one cannot slip out.
  it("wires every declared parameter to a knob on the node it builds", () => {
    const ctx = context(0.1);
    for (const manifest of audioEffectManifests()) {
      const built = manifest.build(ctx);
      for (const param of manifest.params) {
        expect(built.knobs.get(param.key), `${manifest.id}.${param.key}`).toBeDefined();
      }
    }
  });

  it("declares a default inside its own range", () => {
    for (const manifest of audioEffectManifests()) {
      for (const param of manifest.params) {
        expect(param.default, `${manifest.id}.${param.key}`).toBeGreaterThanOrEqual(param.min);
        expect(param.default, `${manifest.id}.${param.key}`).toBeLessThanOrEqual(param.max);
      }
    }
  });
});

describe("an equaliser on a track bus", () => {
  it("takes the band it is pointed at and leaves the other tone standing", async () => {
    const ctx = context(1);
    const source = twoTones(ctx);
    const out = await render(
      ctx,
      source,
      project([track("trk_1", [clip()], { effects: [effect("eq", { frequency: HIGH_HZ, gain: -24, q: 1 })] })]),
    );

    const flatCtx = context(1);
    const flat = await render(flatCtx, twoTones(flatCtx), project([track("trk_1", [clip()])]));

    // Measured past the filter's own settling, so what is read is the steady state and not its
    // transient. Both tones are in the same render, so nothing here can pass by going silent.
    const window: [number, number] = [sample(0.2), sample(0.9)];
    expect(toneStrength(out, HIGH_HZ, ...window)).toBeLessThan(
      toneStrength(flat, HIGH_HZ, ...window) / 10,
    );
    expect(toneStrength(out, LOW_HZ, ...window)).toBeGreaterThan(
      toneStrength(flat, LOW_HZ, ...window) * 0.8,
    );
  });

  // A low cut is what a "denoise" button is usually asked for: the rumble under a voice, which
  // shares no band with it. Both tones in one render, so nothing passes by going silent.
  it("takes the rumble out from under a voice and leaves the voice", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([
        track("trk_1", [clip()], { effects: [effect("lowcut", { frequency: 1000 })] }),
      ]),
    );
    const flatCtx = context(1);
    const flat = await render(flatCtx, twoTones(flatCtx), project([track("trk_1", [clip()])]));

    const window: [number, number] = [sample(0.2), sample(0.9)];
    expect(toneStrength(out, LOW_HZ, ...window)).toBeLessThan(
      toneStrength(flat, LOW_HZ, ...window) / 10,
    );
    expect(toneStrength(out, HIGH_HZ, ...window)).toBeGreaterThan(
      toneStrength(flat, HIGH_HZ, ...window) * 0.7,
    );
  });

  it("takes the hiss off the top and leaves what is under it", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([
        track("trk_1", [clip()], { effects: [effect("highcut", { frequency: 1000 })] }),
      ]),
    );
    const flatCtx = context(1);
    const flat = await render(flatCtx, twoTones(flatCtx), project([track("trk_1", [clip()])]));

    const window: [number, number] = [sample(0.2), sample(0.9)];
    expect(toneStrength(out, HIGH_HZ, ...window)).toBeLessThan(
      toneStrength(flat, HIGH_HZ, ...window) / 10,
    );
    expect(toneStrength(out, LOW_HZ, ...window)).toBeGreaterThan(
      toneStrength(flat, LOW_HZ, ...window) * 0.7,
    );
  });

  it("lifts the band it is pointed at when the gain is positive", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([track("trk_1", [clip()], { effects: [effect("eq", { frequency: HIGH_HZ, gain: 12, q: 1 })] })]),
    );
    const flatCtx = context(1);
    const flat = await render(flatCtx, twoTones(flatCtx), project([track("trk_1", [clip()])]));

    const window: [number, number] = [sample(0.2), sample(0.9)];
    expect(toneStrength(out, HIGH_HZ, ...window)).toBeGreaterThan(
      toneStrength(flat, HIGH_HZ, ...window) * 4,
    );
  });

  // The clamp is the graph's, not the platform's: a BiquadFilterNode takes a gain of 100 dB without
  // complaint and deafens whoever is listening. Both halves matter -- that 100 renders as 24, and
  // that 24 is not the same as 12, so the comparison is not two clamped values agreeing.
  it("clamps a gain past the declared maximum instead of obeying it", async () => {
    const withGain = async (gain: number): Promise<Float32Array> => {
      const ctx = context(0.5);
      return render(
        ctx,
        twoTones(ctx),
        project([track("trk_1", [clip()], { effects: [effect("eq", { frequency: HIGH_HZ, gain, q: 1 })] })]),
      );
    };
    const window: [number, number] = [sample(0.2), sample(0.45)];
    const [wild, ceiling, half] = await Promise.all([withGain(100), withGain(24), withGain(12)]);

    expect(toneStrength(wild, HIGH_HZ, ...window)).toBeCloseTo(
      toneStrength(ceiling, HIGH_HZ, ...window),
      5,
    );
    expect(toneStrength(ceiling, HIGH_HZ, ...window)).toBeGreaterThan(
      toneStrength(half, HIGH_HZ, ...window) * 2,
    );
  });

  // A hand-authored project, or a parameter someone changed the kind of. Neither reaches the node.
  it("falls back to the default for a value that is not a number", async () => {
    const ctx = context(0.5);
    const odd = effect("eq", { frequency: HIGH_HZ, q: 1 });
    odd.params.gain = { kind: "bool", value: true } as unknown as ParamValue;
    const out = await render(ctx, twoTones(ctx), project([track("trk_1", [clip()], { effects: [odd] })]));

    const flatCtx = context(0.5);
    const flat = await render(flatCtx, twoTones(flatCtx), project([track("trk_1", [clip()])]));
    const window: [number, number] = [sample(0.2), sample(0.45)];

    // A gain of zero is a flat peaking band, so the tone comes through as if nothing were there.
    expect(toneStrength(out, HIGH_HZ, ...window)).toBeCloseTo(
      toneStrength(flat, HIGH_HZ, ...window),
      4,
    );
  });
});

// A quiet second, then a loud one. What a compressor is for, and the only signal that tells one
// apart from a plain gain: it has to change the *ratio* between the two, not both by the same
// amount. Silence through a compressor proves nothing at all.
const levelJump = (ctx: BaseAudioContext): AudioBufferSource =>
  signal(ctx, (t) => (t < 1 ? 0.02 : 0.9) * Math.sin(2 * Math.PI * 400 * t));

describe("a compressor on a track bus", () => {
  it("pulls the loud passage down towards the quiet one", async () => {
    const withRatio = async (ratio: number): Promise<Float32Array> => {
      const ctx = context(2);
      return render(
        ctx,
        levelJump(ctx),
        project([
          track("trk_1", [clip()], {
            effects: [
              effect("compressor", { threshold: -40, ratio, attack: 0.001, release: 0.05 }),
            ],
          }),
        ]),
      );
    };
    const [squashed, open] = await Promise.all([withRatio(20), withRatio(1)]);

    const quiet = (out: Float32Array): number => rms(out, sample(0.5), sample(0.95));
    const loud = (out: Float32Array): number => rms(out, sample(1.4), sample(1.95));

    // The ratio between the passages is what moves. Comparing the loud half alone would also pass
    // for an effect that simply turned everything down.
    expect(loud(squashed) / quiet(squashed)).toBeLessThan((loud(open) / quiet(open)) / 2);
    // And it is still audible: a compressor that silenced the track would satisfy the line above.
    expect(loud(squashed)).toBeGreaterThan(0.05);
  });
});

const fullScale = (ctx: BaseAudioContext): AudioBufferSource =>
  signal(ctx, (t) => Math.sin(2 * Math.PI * 400 * t));

describe("a limiter on the master bus", () => {
  // What the knob promises and no more. `DynamicsCompressorNode` brings its own makeup gain, so a
  // threshold of -18 does not put the output at -18 -- it puts it measurably below where it was,
  // and lower still as the threshold comes down. Both halves are asserted: an effect that did
  // nothing fails the first, and one that muted the master fails the last.
  it("pulls a full-scale master down, further the lower the threshold", async () => {
    const withMaster = async (effects: Effect[]): Promise<Float32Array> => {
      const ctx = context(1);
      return render(ctx, fullScale(ctx), project([track("trk_1", [clip()])], { effects }));
    };
    const [open, gentle, firm] = await Promise.all([
      withMaster([]),
      withMaster([effect("limiter", { threshold: -6 })]),
      withMaster([effect("limiter", { threshold: -18 })]),
    ]);

    const window: [number, number] = [sample(0.3), sample(0.95)];
    expect(peak(open, ...window)).toBeGreaterThan(0.9);
    expect(peak(gentle, ...window)).toBeLessThan(peak(open, ...window) * 0.95);
    expect(peak(firm, ...window)).toBeLessThan(peak(gentle, ...window) * 0.8);
    expect(peak(firm, ...window)).toBeGreaterThan(0.2);
  });

  it("passes the sound through untouched when it is disabled", async () => {
    const loud = fullScale;
    const off = effect("limiter", { threshold: -18 });
    off.enabled = false;

    const ctx = context(0.5);
    const bypassed = await render(ctx, loud(ctx), project([track("trk_1", [clip()])], { effects: [off] }));
    const openCtx = context(0.5);
    const open = await render(openCtx, loud(openCtx), project([track("trk_1", [clip()])]));

    expect(peak(bypassed, sample(0.3), sample(0.45))).toBeCloseTo(
      peak(open, sample(0.3), sample(0.45)),
      3,
    );
  });
});

describe("the order of an effect chain", () => {
  // A chain is a sequence, not a set. A limiter after a boost catches what the boost made; the same
  // two the other way round boost what the limiter already held down, and the peak that leaves is
  // not the same. Wiring the chain in the order it is stored is the whole of honouring that.
  it("runs the effects in the order the project stores them", async () => {
    const chained = async (effects: Effect[]): Promise<Float32Array> => {
      const ctx = context(1);
      return render(ctx, fullScale(ctx), project([track("trk_1", [clip()], { effects })]));
    };
    const boost = (): Effect => effect("eq", { frequency: 400, gain: 24, q: 1 });
    const hold = (): Effect => effect("limiter", { threshold: -18 });

    const [boostFirst, limitFirst] = await Promise.all([
      chained([boost(), hold()]),
      chained([hold(), boost()]),
    ]);
    const window: [number, number] = [sample(0.3), sample(0.95)];

    expect(peak(limitFirst, ...window)).toBeGreaterThan(peak(boostFirst, ...window) * 1.5);
  });
});

describe("an effect chain that cannot be built in full", () => {
  // Named first because everything below it is meaningless without it: if this build carries no
  // audio manifests at all, every chain silently becomes a pass-through and each attenuation check
  // then compares a signal against itself. That reads as "the filter did nothing" rather than as
  // "there was no filter", which is a different bug and a much longer hunt.
  it("carries the manifests the rest of these checks rely on", () => {
    const ids = audioEffectManifests().map((manifest) => manifest.id);

    expect(ids).toContain("eq");
    expect(ids).toContain("compressor");
  });

  // One unknown type must not take the track's sound with it, for the same reason one missing
  // medium does not take the timeline's. Both positions, because the chain is walked from its far
  // end: an unknown one last in the list is the first thing that walk meets, and giving up there
  // would silently drop everything ahead of it.
  it("skips a type this build does not carry, wherever it sits in the chain", async () => {
    const alien = (): Effect => effect("brightness", { amount: 2 });
    const notch = (): Effect => effect("eq", { frequency: HIGH_HZ, gain: -24, q: 1 });
    const chained = async (effects: Effect[]): Promise<Float32Array> => {
      const ctx = context(0.5);
      return render(ctx, twoTones(ctx), project([track("trk_1", [clip()], { effects })]));
    };
    const flatCtx = context(0.5);
    const flat = await render(flatCtx, twoTones(flatCtx), project([track("trk_1", [clip()])]));
    const window: [number, number] = [sample(0.2), sample(0.45)];

    for (const chain of [[alien(), notch()], [notch(), alien()]]) {
      const out = await chained(chain);
      expect(toneStrength(out, LOW_HZ, ...window)).toBeGreaterThan(
        toneStrength(flat, LOW_HZ, ...window) * 0.8,
      );
      expect(toneStrength(out, HIGH_HZ, ...window)).toBeLessThan(
        toneStrength(flat, HIGH_HZ, ...window) / 10,
      );
    }
  });
});

describe("effects and the rest of the mixer, crossed", () => {
  // Effect and solo. A chain that were wired past the bus gain would still sound here, which is
  // the wiring mistake this catches.
  it("stays silent on a track that solo has switched away", async () => {
    const ctx = context(0.5);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([
        track("trk_1", [clip()], { effects: [effect("eq", { frequency: HIGH_HZ, gain: 24, q: 1 })] }),
        track("trk_2", [clip({ id: "clp_2" })], { solo: true, volume: 0 }),
      ]),
    );
    expect(peak(out, sample(0.2), sample(0.45))).toBeLessThan(1e-6);
  });

  // Effect and mute, the other way round: mute beats solo, and an insert ahead of the fader must
  // not become a way around it.
  it("stays silent on a muted track however loud its chain is", async () => {
    const ctx = context(0.5);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([
        track("trk_1", [clip()], {
          muted: true,
          effects: [effect("eq", { frequency: HIGH_HZ, gain: 24, q: 1 })],
        }),
      ]),
    );
    expect(peak(out, sample(0.2), sample(0.45))).toBeLessThan(1e-6);
  });

  // The fader rides the processed signal, which is what "insert ahead of the fader" means and what
  // makes a track fader still a plain scale over whatever the chain produced.
  it("scales what the chain produced by the track fader", async () => {
    const withVolume = async (volume: number): Promise<Float32Array> => {
      const ctx = context(0.5);
      return render(
        ctx,
        twoTones(ctx),
        project([
          track("trk_1", [clip()], {
            volume,
            effects: [effect("eq", { frequency: HIGH_HZ, gain: 12, q: 1 })],
          }),
        ]),
      );
    };
    const [full, half] = await Promise.all([withVolume(1), withVolume(0.5)]);
    for (const index of [sample(0.2), sample(0.3), sample(0.42)]) {
      expect(half[index]!).toBeCloseTo(full[index]! / 2, 5);
    }
  });

  it("runs a track chain and the mastering chain on the same signal", async () => {
    const boosted = (master: Effect[]): Project =>
      project(
        [track("trk_1", [clip()], { effects: [effect("eq", { frequency: 400, gain: 24, q: 1 })] })],
        { effects: master },
      );
    const withMaster = async (master: Effect[]): Promise<Float32Array> => {
      const ctx = context(1);
      return render(ctx, fullScale(ctx), boosted(master));
    };
    const [open, mastered] = await Promise.all([
      withMaster([]),
      withMaster([effect("limiter", { threshold: -18 })]),
    ]);
    const window: [number, number] = [sample(0.3), sample(0.95)];

    // The track chain lifts a full-scale tone far past one; the mastering chain is what brings it
    // back. Both links are in the one comparison -- drop either and the numbers meet.
    expect(peak(open, ...window)).toBeGreaterThan(4);
    expect(peak(mastered, ...window)).toBeLessThan(peak(open, ...window) / 2);
    expect(peak(mastered, ...window)).toBeGreaterThan(0.2);
  });
});

function keyframe(time: Time, value: number): Keyframe {
  return { time, value: { kind: "float", value }, interp: "linear" } as unknown as Keyframe;
}

// Stands in for the core, and only for the core's arithmetic -- the graph's own job is to decide
// *when* to ask, and that is what these tests read. What the core answers is proven against the
// real Rust build in packages/core/src/roundtrip.test.ts.
function resolver(values: Record<string, (at: Time) => number>): EffectParams {
  return (at) =>
    new Map(
      Object.entries(values).map(([id, of]) => [
        id,
        new Map<string, ParamValue>([["frequency", { kind: "float", value: of(at) }]]),
      ]),
    );
}

describe("a keyframed effect parameter", () => {
  // Effect and keyframe, crossed at real samples. The band moves from the low tone to the high one
  // over the render, so which tone survives changes with the playhead -- a graph that scheduled the
  // static value, or only the first corner, leaves the same tone cut throughout.
  it("sweeps the band across the render instead of standing still", async () => {
    const swept = effect("eq", { frequency: LOW_HZ, gain: -24, q: 1 });
    swept.keyframes = { frequency: [keyframe(0, LOW_HZ), keyframe(2 * SECOND, HIGH_HZ)] };

    const ctx = context(2);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([track("trk_1", [clip()], { effects: [swept] })]),
      resolver({
        [swept.id]: (at) => LOW_HZ + ((HIGH_HZ - LOW_HZ) * at) / (2 * SECOND),
      }),
    );

    const early: [number, number] = [sample(0.15), sample(0.4)];
    const late: [number, number] = [sample(1.6), sample(1.95)];
    // Early the low tone is in the notch and the high one is not; late the two have swapped.
    expect(toneStrength(out, LOW_HZ, ...early)).toBeLessThan(toneStrength(out, HIGH_HZ, ...early));
    expect(toneStrength(out, HIGH_HZ, ...late)).toBeLessThan(toneStrength(out, LOW_HZ, ...late));
  });

  // Keyframe and a start point inside the ramp. The graph schedules only the future and enters at
  // the interpolated value, the same rule a fade follows -- pulling the first corner up to the
  // start instead would flatten the ramp onto a different slope.
  it("enters a ramp already under way at the value the core states, not at its first corner", async () => {
    const swept = effect("eq", { frequency: LOW_HZ, gain: -24, q: 1 });
    swept.keyframes = { frequency: [keyframe(0, LOW_HZ), keyframe(4 * SECOND, HIGH_HZ)] };
    const at = (t: Time): number => LOW_HZ + ((HIGH_HZ - LOW_HZ) * t) / (4 * SECOND);

    const ctx = context(0.5);
    const graph = new AudioGraph(ctx, twoTones(ctx), resolver({ [swept.id]: at }));
    await graph.prepare(project([track("trk_1", [clip()], { effects: [swept] })]));
    // Three seconds in, where the sweep has passed the low tone and sits near the high one.
    graph.startAt(0, 3 * SECOND);
    const rendered = await (ctx as unknown as OfflineAudioContext).startRendering();
    const out = rendered.getChannelData(0) as unknown as Float32Array;

    const window: [number, number] = [sample(0.15), sample(0.45)];
    expect(toneStrength(out, HIGH_HZ, ...window)).toBeLessThan(
      toneStrength(out, LOW_HZ, ...window),
    );
  });

  // The graph samples inside a segment as well as at its corners, so a shape the core bends between
  // two keys is followed rather than straightened. A resolver that jumps mid-segment is the cheapest
  // shape that tells the two apart: sampled only at the corners, the jump is never seen at all.
  it("follows the core between two corners and not just the line across them", async () => {
    const stepped = effect("eq", { frequency: HIGH_HZ, gain: -24, q: 1 });
    stepped.keyframes = { frequency: [keyframe(0, HIGH_HZ), keyframe(SECOND, HIGH_HZ)] };

    const ctx = context(1);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([track("trk_1", [clip()], { effects: [stepped] })]),
      // Both corners say 6000; only the middle of the segment says 200. Reading the ends alone
      // gives a filter that never leaves the high tone.
      resolver({ [stepped.id]: (at) => (at > SECOND / 4 && at < (3 * SECOND) / 4 ? LOW_HZ : HIGH_HZ) }),
    );

    const middle: [number, number] = [sample(0.4), sample(0.6)];
    expect(toneStrength(out, LOW_HZ, ...middle)).toBeLessThan(
      toneStrength(out, HIGH_HZ, ...middle),
    );
  });

  // A hold has to step, not glide. The sampling inside a segment is what would turn it into a glide:
  // read every eighth and the last reading before the corner already sits an eighth of the way up
  // the ramp the platform draws to the next one. The sample a single flick short of each corner is
  // what keeps the old value standing until the moment the new one takes over.
  it("steps at a corner the core holds up to rather than sliding into it", async () => {
    const stepped = effect("eq", { frequency: LOW_HZ, gain: -24, q: 1 });
    stepped.keyframes = { frequency: [keyframe(0, LOW_HZ), keyframe(SECOND, HIGH_HZ)] };

    const ctx = context(1);
    const out = await render(
      ctx,
      twoTones(ctx),
      project([track("trk_1", [clip()], { effects: [stepped] })]),
      // What `Interp::Hold` resolves to: the left corner's value everywhere up to the right one.
      resolver({ [stepped.id]: (at) => (at < SECOND ? LOW_HZ : HIGH_HZ) }),
    );

    // The last tenth of the segment, where a glide would already have carried the notch most of the
    // way to the high tone. Held, the low one is still the one in it.
    const late: [number, number] = [sample(0.88), sample(0.98)];
    expect(toneStrength(out, LOW_HZ, ...late)).toBeLessThan(toneStrength(out, HIGH_HZ, ...late));
  });
});
