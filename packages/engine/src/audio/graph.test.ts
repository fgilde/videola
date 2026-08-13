import { consumedBetween, consumedSource, timeToSeconds } from "@videola/core";
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it, vi } from "vitest";

import type { Clip, Effect, Interp, MediaAsset, Project, Time, Track } from "@videola/core";

import { AudioGraph, hasAudibleClips, MASTER_METER, measureLoudness } from "./graph";
import { integratedLufs, SILENT_LEVEL } from "./loudness";
import type { AudioBufferSource } from "./graph";

const SAMPLE_RATE = 48_000;
const SECOND = 705_600_000;
const MEDIA = `med_${"a".repeat(64)}`;

// A real renderer, not a stand-in. Every assertion below reads samples this context produced from
// the automation the graph scheduled, so a fade that never ramps cannot pass.
function context(seconds: number): BaseAudioContext {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  return ctx as unknown as BaseAudioContext;
}

function signal(ctx: BaseAudioContext, shape: (progress: number) => number): AudioBufferSource {
  return {
    async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
      const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
      const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) data[i] = shape(i / frames);
      buffer.copyToChannel(data, 0);
      buffer.copyToChannel(data, 1);
      return buffer;
    },
  };
}

const dc = (ctx: BaseAudioContext): AudioBufferSource => signal(ctx, () => 1);

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "clp_1",
    source: { kind: "media", media: MEDIA },
    start: 0,
    duration: SECOND,
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

function project(tracks: Track[], masterVolume = 1): Project {
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
    master: { volume: masterVolume, effects: [] },
  } as unknown as Project;
}

interface RenderOptions {
  projectTime?: Time;
  // An offline context is born at zero, a live one has been running for a while. Both have to be
  // exercised: the two are the same code path only if nothing gets clamped along the way.
  contextTime?: number;
  before?: (graph: AudioGraph) => void;
}

async function render(
  ctx: BaseAudioContext,
  source: AudioBufferSource,
  built: Project,
  options: RenderOptions = {},
): Promise<Float32Array> {
  const graph = new AudioGraph(ctx, source);
  await graph.prepare(built);
  options.before?.(graph);
  graph.startAt(options.contextTime ?? ctx.currentTime, options.projectTime ?? 0);
  return drain(ctx);
}

async function drain(ctx: BaseAudioContext): Promise<Float32Array> {
  const rendered = await (ctx as unknown as OfflineAudioContext).startRendering();
  return rendered.getChannelData(0) as unknown as Float32Array;
}

const at = (samples: Float32Array, seconds: number): number =>
  samples[Math.round(seconds * SAMPLE_RATE)] ?? Number.NaN;

describe("AudioGraph", () => {
  it("ramps a fade-in from silence to the clip gain and holds it", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      dc(ctx),
      project([track("A1", [clip({ fades: { inDuration: SECOND / 2, outDuration: 0 } })])]),
    );

    expect(out[0]).toBeCloseTo(0, 3);
    expect(at(out, 0.125)).toBeCloseTo(0.25, 2);
    expect(at(out, 0.25)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.375)).toBeCloseTo(0.75, 2);
    expect(at(out, 0.5)).toBeCloseTo(1, 2);
    expect(at(out, 0.75)).toBeCloseTo(1, 2);
  });

  it("ramps a fade-out down to silence at the clip end", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      dc(ctx),
      project([track("A1", [clip({ fades: { inDuration: 0, outDuration: SECOND / 2 } })])]),
    );

    expect(at(out, 0.25)).toBeCloseTo(1, 2);
    expect(at(out, 0.75)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.99)).toBeCloseTo(0.02, 2);
  });

  it("keeps the clip gain flat without fades", async () => {
    const ctx = context(1);
    const out = await render(ctx, dc(ctx), project([track("A1", [clip({ volume: 0.5 })])]));

    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(at(out, 0.5)).toBeCloseTo(0.5, 2);
  });

  it("silences a muted track", async () => {
    const ctx = context(0.5);
    const out = await render(
      ctx,
      dc(ctx),
      project([track("A1", [clip()], { muted: true })]),
    );

    expect(Math.max(...out)).toBe(0);
  });

  it("silences every track that is not soloed", async () => {
    const ctx = context(0.5);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [clip({ volume: 0.25 })], { solo: true }),
        track("A2", [clip({ id: "clp_2", volume: 0.5 })]),
      ]),
    );

    expect(at(out, 0.25)).toBeCloseTo(0.25, 2);
  });

  it("scales the mix by the master volume", async () => {
    const ctx = context(0.5);
    const out = await render(ctx, dc(ctx), project([track("A1", [clip()])], 0.4));

    expect(at(out, 0.25)).toBeCloseTo(0.4, 2);
  });

  it("follows setMasterVolume", async () => {
    const ctx = context(1);
    const out = await render(ctx, dc(ctx), project([track("A1", [clip()])]), {
      before: (graph) => graph.setMasterVolume(0.25),
    });

    expect(at(out, 0.9)).toBeCloseTo(0.25, 2);
  });

  it("starts a clip that is already running at the matching sample", async () => {
    const ctx = context(0.5);
    const out = await render(
      ctx,
      signal(ctx, (progress) => progress),
      project([track("A1", [clip()])]),
      { projectTime: SECOND / 2 },
    );

    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(at(out, 0.25)).toBeCloseTo(0.75, 2);
  });

  it("stays silent for a clip that ended before the start point", async () => {
    const ctx = context(0.5);
    const out = await render(ctx, dc(ctx), project([track("A1", [clip()])]), {
      projectTime: 2 * SECOND,
    });

    expect(Math.max(...out)).toBe(0);
  });

  it("delays a clip that starts later on the timeline", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      dc(ctx),
      project([track("A1", [clip({ start: SECOND / 2 })])]),
    );

    expect(at(out, 0.25)).toBe(0);
    expect(at(out, 0.75)).toBeCloseTo(1, 2);
  });

  it("ignores clips whose medium carries no audio", async () => {
    const ctx = context(0.5);
    const built = project([track("V1", [clip()], { kind: "video" })]);
    built.library[0]!.channels = null;
    const out = await render(ctx, dc(ctx), built);

    expect(Math.max(...out)).toBe(0);
  });

  it("stop() removes everything a start scheduled", async () => {
    const ctx = context(0.5);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(project([track("A1", [clip()])]));
    graph.startAt(ctx.currentTime, 0);
    graph.stop();

    expect(Math.max(...(await drain(ctx)))).toBe(0);
  });
});

