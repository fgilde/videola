import { timeToSeconds } from "@videola/core";
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";

import type {
  Clip,
  Effect,
  EffectParams,
  MediaAsset,
  Project,
  Time,
  Track,
} from "@videola/core";

import { DEFAULT_DUCK, duckCommands, duckCorners, speechSpans } from "./ducking";
import { AudioGraph } from "./graph";
import type { AudioBufferSource } from "./graph";

const SAMPLE_RATE = 48_000;
const SECOND = 705_600_000;
const MUSIC = `med_${"a".repeat(64)}`;
const VOICE = `med_${"b".repeat(64)}`;

const context = (seconds: number): BaseAudioContext =>
  new OfflineAudioContext(
    2,
    Math.round(seconds * SAMPLE_RATE),
    SAMPLE_RATE,
  ) as unknown as BaseAudioContext;

// Two signals under one source, told apart by the hash the graph asks for -- which is what makes
// this a real two-track check rather than one buffer played twice. A steady tone stands in for the
// bed and a burst for the voice, exactly as the brief describes.
function twoSignals(
  ctx: BaseAudioContext,
  shapes: Record<string, (seconds: number) => number>,
): AudioBufferSource {
  return {
    async bufferFor(hash: string, from: Time, to: Time): Promise<AudioBuffer> {
      const shape = Object.entries(shapes).find(([media]) => hash.includes(media.slice(4, 12)))?.[1];
      const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
      const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) data[i] = shape?.(i / SAMPLE_RATE) ?? 0;
      buffer.copyToChannel(data, 0);
      buffer.copyToChannel(data, 1);
      return buffer;
    },
  };
}

const tone = (seconds: number): number => Math.sin(2 * Math.PI * 220 * seconds);
const burst =
  (from: number, to: number) =>
  (seconds: number): number =>
    seconds >= from && seconds < to ? Math.sin(2 * Math.PI * 1000 * seconds) : 0;

function clip(id: string, media: string, over: Partial<Clip> = {}): Clip {
  return {
    id,
    source: { kind: "media", media },
    start: 0,
    duration: 6 * SECOND,
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

function track(id: string, clips: Clip[], effects: Effect[] = []): Track {
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
    effects,
  } as unknown as Track;
}

const asset = (id: string): MediaAsset =>
  ({
    id,
    originalName: "a.wav",
    mime: "audio/wav",
    kind: "audio",
    sizeBytes: 1n,
    duration: 60 * SECOND,
    width: null,
    height: null,
    fps: null,
    sampleRate: SAMPLE_RATE,
    channels: 2,
  }) as MediaAsset;

function project(tracks: Track[]): Project {
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
    library: [asset(MUSIC), asset(VOICE)],
    timeline: { tracks },
    markers: [],
    master: { volume: 1, effects: [] },
  } as unknown as Project;
}

// The insert as the core would have written it after `effect.add` plus the keyframes the duck asks
// for. Built from `duckCorners` rather than typed out, so the graph is fed the same curve the
// commands would have produced.
function duckInsert(corners: readonly { at: Time; value: number }[]): Effect {
  return {
    id: "eff_duck",
    effectType: "gain",
    enabled: true,
    params: { gain: { kind: "float", value: 1 } },
    keyframes: {
      gain: corners.map((corner) => ({
        time: corner.at,
        value: { kind: "float", value: corner.value },
        interp: "linear",
        handleIn: null,
        handleOut: null,
      })),
    },
  } as unknown as Effect;
}

// How much of the bed's own 220 Hz a window of the mix holds, by Goertzel -- the same filter the
// export harness runs over a decoded file. Root mean square would not do here: the voice is in the
// same mix and in the same window, and the whole question is what happened to the *music* while it
// was. Returned as an amplitude, so a bed at half gain reads half.
function bedLevel(samples: Float32Array, from: number, to: number): number {
  const start = Math.round(from * SAMPLE_RATE);
  const end = Math.round(to * SAMPLE_RATE);
  const w = (2 * Math.PI * 220) / SAMPLE_RATE;
  const c = 2 * Math.cos(w);
  let first = 0;
  let second = 0;
  for (let i = start; i < end; i += 1) {
    const next = samples[i]! + c * first - second;
    second = first;
    first = next;
  }
  const power = (first * first + second * second - c * first * second) / (end - start);
  return Math.sqrt(power) / Math.sqrt((end - start) / 4);
}

