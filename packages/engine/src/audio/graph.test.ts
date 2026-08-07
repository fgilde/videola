import { timeToSeconds } from "@videola/core";
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";

import type { Clip, MediaAsset, Project, Time, Track } from "@videola/core";

import { AudioGraph } from "./graph";
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

async function render(
  ctx: BaseAudioContext,
  source: AudioBufferSource,
  built: Project,
  projectTime: Time = 0,
  before: (graph: AudioGraph) => void = () => {},
): Promise<Float32Array> {
  const graph = new AudioGraph(ctx, source);
  await graph.prepare(built);
  before(graph);
  graph.startAt(ctx.currentTime, projectTime);
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
    const out = await render(ctx, dc(ctx), project([track("A1", [clip()])]), 0, (graph) =>
      graph.setMasterVolume(0.25),
    );

    expect(at(out, 0.9)).toBeCloseTo(0.25, 2);
  });

  it("starts a clip that is already running at the matching sample", async () => {
    const ctx = context(0.5);
    const out = await render(
      ctx,
      signal(ctx, (progress) => progress),
      project([track("A1", [clip()])]),
      SECOND / 2,
    );

    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(at(out, 0.25)).toBeCloseTo(0.75, 2);
  });

  it("stays silent for a clip that ended before the start point", async () => {
    const ctx = context(0.5);
    const out = await render(ctx, dc(ctx), project([track("A1", [clip()])]), 2 * SECOND);

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
    const rendered = await (ctx as unknown as OfflineAudioContext).startRendering();

    expect(Math.max(...(rendered.getChannelData(0) as unknown as Float32Array))).toBe(0);
  });
});