// Resuming is the ordinary case -- press play with the playhead anywhere but zero -- and the
// envelope has to pick up where it stands rather than start over. The context time is varied
// alongside it, because a live context is never at zero when playback begins.
describe("AudioGraph, starting inside a fade", () => {
  it("picks the fade-in up at its interpolated value, offline context", async () => {
    const ctx = context(1.5);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          clip({ duration: 3 * SECOND, fades: { inDuration: 2 * SECOND, outDuration: 0 } }),
        ]),
      ]),
      { projectTime: SECOND },
    );

    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(at(out, 0.5)).toBeCloseTo(0.75, 2);
    expect(at(out, 1)).toBeCloseTo(1, 2);
    expect(at(out, 1.25)).toBeCloseTo(1, 2);
  });

  it("picks the fade-in up at its interpolated value on a context already running", async () => {
    const ctx = context(1.5);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          clip({ duration: 3 * SECOND, fades: { inDuration: 2 * SECOND, outDuration: 0 } }),
        ]),
      ]),
      { projectTime: SECOND, contextTime: 0.2 },
    );

    expect(at(out, 0.2)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.7)).toBeCloseTo(0.75, 2);
    expect(at(out, 1.2)).toBeCloseTo(1, 2);
  });

  it("picks the fade-out up on its way down instead of jumping to full gain", async () => {
    const ctx = context(1.2);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          clip({ duration: 4 * SECOND, fades: { inDuration: 0, outDuration: 2 * SECOND } }),
        ]),
      ]),
      { projectTime: 3 * SECOND },
    );

    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(at(out, 0.5)).toBeCloseTo(0.25, 2);
    expect(at(out, 0.99)).toBeCloseTo(0, 2);
  });
});

// `trim` and `split` leave `fades` alone (crates/videola-core/src/command/clip.rs), so a clip
// shorter than its own fades is reachable without the inspector ever being opened. The rule:
// fades that do not fit are scaled down together, keeping their ratio, until they exactly fill
// the clip.
describe("AudioGraph, fades longer than the clip", () => {
  it("scales a fade-in that alone outlasts the clip", async () => {
    const ctx = context(0.6);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          clip({
            duration: Math.round(0.4 * SECOND),
            fades: {
              inDuration: Math.round(0.8 * SECOND),
              outDuration: Math.round(0.2 * SECOND),
            },
          }),
        ]),
      ]),
    );

    // 0.8 and 0.2 into a 0.4 s clip scale by 0.4 -> 0.32 s in, 0.08 s out.
    expect(at(out, 0.16)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.32)).toBeCloseTo(1, 2);
    expect(at(out, 0.36)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.38)).toBeCloseTo(0.25, 2);
  });

  it("meets in the middle when both fades are equal and too long", async () => {
    const ctx = context(0.6);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          clip({
            duration: Math.round(0.4 * SECOND),
            fades: {
              inDuration: Math.round(0.3 * SECOND),
              outDuration: Math.round(0.3 * SECOND),
            },
          }),
        ]),
      ]),
    );

    expect(at(out, 0.1)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.2)).toBeCloseTo(1, 2);
    expect(at(out, 0.3)).toBeCloseTo(0.5, 2);
  });
});

describe("AudioGraph, mute and solo together", () => {
  it("silences a track that is soloed and muted at once, and everything else with it", async () => {
    const ctx = context(0.3);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [clip()], { solo: true, muted: true }),
        track("A2", [clip({ id: "clp_2" })]),
      ]),
    );

    expect(Math.max(...out)).toBe(0);
  });

  it("keeps every soloed track audible", async () => {
    const ctx = context(0.3);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [clip({ volume: 0.25 })], { solo: true }),
        track("A2", [clip({ id: "clp_2", volume: 0.5 })], { solo: true }),
        track("A3", [clip({ id: "clp_3", volume: 0.125 })]),
      ]),
    );

    expect(at(out, 0.1)).toBeCloseTo(0.75, 2);
  });
});