// Stands in for the core, and only for its arithmetic: the graph decides *when* to ask and the core
// decides what the answer is, so a duck's shape is a straight line between its own corners. What
// the real core answers is proven against the Rust build in packages/core/src/roundtrip.test.ts.
function resolver(insert: Effect): EffectParams {
  const corners = insert.keyframes.gain ?? [];
  return (at) => {
    if (corners.length === 0) return new Map();
    const value = (index: number): number =>
      (corners[index]!.value as { value: number }).value;
    let resolved = value(0);
    for (let index = 1; index < corners.length; index += 1) {
      const previous = corners[index - 1]!;
      const corner = corners[index]!;
      if (at >= corner.time) {
        resolved = value(index);
        continue;
      }
      if (at < previous.time) break;
      const span = corner.time - previous.time;
      resolved =
        value(index - 1) + ((value(index) - value(index - 1)) * (at - previous.time)) / span;
      break;
    }
    return new Map([[insert.id, new Map([["gain", { kind: "float", value: resolved }]])]]);
  };
}

async function render(
  ctx: BaseAudioContext,
  built: Project,
  insert?: Effect,
): Promise<Float32Array> {
  const graph = new AudioGraph(
    ctx,
    twoSignals(ctx, { [MUSIC]: tone, [VOICE]: burst(2, 4) }),
    insert === undefined ? undefined : resolver(insert),
  );
  await graph.prepare(built);
  graph.startAt(0, 0);
  const rendered = await (ctx as unknown as OfflineAudioContext).startRendering();
  return rendered.getChannelData(0) as unknown as Float32Array;
}

// The measurement the brief asks for: a steady tone as the music, a burst as the speech, and the
// tone has to be measurably quieter while the burst is there. Nothing here is asserted against the
// curve -- it is asserted against the samples that came out of the graph.
describe("ducking, measured", () => {
  it("pulls the bed down while the voice is there and lets it back up after", async () => {
    const ctx = context(6);
    const spans = [{ from: 2 * SECOND, to: 4 * SECOND }];
    const insert = duckInsert(duckCorners(spans));
    const music = track("A1", [clip("clp_music", MUSIC)], [insert]);
    const out = await render(
      ctx,
      project([music, track("A2", [clip("clp_voice", VOICE)])]),
      insert,
    );

    const before = bedLevel(out, 0.5, 1.5);
    const during = bedLevel(out, 2.5, 3.5);
    const after = bedLevel(out, 4.8, 5.8);

    // The voice is loud in the middle window and the bed is what has to be down: half gain, and
    // all the way back up once the phrase is over.
    expect(during / before).toBeCloseTo(DEFAULT_DUCK.duck, 2);
    expect(after / before).toBeCloseTo(1, 2);
  });

  it("leaves the bed alone when the voice track is silent throughout", async () => {
    const ctx = context(6);
    const insert = duckInsert(duckCorners([]));
    const music = track("A1", [clip("clp_music", MUSIC)], [insert]);
    const out = await render(ctx, project([music]), insert);

    expect(bedLevel(out, 2.5, 3.5) / bedLevel(out, 0.5, 1.5)).toBeCloseTo(1, 3);
  });

  // The two axes crossing: a duck *and* a fade. The fade is on the clip gain and the duck is an
  // insert ahead of it, so the two multiply -- a duck that had been written onto the clip volume
  // would have fought the fade for the same number instead.
  it("multiplies with a fade rather than replacing it", async () => {
    const ctx = context(6);
    const spans = [{ from: 2 * SECOND, to: 4 * SECOND }];
    const faded = clip("clp_music", MUSIC, {
      fades: { inDuration: 6 * SECOND, outDuration: 0 },
    } as Partial<Clip>);
    const insert = duckInsert(duckCorners(spans));
    const music = track("A1", [faded], [insert]);
    const out = await render(
      ctx,
      project([music, track("A2", [clip("clp_voice", VOICE)])]),
      insert,
    );

    // A six-second fade-in stands at 0.5 halfway and 0.75 at four and a half seconds. The duck is
    // over by then, so the later window is the fade alone and the middle one is fade times duck.
    const plain = bedLevel(out, 4.9, 5.1);
    const ducked = bedLevel(out, 2.9, 3.1);

    expect(plain).toBeCloseTo(5 / 6, 2);
    expect(ducked).toBeCloseTo(0.5 * DEFAULT_DUCK.duck, 2);
  });

  // Where the fall is taken decides whether the first syllable is covered. The bed has to already
  // be on its way down when the voice opens, which is a whole quarter of a second earlier.
  it("has begun to fall before the voice starts", async () => {
    const ctx = context(6);
    const spans = [{ from: 2 * SECOND, to: 4 * SECOND }];
    const insert = duckInsert(duckCorners(spans));
    const music = track("A1", [clip("clp_music", MUSIC)], [insert]);
    const out = await render(ctx, project([music]), insert);

    // Halfway down the attack ramp, which begins 250 ms before the span does.
    expect(bedLevel(out, 1.85, 1.9) / bedLevel(out, 0.5, 1)).toBeCloseTo(0.75, 1);
  });
});

