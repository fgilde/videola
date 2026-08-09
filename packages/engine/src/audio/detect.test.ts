import { timeToSeconds } from "@videola/core";
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";

import type { Clip, MediaAsset, Project, Time, Track } from "@videola/core";

import { DEFAULT_DETECT, gapsBetween, loudSpans, mergeSpans } from "./detect";
import { AudioGraph } from "./graph";
import type { AudioBufferSource } from "./graph";
import type { Span } from "./detect";

const SAMPLE_RATE = 48_000;
const SECOND = 705_600_000;
const MEDIA = `med_${"a".repeat(64)}`;

// Fine enough that a 25 ms bucket lands inside the shortest gap any of these signals has. The real
// caller picks the same way -- from the length of the clip it is about to read.
const BUCKETS = 400;

function context(seconds: number): BaseAudioContext {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * SAMPLE_RATE), SAMPLE_RATE);
  return ctx as unknown as BaseAudioContext;
}

// A real signal, decoded by the real graph and scanned by the real peak reader. Nothing below
// asserts against an array anyone typed: the buckets come from samples, and the moments come from
// the core's own mapping of the clip they sit in.
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

// A one kilohertz tone that sounds only inside the given windows, in seconds of source time.
const bursts =
  (...windows: readonly [number, number][]) =>
  (ctx: BaseAudioContext): AudioBufferSource =>
    signal(ctx, (seconds) =>
      windows.some(([from, to]) => seconds >= from && seconds < to)
        ? Math.sin(2 * Math.PI * 1000 * seconds)
        : 0,
    );

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

function project(clips: Clip[]): Project {
  const asset: MediaAsset = {
    id: MEDIA,
    originalName: "voice.wav",
    mime: "audio/wav",
    kind: "audio",
    sizeBytes: 1n,
    duration: 60 * SECOND,
    width: null,
    height: null,
    fps: null,
    sampleRate: SAMPLE_RATE,
    channels: 2,
  };
  const track: Track = {
    id: "A1",
    kind: "audio",
    name: "A1",
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
  } as unknown as Track;
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
    timeline: { tracks: [track] },
    markers: [],
    master: { volume: 1, effects: [] },
  } as unknown as Project;
}

// The whole path: decode, peak, detect. `render` is deliberately absent -- detection reads the same
// buckets the timeline draws, which is the point of doing it this way rather than off a second
// offline render.
async function detect(
  ctx: BaseAudioContext,
  source: AudioBufferSource,
  subject: Clip,
  options = DEFAULT_DETECT,
): Promise<Span[]> {
  const graph = new AudioGraph(ctx, source);
  await graph.prepare(project([subject]));
  const peaks = graph.waveforms(BUCKETS).get(subject.id)!;
  return loudSpans(peaks, subject, options);
}

const asSeconds = (spans: readonly Span[]): number[][] =>
  spans.map((span) => [timeToSeconds(span.from), timeToSeconds(span.to)]);

// No padding and no minimum, so the numbers below are the detector's own edges rather than edges
// plus a margin. The defaults get their own cases further down.
const RAW = { thresholdDb: -40, minGapSeconds: 0, minSpanSeconds: 0, padSeconds: 0 };

describe("loudSpans", () => {
  it("finds the one stretch that sounds and puts it where it is", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([1, 2])(ctx), clip(), RAW);

    expect(spans).toHaveLength(1);
    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(1, 1);
    expect(timeToSeconds(spans[0]!.to)).toBeCloseTo(2, 1);
  });

  it("finds two stretches with a gap between them", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([0.5, 1], [2, 3])(ctx), clip(), RAW);

    expect(asSeconds(spans).map((pair) => pair.map((v) => Math.round(v * 10) / 10))).toEqual([
      [0.5, 1],
      [2, 3],
    ]);
  });

  it("has nothing to report for a clip that never rises above the floor", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, signal(ctx, () => 0.001), clip(), RAW);

    expect(spans).toEqual([]);
  });

  it("reports a clip that sounds throughout as one span over the whole of it", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([0, 4])(ctx), clip(), RAW);

    expect(asSeconds(spans)[0]![0]).toBeCloseTo(0, 2);
    expect(asSeconds(spans)[0]![1]).toBeCloseTo(4, 2);
  });

  // A quiet passage is not silence: the threshold is what tells them apart, and moving it has to
  // move the answer. Same signal, two thresholds, two different readings.
  it("obeys the threshold", async () => {
    const ctx = context(4);
    const quiet = (c: BaseAudioContext): AudioBufferSource =>
      signal(c, (seconds) =>
        seconds >= 1 && seconds < 2 ? 0.02 * Math.sin(2 * Math.PI * 1000 * seconds) : 0,
      );

    expect(await detect(ctx, quiet(ctx), clip(), RAW)).toHaveLength(1);
    expect(
      await detect(ctx, quiet(ctx), clip(), { ...RAW, thresholdDb: -20 }),
    ).toEqual([]);
  });

  // Where the clip sits on the timeline is not where it starts in its own medium, and the spans are
  // project time -- a detector that returned clip-local times would cut the wrong place.
  it("reports in project time, not in clip time", async () => {
    const ctx = context(10);
    const spans = await detect(ctx, bursts([1, 2])(ctx), clip({ start: 5 * SECOND }), RAW);

    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(6, 1);
    expect(timeToSeconds(spans[0]!.to)).toBeCloseTo(7, 1);
  });
});