describe("AudioGraph, prepare under load", () => {
  it("keeps the newest prepare even when an older one finishes last", async () => {
    const ctx = context(0.3);
    const gates: Array<() => void> = [];
    let call = 0;
    const source: AudioBufferSource = {
      async bufferFor(_hash, from, to) {
        const level = call === 0 ? 1 : 0.25;
        call += 1;
        await new Promise<void>((resolve) => gates.push(resolve));
        const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
        const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
        const data = new Float32Array(frames).fill(level);
        buffer.copyToChannel(data, 0);
        buffer.copyToChannel(data, 1);
        return buffer;
      },
    };
    const graph = new AudioGraph(ctx, source);

    const first = graph.prepare(project([track("A1", [clip()])]));
    await Promise.resolve();
    const second = graph.prepare(project([track("A1", [clip({ id: "clp_2" })])]));
    await Promise.resolve();
    gates[1]!();
    await new Promise((resolve) => setTimeout(resolve, 5));
    gates[0]!();
    await Promise.all([first, second]);
    graph.startAt(ctx.currentTime, 0);

    expect(at(await drain(ctx), 0.1)).toBeCloseTo(0.25, 2);
  });

  it("drops only the clip whose medium is gone", async () => {
    const ctx = context(0.3);
    const good = dc(ctx);
    let call = 0;
    const source: AudioBufferSource = {
      async bufferFor(hash, from, to) {
        if (call > 0) return good.bufferFor(hash, from, to);
        call += 1;
        throw new Error("error.mediaMissing");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await render(
      ctx,
      source,
      project([
        track("A1", [clip()], { volume: 0.5 }),
        track("A2", [clip({ id: "clp_2" })], { volume: 0.25 }),
      ]),
    );

    expect(at(out, 0.1)).toBeCloseTo(0.25, 2);
  });
});

// prepare() runs after every edit, so a clip dragged along the timeline is prepared once per
// pointer movement. What the decode depends on is the range, not where the clip sits.
describe("AudioGraph, repeated prepares", () => {
  it("decodes a range once, however often the timeline is edited", async () => {
    const ctx = context(0.3);
    const source = dc(ctx);
    const decode = vi.spyOn(source, "bufferFor");
    const graph = new AudioGraph(ctx, source);

    await graph.prepare(project([track("A1", [clip()])]));
    await graph.prepare(project([track("A1", [clip({ start: SECOND })])]));
    await graph.prepare(project([track("A1", [clip({ start: 2 * SECOND })])]));

    expect(decode).toHaveBeenCalledOnce();
  });

  it("decodes again once the clip reads a different part of the medium", async () => {
    const ctx = context(0.3);
    const source = dc(ctx);
    const decode = vi.spyOn(source, "bufferFor");
    const graph = new AudioGraph(ctx, source);

    await graph.prepare(project([track("A1", [clip()])]));
    await graph.prepare(project([track("A1", [clip({ inPoint: SECOND })])]));

    expect(decode).toHaveBeenCalledTimes(2);
  });

  // A medium that was missing and has been relinked has to be tried again, so the failure must
  // not settle into the cache as an answer.
  it("tries a medium again after a failed decode", async () => {
    const ctx = context(0.3);
    const good = dc(ctx);
    let calls = 0;
    const source: AudioBufferSource = {
      async bufferFor(hash, from, to) {
        calls += 1;
        if (calls === 1) throw new Error("error.mediaMissing");
        return good.bufferFor(hash, from, to);
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const graph = new AudioGraph(ctx, source);

    await graph.prepare(project([track("A1", [clip()])]));
    await graph.prepare(project([track("A1", [clip()])]));
    graph.startAt(ctx.currentTime, 0);

    expect(at(await drain(ctx), 0.1)).toBeCloseTo(1, 2);
  });
});

// A reversed clip used to be dropped from the graph entirely, so the picture ran backwards over
// silence. The signal is a ramp, which makes the direction of travel readable in a single sample.
const ramp = (ctx: BaseAudioContext): AudioBufferSource => signal(ctx, (progress) => progress);

describe("AudioGraph, reversed clips", () => {
  it("plays a reversed clip backwards through its range", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      ramp(ctx),
      project([track("A1", [clip({ speed: { rate: 1, reverse: true, preservePitch: true } })])]),
    );

    expect(at(out, 0.25)).toBeCloseTo(0.75, 2);
    expect(at(out, 0.75)).toBeCloseTo(0.25, 2);
  });

  // The two axes the review found crossing nowhere: direction and entry offset.
  it("enters a reversed clip in the middle at the position the timeline says", async () => {
    const ctx = context(0.5);
    const out = await render(ctx, ramp(ctx), project([track("A1", [clip({ speed: { rate: 1, reverse: true, preservePitch: true } })])]), {
      projectTime: SECOND / 2,
      contextTime: 0,
    });

    expect(at(out, 0)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.25)).toBeCloseTo(0.25, 2);
  });

  it("counts a reversed clip's source from its out point at a rate other than one", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      ramp(ctx),
      project([track("A1", [clip({ speed: { rate: 2, reverse: true, preservePitch: true } })])]),
    );

    expect(at(out, 0.25)).toBeCloseTo(0.75, 2);
    expect(at(out, 0.75)).toBeCloseTo(0.25, 2);
  });

  it("fades a reversed clip in over the head it actually plays", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          clip({
            speed: { rate: 1, reverse: true, preservePitch: true },
            fades: { inDuration: SECOND / 2, outDuration: 0 },
          }),
        ]),
      ]),
    );

    expect(at(out, 0.25)).toBeCloseTo(0.5, 2);
    expect(at(out, 0.75)).toBeCloseTo(1, 2);
  });

  // Export shares this predicate with the graph, so a reversed clip that the graph now schedules
  // must not be one the export leaves out of its audio track.
  it("counts a reversed clip as audible", () => {
    expect(
      hasAudibleClips(
        project([track("A1", [clip({ speed: { rate: 1, reverse: true, preservePitch: true } })])]),
      ),
    ).toBe(true);
  });
});