describe("speechSpans", () => {
  it("reads the whole track, not one clip", async () => {
    const ctx = context(12);
    const voice = track("A2", [
      clip("clp_a", VOICE),
      clip("clp_b", VOICE, { start: 6 * SECOND }),
    ]);
    const graph = new AudioGraph(ctx, twoSignals(ctx, { [VOICE]: burst(2, 4) }));
    await graph.prepare(project([voice]));

    const spans = speechSpans(voice, graph.waveforms(600));

    expect(spans).toHaveLength(2);
    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(1.9, 1);
    expect(timeToSeconds(spans[1]!.from)).toBeCloseTo(7.9, 1);
  });

  it("has nothing to say about a track whose clips were never decoded", () => {
    expect(speechSpans(track("A2", [clip("clp_a", VOICE)]), new Map())).toEqual([]);
  });
});

describe("duckCorners", () => {
  const span = (from: number, to: number): { from: Time; to: Time } => ({
    from: from * SECOND,
    to: to * SECOND,
  });
  const seconds = (corners: readonly { at: Time; value: number }[]): [number, number][] =>
    corners.map((corner) => [Math.round(timeToSeconds(corner.at) * 100) / 100, corner.value]);

  it("draws a trapezoid around one phrase", () => {
    expect(seconds(duckCorners([span(2, 4)]))).toEqual([
      [1.75, 1],
      [2, 0.5],
      [4, 0.5],
      [4.5, 1],
    ]);
  });

  it("has no corners at all where there is no speech", () => {
    expect(duckCorners([])).toEqual([]);
  });

  // Two sentences half a second apart: the release of the first would still be climbing when the
  // fall of the second began, so the bed stays down through the pause instead of bumping.
  it("holds the bed down between two phrases that are too close to recover between", () => {
    expect(seconds(duckCorners([span(2, 4), span(4.5, 6)]))).toEqual([
      [1.75, 1],
      [2, 0.5],
      [6, 0.5],
      [6.5, 1],
    ]);
  });

  it("lets the bed all the way back up between two phrases that are far apart", () => {
    expect(seconds(duckCorners([span(2, 3), span(10, 11)]))).toEqual([
      [1.75, 1],
      [2, 0.5],
      [3, 0.5],
      [3.5, 1],
      [9.75, 1],
      [10, 0.5],
      [11, 0.5],
      [11.5, 1],
    ]);
  });

  // A phrase at the very head of the timeline has nowhere to put its attack, and two keyframes at
  // one instant have no order between them -- so there is one, and it is the duck.
  it("puts a single corner at zero for speech that starts at the head", () => {
    expect(seconds(duckCorners([span(0, 2)]))).toEqual([
      [0, 0.5],
      [2, 0.5],
      [2.5, 1],
    ]);
  });
});

describe("duckCommands", () => {
  const music = (effects: Effect[] = []): Track => track("A1", [], effects);
  const spans = [{ from: 2 * SECOND, to: 4 * SECOND }];

  it("adds the insert first and then writes the curve onto it", () => {
    const commands = duckCommands(music(), spans);

    expect(commands[0]).toEqual({
      type: "effect.add",
      target: { kind: "track", track: "A1" },
      effectType: "gain",
    });
    expect(commands).toHaveLength(5);
    expect(commands[1]).toMatchObject({ type: "keyframe.add", effectType: "gain", key: "gain" });
  });

  it("does not add a second insert to a bus that already has one", () => {
    const commands = duckCommands(music([duckInsert([])]), spans);

    expect(commands.some((command) => command.type === "effect.add")).toBe(false);
  });

  // Ducking a second time against a re-cut voice track has to replace the curve. Leaving the old
  // corners would keep the bed down over a sentence that is no longer there.
  it("clears the corners of a previous duck before writing new ones", () => {
    const previous = duckInsert(duckCorners([{ from: 8 * SECOND, to: 9 * SECOND }]));

    const commands = duckCommands(music([previous]), spans);

    expect(commands.filter((command) => command.type === "keyframe.remove")).toHaveLength(4);
    expect(commands.filter((command) => command.type === "keyframe.add")).toHaveLength(4);
  });
});