describe("loudSpans, tidying", () => {
  // Two words with a breath between them are one phrase. Without this a cut would fall inside a
  // sentence every time somebody drew breath.
  it("closes a gap shorter than the smallest one worth having", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([1, 1.4], [1.5, 2])(ctx), clip(), {
      ...RAW,
      minGapSeconds: 0.25,
    });

    expect(spans).toHaveLength(1);
    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(1, 1);
    expect(timeToSeconds(spans[0]!.to)).toBeCloseTo(2, 1);
  });

  it("leaves a gap longer than that alone", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([1, 1.4], [2, 2.5])(ctx), clip(), {
      ...RAW,
      minGapSeconds: 0.25,
    });

    expect(spans).toHaveLength(2);
  });

  it("drops a blip too short to be anything", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([1, 1.02], [2, 2.5])(ctx), clip(), {
      ...RAW,
      minSpanSeconds: 0.15,
    });

    expect(spans).toHaveLength(1);
    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(2, 1);
  });

  it("grows what is left at both ends", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([1, 2])(ctx), clip(), { ...RAW, padSeconds: 0.25 });

    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(0.75, 1);
    expect(timeToSeconds(spans[0]!.to)).toBeCloseTo(2.25, 1);
  });

  it("never grows a span past the clip that holds it", async () => {
    const ctx = context(4);
    const subject = clip();
    const spans = await detect(ctx, bursts([0, 4])(ctx), subject, { ...RAW, padSeconds: 1 });

    expect(spans[0]!.from).toBe(subject.start);
    expect(spans[0]!.to).toBe(subject.start + subject.duration);
  });

  it("merges two spans that padding pushed into each other", async () => {
    const ctx = context(4);
    const spans = await detect(ctx, bursts([1, 1.4], [2, 2.5])(ctx), clip(), {
      ...RAW,
      padSeconds: 0.4,
    });

    expect(spans).toHaveLength(1);
  });
});

// The two axes crossing that nothing else here would catch: detection *and* a clip that does not
// run forwards at one times speed. The buckets are laid out over the buffer, so both of these
// answer wrongly by exactly the amount the mapping is wrong by.
describe("loudSpans against a clip that is not playing straight", () => {
  it("puts a burst where a reversed clip actually plays it", async () => {
    const ctx = context(4);
    const spans = await detect(
      ctx,
      // In source time the tone is in the first second; played backwards it is heard in the last.
      bursts([0, 1])(ctx),
      clip({ speed: { rate: 1, reverse: true, preservePitch: true } }),
      RAW,
    );

    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(3, 1);
    expect(timeToSeconds(spans[0]!.to)).toBeCloseTo(4, 1);
  });

  // At double speed the clip consumes eight seconds of source over four of timeline, so a burst in
  // the source's third second is heard in the timeline's one-and-a-half.
  it("halves the moment for a clip running at double speed", async () => {
    const ctx = context(4);
    const spans = await detect(
      ctx,
      bursts([3, 4])(ctx),
      clip({ speed: { rate: 2, reverse: false, preservePitch: true } }),
      RAW,
    );

    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(1.5, 1);
    expect(timeToSeconds(spans[0]!.to)).toBeCloseTo(2, 1);
  });

  // A ramp is the case no division gets right. The rate rises linearly from 0.5 to 2 over four
  // seconds, so the clip spends five seconds of source in all and consumes 0.5t + 0.1875t² of it by
  // the moment t. A burst starting at source 2.5 -- exactly halfway through the buffer, and
  // therefore at bucket 200 of 400 -- is therefore heard at 2.554 seconds and not at the 2.0 that
  // reading the bucket as a fraction of the clip's own duration would give.
  it("follows a speed ramp by its area rather than by its rate", async () => {
    const ctx = context(4);
    const ramped = clip({
      speed: { rate: 0.5, reverse: false, preservePitch: true },
      keyframes: {
        speed: [
          { time: 0, value: { kind: "float", value: 0.5 }, interp: "linear" },
          { time: 4 * SECOND, value: { kind: "float", value: 2 }, interp: "linear" },
        ],
      },
    } as unknown as Partial<Clip>);
    const spans = await detect(ctx, bursts([2.5, 3])(ctx), ramped, RAW);

    expect(timeToSeconds(spans[0]!.from)).toBeCloseTo(2.554, 2);
  });
});

describe("gapsBetween", () => {
  const within = { from: 0, to: 10 };

  it("is the whole range when nothing sounds", () => {
    expect(gapsBetween([], within)).toEqual([within]);
  });

  it("is nothing when the range sounds throughout", () => {
    expect(gapsBetween([within], within)).toEqual([]);
  });

  it("finds the silence before, between and after", () => {
    const gaps = gapsBetween(
      [
        { from: 2, to: 3 },
        { from: 5, to: 6 },
      ],
      within,
    );

    expect(gaps).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 10 },
    ]);
  });

  it("leaves no gap where a span touches the edge", () => {
    expect(gapsBetween([{ from: 0, to: 4 }], within)).toEqual([{ from: 4, to: 10 }]);
  });
});

describe("mergeSpans", () => {
  it("sorts and joins what overlaps", () => {
    expect(
      mergeSpans([
        { from: 5, to: 8 },
        { from: 0, to: 6 },
      ]),
    ).toEqual([{ from: 0, to: 8 }]);
  });

  it("leaves what does not overlap apart", () => {
    expect(
      mergeSpans([
        { from: 0, to: 2 },
        { from: 4, to: 6 },
      ]),
    ).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 6 },
    ]);
  });

  // Two clips end to end on one track: the join is a boundary and not a hole in the sound.
  it("joins two spans that meet exactly", () => {
    expect(
      mergeSpans([
        { from: 0, to: 4 },
        { from: 4, to: 8 },
      ]),
    ).toEqual([{ from: 0, to: 8 }]);
  });
});