// The graph already holds the decoded samples for every clip it schedules, so the timeline's strip
// costs no second decode and no second cache. Anything else would decode the same range twice.
describe("AudioGraph, waveform peaks", () => {
  it("reads peaks from the buffer it already decoded", async () => {
    const ctx = context(0.3);
    const graph = new AudioGraph(ctx, signal(ctx, (progress) => progress));
    await graph.prepare(project([track("A1", [clip()])]));

    const found = graph.waveforms(4).get("clp_1");

    expect(found?.max[0]).toBeCloseTo(0.25, 2);
    expect(found?.max[3]).toBeCloseTo(1, 2);
  });

  it("shows a reversed clip the way it plays", async () => {
    const ctx = context(0.3);
    const graph = new AudioGraph(ctx, signal(ctx, (progress) => progress));
    await graph.prepare(
      project([track("A1", [clip({ speed: { rate: 1, reverse: true, preservePitch: true } })])]),
    );

    const found = graph.waveforms(4).get("clp_1");

    expect(found?.max[0]).toBeCloseTo(1, 2);
    expect(found?.max[3]).toBeCloseTo(0.25, 2);
  });

  it("has nothing to show for a clip it never scheduled", async () => {
    const ctx = context(0.3);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(project([track("A1", [clip()])]));

    expect(graph.waveforms(4).get("clp_missing")).toBeUndefined();
  });

  it("does not decode a second time to draw a strip", async () => {
    const ctx = context(0.3);
    const source = dc(ctx);
    const decode = vi.spyOn(source, "bufferFor");
    const graph = new AudioGraph(ctx, source);
    await graph.prepare(project([track("A1", [clip()])]));

    graph.waveforms(8);
    graph.waveforms(16);

    expect(decode).toHaveBeenCalledOnce();
  });
});

// The taps are in the signal path, so an offline render leaves each of them holding the last window
// that went through it -- which is a real reading of real samples, taken through the same
// AnalyserNode a browser drives at sixty frames a second. What cannot be checked here is the
// *running* of it: an offline render has no wall clock and no output device, so "the bar moves while
// the transport rolls" is left to the eye.
describe("AudioGraph, bus levels", () => {
  it("has a master reading and nothing else before anything is scheduled", () => {
    const ctx = context(0.1);
    const graph = new AudioGraph(ctx, dc(ctx));

    expect([...graph.levels().keys()]).toEqual([MASTER_METER]);
    expect(graph.levels().get(MASTER_METER)).toEqual(SILENT_LEVEL);
  });

  it("reads the level the master is actually putting out", async () => {
    const ctx = context(0.5);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(project([track("A1", [clip({ volume: 0.5 })])]));
    graph.startAt(0, 0);
    await drain(ctx);

    const level = graph.levels().get(MASTER_METER);

    // Direct current at half scale: peak and effective value are the same number, and that number
    // is the clip gain rather than the material's own full scale.
    expect(level?.peak).toBeCloseTo(-6.02, 1);
    expect(level?.rms).toBeCloseTo(-6.02, 1);
  });

  // The tap sits after the track's fader and its pan, which is what a strip's meter is asked about.
  // Two tracks at two gains is what tells a per-track meter from a copy of the master's.
  it("gives every track its own reading", async () => {
    const ctx = context(0.5);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(
      project([
        track("A1", [clip({ volume: 1 })], { volume: 0.5 }),
        track("A2", [clip({ id: "clp_2", volume: 1 })], { volume: 0.25 }),
      ]),
    );
    graph.startAt(0, 0);
    await drain(ctx);
    const levels = graph.levels();

    expect(levels.get("A1")?.peak).toBeCloseTo(-6.02, 1);
    expect(levels.get("A2")?.peak).toBeCloseTo(-12.04, 1);
    // Both tracks land on the master, so it reads louder than either of them alone.
    expect(levels.get(MASTER_METER)?.peak).toBeCloseTo(-2.5, 1);
  });

  // Mute and solo live on the bus gain, ahead of the tap, so a silenced track has to read silent --
  // a meter that still swung on a muted strip would be reading the clips instead of the bus.
  it("reads a muted track as silent while the master still has the other one", async () => {
    const ctx = context(0.5);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(
      project([
        track("A1", [clip()], { muted: true }),
        track("A2", [clip({ id: "clp_2", volume: 0.5 })]),
      ]),
    );
    graph.startAt(0, 0);
    await drain(ctx);
    const levels = graph.levels();

    expect(levels.get("A1")?.peak).toBe(Number.NEGATIVE_INFINITY);
    expect(levels.get("A2")?.peak).toBeCloseTo(-6.02, 1);
  });

  // The two axes crossing: a meter and a fade. At the end of a fade-out the bar has to be down with
  // it, because the fade is automation on the gain the tap sits behind.
  it("follows a fade down", async () => {
    const ctx = context(1);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(
      project([track("A1", [clip({ fades: { inDuration: 0, outDuration: SECOND } })])]),
    );
    graph.startAt(0, 0);
    await drain(ctx);

    // The window is 2048 frames, which at 48 kHz is the last 42.7 ms of the fade -- so the loudest
    // sample left in it is the gain the ramp had 42.7 ms from the end, 0.0427, and that is
    // -27.4 dBFS. Spelled out because "quiet" would pass for a meter reading the wrong bus.
    expect(graph.levels().get(MASTER_METER)?.peak).toBeCloseTo(-27.4, 1);
  });

  it("reads silent once the transport has stopped", async () => {
    const ctx = context(0.5);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(project([track("A1", [clip()])]));
    graph.startAt(0, 0);
    await drain(ctx);
    graph.stop();

    expect(graph.levels().get(MASTER_METER)).toEqual(SILENT_LEVEL);
  });

  // A strip the mixer no longer draws must not keep reporting, or a deleted track leaves a bar
  // swinging next to the ones that are still there.
  it("forgets a track the project no longer has", async () => {
    const ctx = context(0.5);
    const graph = new AudioGraph(ctx, dc(ctx));
    await graph.prepare(project([track("A1", [clip()]), track("A2", [clip({ id: "clp_2" })])]));
    graph.startAt(0, 0);
    await graph.prepare(project([track("A1", [clip()])]));

    expect([...graph.levels().keys()].sort()).toEqual(["A1", MASTER_METER]);
  });

  // The tap is in the line, not beside it, so this is the assertion that it stays a tap: an
  // AnalyserNode that coloured what passed through would move every other number in this file.
  it("passes the signal through unchanged", async () => {
    const ctx = context(0.5);
    const out = await render(ctx, dc(ctx), project([track("A1", [clip({ volume: 0.375 })])]));

    expect(at(out, 0.25)).toBe(0.375);
  });
});

