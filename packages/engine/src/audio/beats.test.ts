import { describe, expect, it } from "vitest";

import { FLICKS_PER_SECOND } from "@videola/core";
import type { Clip } from "@videola/core";
import type { Peaks } from "@videola/media";

import { beatBuckets, beatMarkers, beatTimes, DEFAULT_BEATS } from "./beats";

const PER_BUCKET = 0.01;

/** A metronome: a hit every `everySeconds`, decaying over three buckets, silence between. */
function metronome(seconds: number, everySeconds: number, level = 0.8, from = 0): Peaks {
  const count = Math.round(seconds / PER_BUCKET);
  const max = new Float32Array(count);
  const min = new Float32Array(count);
  const step = Math.round(everySeconds / PER_BUCKET);
  for (let bucket = Math.round(from / PER_BUCKET); bucket < count; bucket += 1) {
    const since = (bucket - Math.round(from / PER_BUCKET)) % step;
    const value = since < 3 ? level * (1 - since / 3) : 0;
    max[bucket] = value;
    min[bucket] = -value;
  }
  return { min, max };
}

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "clp_1",
    start: 0,
    duration: 4 * FLICKS_PER_SECOND,
    inPoint: 0,
    source: { kind: "media", media: "med_1" },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    effects: [],
    keyframes: {},
    blend: "normal",
    volume: 1,
    speed: { rate: 1, reverse: false, preservePitch: true },
    fades: { inDuration: 0, outDuration: 0 },
    transitionIn: null,
    transitionOut: null,
    groupId: null,
    ...over,
  } as Clip;
}

describe("finding the beat", () => {
  // Two per second for four seconds is eight hits, and the first one has no bucket before it to
  // rise from -- it rises from silence, which is the largest rise there is.
  it("finds every hit of a metronome and nothing between them", () => {
    const found = beatBuckets(metronome(4, 0.5), PER_BUCKET);
    expect(found).toHaveLength(8);
    for (let index = 0; index < found.length; index += 1) {
      expect(found[index]).toBeCloseTo((index * 0.5) / PER_BUCKET, 0);
    }
  });

  // What a fixed threshold cannot do. The second half is a tenth of the first, and the same eight
  // hits have to come back: it is a rise against its own neighbourhood, not against full scale.
  it("finds the quiet half of a track that gets quieter", () => {
    const loud = metronome(2, 0.5, 0.9);
    const quiet = metronome(2, 0.5, 0.09);
    const max = new Float32Array([...loud.max, ...quiet.max]);
    const min = new Float32Array([...loud.min, ...quiet.min]);

    expect(beatBuckets({ min, max }, PER_BUCKET)).toHaveLength(8);
  });

  it("hears nothing in silence", () => {
    const silence = { min: new Float32Array(400), max: new Float32Array(400) };
    expect(beatBuckets(silence, PER_BUCKET)).toEqual([]);
  });

  // A note that swells over a second is not a beat, however loud it ends up: the rise per bucket is
  // a hundredth of the swell, and that is what is being asked about.
  it("does not hear a swell as a hit", () => {
    const count = 400;
    const max = new Float32Array(count);
    const min = new Float32Array(count);
    for (let bucket = 0; bucket < count; bucket += 1) {
      max[bucket] = bucket / count;
      min[bucket] = -bucket / count;
    }
    expect(beatBuckets({ min, max }, PER_BUCKET)).toEqual([]);
  });

  // One hit spread over three buckets of attack is one beat. Without the local-maximum rule it is
  // three, and a marker on each of them is a marker every ten milliseconds.
  it("counts one hit once, however long its attack is", () => {
    const count = 200;
    const max = new Float32Array(count);
    const min = new Float32Array(count);
    for (const bucket of [50, 51, 52, 53]) {
      max[bucket] = 0.2 * (bucket - 49);
      min[bucket] = -max[bucket];
    }
    expect(beatBuckets({ min, max }, PER_BUCKET)).toHaveLength(1);
  });

  it("never puts two beats closer together than it was told to", () => {
    const dense = metronome(4, 0.05);
    const found = beatBuckets(dense, PER_BUCKET, { ...DEFAULT_BEATS, minIntervalSeconds: 0.4 });
    for (let index = 1; index < found.length; index += 1) {
      expect(found[index]! - found[index - 1]!).toBeGreaterThanOrEqual(0.4 / PER_BUCKET - 1);
    }
  });

  // On a clean metronome sensitivity changes nothing, and that is right: every hit is the same
  // hit. It earns its keep on material with a downbeat -- a bar of one loud and three quiet hits,
  // where a strict setting keeps the loud one and a keen one keeps all four.
  it("keeps only the downbeat when told to be strict", () => {
    const count = 400;
    const max = new Float32Array(count);
    const min = new Float32Array(count);
    for (let bucket = 0; bucket < count; bucket += 25) {
      const level = bucket % 100 === 0 ? 0.9 : 0.05;
      max[bucket] = level;
      min[bucket] = -level;
    }
    const keen = beatBuckets({ min, max }, PER_BUCKET, { ...DEFAULT_BEATS, sensitivity: 1.2 });
    const strict = beatBuckets({ min, max }, PER_BUCKET, { ...DEFAULT_BEATS, sensitivity: 3.5 });
    expect(keen).toEqual([0, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375]);
    expect(strict.length).toBeLessThan(keen.length);
    // Whatever else it drops, every downbeat is still there: a setting that loses the one hit an
    // editor would have cut on is worse than no setting at all.
    for (const downbeat of [0, 100, 200, 300]) expect(strict).toContain(downbeat);
  });
});

describe("beats on the timeline", () => {
  it("puts a beat where it sounds, not where its bucket is", () => {
    const times = beatTimes(metronome(4, 1), clip({ start: 2 * FLICKS_PER_SECOND }));
    expect(times).toHaveLength(4);
    expect(times[0]! / FLICKS_PER_SECOND).toBeCloseTo(2, 1);
    expect(times[3]! / FLICKS_PER_SECOND).toBeCloseTo(5, 1);
  });

  // The whole reason the bucket-to-time step goes through the core's own inversion: at double speed
  // a clip consumes two seconds of source per second on the timeline, so a hit a second apart in
  // the buffer is half a second apart on screen.
  it("halves the spacing under a clip played at double speed", () => {
    const fast = clip({
      duration: 2 * FLICKS_PER_SECOND,
      speed: { rate: 2, reverse: false, preservePitch: true },
    });
    const times = beatTimes(metronome(4, 1), fast);
    expect(times).toHaveLength(4);
    expect((times[1]! - times[0]!) / FLICKS_PER_SECOND).toBeCloseTo(0.5, 1);
  });

  it("makes one numbered marker per beat, in order", () => {
    const track = { id: "trk_1", clips: [clip()] } as never;
    const commands = beatMarkers(track, new Map([["clp_1", metronome(4, 1)]]));
    expect(commands).toHaveLength(4);
    expect(commands.map((command) => (command as { label: string }).label)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    const times = commands.map((command) => (command as { time: number }).time);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });

  it("asks for nothing where a clip has no peaks read yet", () => {
    const track = { id: "trk_1", clips: [clip()] } as never;
    expect(beatMarkers(track, new Map())).toEqual([]);
  });
});