// R128 loudness of the programme, not of the material: the number has to move when a fader does, or
// it is measuring the wrong thing. Read from a real offline render of the real graph.
describe("measureLoudness", () => {
  // A full-scale 1 kHz sine through a graph at unity reads the same as the same sine handed straight
  // to the meter, which is the only way to know the graph is not quietly changing the level.
  const tone = (ctx: BaseAudioContext): AudioBufferSource =>
    signal(ctx, (progress) => Math.sin(2 * Math.PI * 1000 * progress));

  it("measures a project at unity gain as the material's own loudness", async () => {
    const ctx = context(1);
    const measured = await measureLoudness(
      ctx as unknown as OfflineAudioContext,
      project([track("A1", [clip()])]),
      tone(ctx),
    );

    const material = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < material.length; i += 1) {
      material[i] = Math.sin(2 * Math.PI * 1000 * (i / material.length));
    }
    // The same samples handed straight to the meter. A graph that changes the level anywhere along
    // clip gain, bus, panner or master shows up here as a difference.
    expect(measured).toBeCloseTo(integratedLufs([material, material], SAMPLE_RATE), 1);
    // And full scale at 1 kHz is 0 LUFS, which ties this to the compliance cases next door.
    expect(measured).toBeCloseTo(0, 1);
  });

  it("follows the track fader", async () => {
    const ctx = context(1);
    const quiet = await measureLoudness(
      ctx as unknown as OfflineAudioContext,
      project([track("A1", [clip()], { volume: 0.5 })]),
      tone(ctx),
    );
    const loudCtx = context(1);
    const loud = await measureLoudness(
      loudCtx as unknown as OfflineAudioContext,
      project([track("A1", [clip()])]),
      tone(loudCtx),
    );

    expect(loud - quiet).toBeCloseTo(6.02, 1);
  });

  it("follows the master fader", async () => {
    const ctx = context(1);
    const measured = await measureLoudness(
      ctx as unknown as OfflineAudioContext,
      project([track("A1", [clip()])], 0.5),
      tone(ctx),
    );
    const fullCtx = context(1);
    const full = await measureLoudness(
      fullCtx as unknown as OfflineAudioContext,
      project([track("A1", [clip()])]),
      tone(fullCtx),
    );

    expect(full - measured).toBeCloseTo(6.02, 1);
  });

  it("has no reading for a muted project", async () => {
    const ctx = context(1);
    const measured = await measureLoudness(
      ctx as unknown as OfflineAudioContext,
      project([track("A1", [clip()], { muted: true })]),
      tone(ctx),
    );

    expect(measured).toBe(Number.NEGATIVE_INFINITY);
  });

  // The fades are automation on the clip gain, so they are in the render and therefore in the number.
  it("counts a fade as the quieter programme it makes", async () => {
    const ctx = context(1);
    const faded = await measureLoudness(
      ctx as unknown as OfflineAudioContext,
      project([track("A1", [clip({ fades: { inDuration: SECOND / 2, outDuration: 0 } })])]),
      tone(ctx),
    );
    const flatCtx = context(1);
    const flat = await measureLoudness(
      flatCtx as unknown as OfflineAudioContext,
      project([track("A1", [clip()])]),
      tone(flatCtx),
    );

    expect(faded).toBeLessThan(flat);
  });
});

// A nested clip has to be heard, and heard in the same place. The comparison is against the render
// of the same clips before they were folded, sample for sample -- "the compound produced a voice"
// would pass with the sound an octave off.
function compound(over: Partial<Clip>, tracks: Track[]): Clip {
  return clip({ source: { kind: "compound", timeline: { tracks } }, ...over } as Partial<Clip>);
}

describe("a compound clip in the audio graph", () => {
  // The trim inside a compound moves the nested clip's in point, and the fake source above cannot
  // see that: it shapes its buffer across whatever range it is handed, so every range comes back
  // looking the same. This one reports the absolute source position instead, which is the only way
  // a cut taken off the wrong end shows up as a different sound.
  function positionSignal(ctx: BaseAudioContext, span: Time): AudioBufferSource {
    return {
      async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
        const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
        const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
        const data = new Float32Array(frames);
        for (let i = 0; i < frames; i += 1) data[i] = (from + ((to - from) * i) / frames) / span;
        buffer.copyToChannel(data, 0);
        buffer.copyToChannel(data, 1);
        return buffer;
      },
    };
  }

  const inner = [
    clip({ id: "clp_a", start: 0, duration: SECOND, volume: 0.5 }),
    clip({ id: "clp_b", start: SECOND, duration: SECOND, fades: { inDuration: SECOND / 2, outDuration: 0 } }),
  ];

  it("sounds exactly like the same clips before they were folded", async () => {
    const flatCtx = context(2);
    const flat = await render(flatCtx, dc(flatCtx), project([track("A1", inner)]));
    const nestedCtx = context(2);
    const nested = await render(
      nestedCtx,
      dc(nestedCtx),
      project([
        track("A1", [compound({ id: "clp_group", start: 0, duration: 2 * SECOND }, [track("A_in", inner)])]),
      ]),
    );

    expect(Array.from(nested)).toEqual(Array.from(flat));
  });

  it("multiplies its own gain into what is inside it", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          compound({ id: "clp_group", start: 0, duration: SECOND, volume: 0.5 }, [
            track("A_in", [clip({ volume: 0.5 })]),
          ]),
        ]),
      ]),
    );

    expect(at(out, 0.5)).toBeCloseTo(0.25, 2);
  });

  // Not "there is still sound", and not "it stops in time" either: a fold that dropped the rate
  // would get both of those right and read the wrong second of material while doing it. What is
  // measured is where in the material the playhead actually is, half a second in.
  it("plays what is inside it at its own rate", async () => {
    const ctx = context(2);
    const doubled = project([
      track("A1", [
        compound(
          {
            id: "clp_group",
            start: 0,
            duration: SECOND,
            speed: { rate: 2, reverse: false, preservePitch: true },
          },
          [track("A_in", [clip({ start: 0, duration: 2 * SECOND })])],
        ),
      ]),
    ]);
    const out = await render(ctx, positionSignal(ctx, 2 * SECOND), doubled);

    // Half a second of timeline into a compound at double speed is one second of material, which
    // is halfway through a two-second clip.
    expect(at(out, 0.5)).toBeCloseTo(0.5, 1);
    expect(at(out, 1.5)).toBeCloseTo(0, 2);
  });

  it("plays what is inside it backwards when it is itself reversed", async () => {
    const ctx = context(2);
    const out = await render(
      ctx,
      ramp(ctx),
      project([
        track("A1", [
          compound(
            {
              id: "clp_group",
              start: 0,
              duration: 2 * SECOND,
              speed: { rate: 1, reverse: true, preservePitch: true },
            },
            [track("A_in", [clip({ start: 0, duration: 2 * SECOND })])],
          ),
        ]),
      ]),
    );

    expect(at(out, 0.1)).toBeGreaterThan(0.9);
    expect(at(out, 1.9)).toBeLessThan(0.1);
  });

  // The compound's own range decides how much of its timeline is heard: material past its out
  // point is material it does not consume.
  it("does not let a nested clip sound past its own end", async () => {
    const ctx = context(2);
    const out = await render(
      ctx,
      dc(ctx),
      project([
        track("A1", [
          compound({ id: "clp_group", start: 0, duration: SECOND }, [
            track("A_in", [clip({ start: 0, duration: 2 * SECOND })]),
          ]),
        ]),
      ]),
    );

    expect(at(out, 0.5)).toBeCloseTo(1, 2);
    expect(at(out, 1.5)).toBeCloseTo(0, 2);
  });

  function trimmedCompound(over: Partial<Clip> = {}): Project {
    const nested = { ...clip(), start: 0, duration: 2 * SECOND, ...over } as Clip;
    return project([
      track("A1", [
        compound({ id: "clp_group", start: 0, duration: SECOND, inPoint: SECOND }, [
          track("A_in", [nested]),
        ]),
      ]),
    ]);
  }

  it("reads the second half of a nested clip when its own in point sits there", async () => {
    const ctx = context(1);
    const out = await render(ctx, positionSignal(ctx, 2 * SECOND), trimmedCompound({}));

    expect(at(out, 0.05)).toBeCloseTo(0.5, 1);
    expect(at(out, 0.95)).toBeCloseTo(1, 1);
  });

  // A reversed clip pays a trim out of the other end of its source range, so the same window over
  // it reads the *first* half -- backwards.
  it("takes the cut off the other end when the nested clip is reversed", async () => {
    const ctx = context(1);
    const out = await render(
      ctx,
      positionSignal(ctx, 2 * SECOND),
      trimmedCompound({ speed: { rate: 1, reverse: true, preservePitch: true } }),
    );

    expect(at(out, 0.05)).toBeCloseTo(0.5, 1);
    expect(at(out, 0.95)).toBeCloseTo(0, 1);
  });

  it("counts a nested clip as something to export a sound track for", () => {
    const nested = project([
      track("A1", [
        compound({ id: "clp_group", start: 0, duration: SECOND }, [track("A_in", [clip()])]),
      ]),
    ]);

    expect(hasAudibleClips(nested)).toBe(true);
  });
});

// The signal is a ramp, so a sample says which source position is being read -- the audio equivalent
// of the pixel harness's one-colour-per-frame video. That is what lets these runs assert the sound
// follows the *same* integral the picture does rather than merely that it moves.
//
// A speed change that moved the picture and left the sound behind would be a half-feature, so every
// expectation below is computed from `consumedBetween` in the core rather than written out: if the
// two ever part company, these fail without anyone having to guess the new number.
describe("AudioGraph, speed ramps", () => {
  const ramped = (keys: [number, number, Interp][], reverse = false): Clip =>
    clip({
      duration: 2 * SECOND,
      speed: { rate: 1, reverse, preservePitch: true },
      keyframes: {
        speed: keys.map(([seconds, rate, interp]) => ({
          time: Math.round(seconds * SECOND),
          value: { kind: "float", value: rate },
          interp,
          handleIn: null,
          handleOut: null,
        })),
      },
    });

  // Where the buffer's own ramp stands when the clip has spent `consumed` of its range.
  const expected = (subject: Clip, seconds: number): number => {
    const spent = consumedBetween(subject, subject.start, Math.round(seconds * SECOND));
    const whole = consumedSource(subject);
    return subject.speed.reverse ? (whole - spent) / whole : spent / whole;
  };

  it("reads its source by the area under the rate, not by the rate", async () => {
    const subject = ramped([
      [0, 0.5, "linear"],
      [2, 2, "linear"],
    ]);
    const ctx = context(2);
    const out = await render(ctx, ramp(ctx), project([track("A1", [subject])]));

    // Halfway through, a proportional reading would be at 0.5 of the range; the integral puts it at
    // 0.35. The gap is what the whole of this feature is.
    expect(expected(subject, 1)).toBeCloseTo(0.35, 3);
    for (const seconds of [0.25, 0.5, 1, 1.5, 1.75]) {
      expect(at(out, seconds)).toBeCloseTo(expected(subject, seconds), 2);
    }
  });

  // The two axes crossing: a ramp *and* backwards. The head opens on the far end of a range whose
  // size the ramp itself decided, and the sound has to walk back through it at the ramp's own pace.
  it("runs a ramp backwards over the range the ramp itself sized", async () => {
    const subject = ramped(
      [
        [0, 0.5, "linear"],
        [2, 2, "linear"],
      ],
      true,
    );
    const ctx = context(2);
    const out = await render(ctx, ramp(ctx), project([track("A1", [subject])]));

    expect(at(out, 0.02)).toBeGreaterThan(0.97);
    for (const seconds of [0.25, 0.5, 1, 1.5, 1.75]) {
      expect(at(out, seconds)).toBeCloseTo(expected(subject, seconds), 2);
    }
  });

  // A frame hold is a rate of zero, and the sound has to stand still with the picture rather than
  // carry on underneath it.
  it("stands still where the rate reads zero", async () => {
    const subject = ramped([
      [0, 1, "hold"],
      [1, 0, "hold"],
    ]);
    const ctx = context(2);
    const out = await render(ctx, ramp(ctx), project([track("A1", [subject])]));

    expect(consumedSource(subject)).toBe(SECOND);
    for (const seconds of [1.2, 1.5, 1.9]) {
      expect(at(out, seconds)).toBeCloseTo(at(out, 1.05), 2);
    }
  });

  // Entering mid-ramp is the seam the offset arithmetic lives on: the buffer offset is no longer a
  // rate times a span, so a transport started in the middle would open at the wrong sample.
  it("enters a ramp in the middle at the source position the timeline says", async () => {
    const subject = ramped([
      [0, 0.5, "linear"],
      [2, 2, "linear"],
    ]);
    const ctx = context(1);
    const out = await render(ctx, ramp(ctx), project([track("A1", [subject])]), {
      projectTime: SECOND,
      contextTime: 0,
    });

    expect(out[0]).toBeCloseTo(expected(subject, 1), 2);
    for (const seconds of [0.25, 0.5, 0.75]) {
      expect(at(out, seconds)).toBeCloseTo(expected(subject, 1 + seconds), 2);
    }
  });

  // The decoded range is the ramp's own doing now. Too short a buffer would end the clip in silence
  // partway through, which no other assertion here would notice.
  it("decodes the whole range the ramp consumes", async () => {
    const subject = ramped([
      [0, 2, "linear"],
      [2, 2, "linear"],
    ]);
    const ctx = context(2);
    const out = await render(ctx, dc(ctx), project([track("A1", [subject])]));

    expect(consumedSource(subject)).toBe(4 * SECOND);
    expect(at(out, 1.98)).toBeCloseTo(1, 2);
  });
});

// Noise reduction is not a node: it rewrites the samples where the graph loads them. What the graph
// can be asked about those samples is `waveforms`, and it is drawn from the very buffers playback uses
// -- so the strips the timeline shows are the measurement, and a picture that disagreed with what is
// heard would be this check failing rather than something nobody notices.
// The same flag the renderer reads. A clip that was silent in the picture and audible in the mix would
// be the worst of both answers, so the audio graph schedules no voice for one that is switched off.
describe("a clip that is switched off", () => {
  it("is not heard, and its neighbours still are", async () => {
    const ctx = context(2);
    const out = await render(
      ctx,
      signal(ctx, () => 1),
      project([
        track("trk_0", [
          clip({ id: "clp_off", start: 0, duration: SECOND / 2, enabled: false } as Partial<Clip>),
          clip({ id: "clp_on", start: SECOND / 2, duration: SECOND / 2 }),
        ]),
      ]),
    );

    expect(Math.abs(at(out, 0.25))).toBeCloseTo(0, 3);
    expect(Math.abs(at(out, 0.75))).toBeCloseTo(1, 2);
  });
});

// How hard a compressor is working is the one number about it that cannot be derived from its settings:
// it depends on what is going through it. Read from the node, so this is a measurement rather than a
// second implementation of the compressor's own curve.
describe("what a compressor reports", () => {
  const squashing = (threshold: number): Effect[] =>
    [
      {
        id: "eff_comp",
        effectType: "compressor",
        enabled: true,
        params: {
          threshold: { kind: "float", value: threshold },
          ratio: { kind: "float", value: 20 },
          attack: { kind: "float", value: 0 },
          release: { kind: "float", value: 0.25 },
        },
        keyframes: {},
      },
    ] as unknown as Effect[];

  async function rolling(effects: Effect[], level: number): Promise<AudioGraph> {
    const ctx = context(1);
    const graph = new AudioGraph(ctx, signal(ctx, () => level));
    await graph.prepare(project([track("trk_0", [clip()], { effects })]));
    graph.startAt(ctx.currentTime, 0);
    await drain(ctx);
    return graph;
  }

  it("reports a reduction while it is working on a loud signal", async () => {
    const graph = await rolling(squashing(-40), 1);

    const reduction = graph.reductions().get("eff_comp");
    expect(reduction).toBeDefined();
    // Negative decibels: the node reports how much gain it is taking away, and a full-scale signal
    // against a threshold of -40 with a ratio of 20 is taking a lot.
    expect(reduction!).toBeLessThan(-1);
  });

  it("reports nothing once nothing is scheduled", async () => {
    const graph = await rolling(squashing(-40), 1);
    graph.stop();

    // The same rule the level meters follow: a meter left standing at the last value it saw would be
    // reporting a compressor working on sound that stopped.
    expect(graph.reductions().size).toBe(0);
  });

  it("has nothing to report for a track with no compressor on it", async () => {
    const graph = await rolling([], 1);

    expect(graph.reductions().size).toBe(0);
  });
});

describe("an offline effect on a clip", () => {
  // Hiss, deterministic, so there is something to take away and something to measure.
  const hiss: AudioBufferSource = {
    async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
      const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
      const buffer = context(1).createBuffer(1, frames, SAMPLE_RATE);
      const data = new Float32Array(frames);
      let seed = 5;
      for (let i = 0; i < frames; i += 1) {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        data[i] = (seed / 0xffffffff) * 0.2 - 0.1;
      }
      buffer.copyToChannel(data, 0);
      return buffer;
    },
  };

  const denoise = (over: Record<string, unknown> = {}): Effect[] =>
    [{ id: "eff_1", effectType: "denoise", enabled: true, params: {}, keyframes: {}, ...over }] as
      unknown as Effect[];

  // The loudest bucket of the strip: hiss is even, so this is how much of it is left.
  const loudest = (graph: AudioGraph): number => {
    const strip = graph.waveforms(64).get("clp_1");
    return Math.max(...(strip?.max ?? [0]));
  };

  async function prepared(effects: Effect[]): Promise<AudioGraph> {
    const graph = new AudioGraph(context(3), hiss);
    await graph.prepare(project([track("trk_0", [clip({ duration: 2 * SECOND, effects })])]));
    return graph;
  }

  it("takes the noise out of the samples the graph plays", async () => {
    const untouched = loudest(await prepared([]));

    const cleaned = loudest(await prepared(denoise()));

    expect(untouched).toBeGreaterThan(0.05);
    expect(cleaned).toBeGreaterThan(0);
    expect(cleaned).toBeLessThan(untouched * 0.7);
  });

  it("leaves the samples alone when it is switched off", async () => {
    const plain = loudest(await prepared([]));

    const bypassed = loudest(await prepared(denoise({ enabled: false })));

    expect(bypassed).toBeCloseTo(plain, 6);
  });

  // An effect type the offline roster does not know is not an offline effect: the video registry and
  // the node-based audio one both carry types this has to leave to them.
  it("ignores an effect that is not one of its own", async () => {
    const plain = loudest(await prepared([]));

    const graded = loudest(
      await prepared([
        { id: "eff_1", effectType: "brightness", enabled: true, params: {}, keyframes: {} },
      ] as unknown as Effect[]),
    );

    expect(graded).toBeCloseTo(plain, 6);
  });

  // The analysis is the expensive half, so preparing the same project twice must not do it twice --
  // and a change of setting must, because the samples are then different samples.
  it("analyses once per setting rather than once per prepare", async () => {
    const graph = new AudioGraph(context(3), hiss);
    const withAmount = (amount: number): Effect[] =>
      denoise({ params: { amount: { kind: "float", value: amount } } });
    const build = (effects: Effect[]): Project =>
      project([track("trk_0", [clip({ duration: 2 * SECOND, effects })])]);

    await graph.prepare(build(withAmount(1.5)));
    const first = loudest(graph);
    await graph.prepare(build(withAmount(1.5)));
    expect(loudest(graph)).toBe(first);

    await graph.prepare(build(withAmount(4)));
    expect(loudest(graph)).toBeLessThan(first);
  });
});
