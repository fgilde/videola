import { timeToSeconds } from "@videola/core";
import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";

import type { Clip, Effect, MediaAsset, Project, Time, Track } from "@videola/core";

import { measureLoudness } from "./graph";
import { LOUDNESS_TARGETS, normalizeToTarget, withMasterVolume } from "./normalize";
import type { AudioBufferSource } from "./graph";

const SAMPLE_RATE = 48_000;
const SECOND = 705_600_000;
const MEDIA = `med_${"a".repeat(64)}`;
const SECONDS = 3;

// A 1 kHz sine at a stated level, which is the one signal EBU Tech 3341 gives a number for: at
// -23 dBFS it reads -23.0 LUFS, so the loudness of the material is known before the graph sees it.
function tone(dbfs: number): AudioBufferSource {
  const amplitude = Math.pow(10, dbfs / 20);
  return {
    async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
      const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
      const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
      const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        data[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
      }
      buffer.copyToChannel(data, 0);
      buffer.copyToChannel(data, 1);
      return buffer as unknown as AudioBuffer;
    },
  };
}

function project(masterEffects: Effect[] = [], masterVolume = 1): Project {
  const asset: MediaAsset = {
    id: MEDIA,
    originalName: "tone.wav",
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
  const clip = {
    id: "clp_1",
    source: { kind: "media", media: MEDIA },
    start: 0,
    duration: SECONDS * SECOND,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {},
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
  } as unknown as Clip;
  const track = {
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
    clips: [clip],
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
    master: { volume: masterVolume, effects: masterEffects },
  } as unknown as Project;
}

const limiter = (threshold: number): Effect =>
  ({
    id: "eff_limiter",
    effectType: "limiter",
    enabled: true,
    params: { threshold: { kind: "float", value: threshold } },
    keyframes: {},
  }) as unknown as Effect;

// The real thing: a real offline render of the real graph, measured by the real R128 meter. Every
// number below comes out of samples.
const measuring =
  (source: AudioBufferSource) =>
  (candidate: Project): Promise<number> =>
    measureLoudness(
      new OfflineAudioContext(2, SECONDS * SAMPLE_RATE, SAMPLE_RATE),
      candidate,
      source,
    );

describe("normalizeToTarget", () => {
  it("brings a project that is too loud down onto the target", async () => {
    const measure = measuring(tone(-14));

    const result = await normalizeToTarget(project(), -23, measure);

    expect(result.loudness).toBeCloseTo(-23, 1);
    expect(result.volume).toBeCloseTo(Math.pow(10, -9 / 20), 2);
    expect(result.passes).toBe(1);
  });

  it("brings a project that is too quiet up onto the target", async () => {
    const measure = measuring(tone(-20));

    const result = await normalizeToTarget(project(), -14, measure);

    expect(result.loudness).toBeCloseTo(-14, 1);
    expect(result.volume).toBeCloseTo(2, 1);
  });

  // The number that comes back has to be a reading and not the target: a project already on target
  // is measured once and left alone, which is also what tells "landed" from "never checked".
  it("leaves a project that is already on target where it is", async () => {
    const measure = measuring(tone(-23));

    const result = await normalizeToTarget(project(), -23, measure);

    expect(result.volume).toBe(1);
    expect(result.passes).toBe(0);
  });

  it("moves the fader the project already had rather than replacing it", async () => {
    const measure = measuring(tone(-20));

    const result = await normalizeToTarget(project([], 0.5), -20, measure);

    // The fader stood at 0.5, so the programme measured -26 and has to come back up by six.
    expect(result.loudness).toBeCloseTo(-20, 1);
    expect(result.volume).toBeCloseTo(1, 2);
  });

  // The axis crossing: normalising *and* an insert on the master. Measured, and the measurement
  // corrected the expectation this test was written with.
  //
  // The fear is the reasonable one -- a DynamicsCompressorNode is not a gain, it stops limiting as
  // its input comes down, and it adds makeup on top -- but it does not apply here, and the reason
  // is the wiring rather than the node: inserts sit *ahead* of the fader, so the mastering chain
  // sees the same signal at every fader setting and the fader is a pure gain over whatever leaves
  // it. So one pass lands even with a limiter engaged, and this test says so with a limiter that is
  // engaged: the threshold is twenty decibels under the material and the render goes through it.
  //
  // What does not follow is that the arithmetic may be trusted and the second render skipped. The
  // R128 gates are level-dependent -- moving a programme changes which of its blocks clear the
  // absolute gate at -70 LUFS -- so the reading that comes back is always a reading.
  it("lands in one pass through a limiter, because the fader is behind it", async () => {
    const measure = measuring(tone(-6));
    const withLimiter = project([limiter(-26)]);

    const before = await measure(withLimiter);
    const result = await normalizeToTarget(withLimiter, -23, measure);

    // The limiter is doing something: a 1 kHz tone at -6 dBFS reads -6.0 LUFS on its own and
    // -9.6 through this one, so the chain being normalised through is not a wire.
    expect(before).toBeCloseTo(-9.6, 1);
    expect(result.loudness).toBeCloseTo(-23, 1);
    expect(result.passes).toBe(1);
  });

  // What comes back must be a reading of the project as corrected, never the target restated. The
  // measure is spied on rather than mocked: it is still the real render, and this only watches what
  // it was handed last.
  it("hands back a reading of the corrected project and not the target", async () => {
    const measure = measuring(tone(-14));
    const seen: number[] = [];

    const result = await normalizeToTarget(project(), -23, async (candidate) => {
      seen.push(candidate.master.volume);
      return measure(candidate);
    });

    expect(seen).toEqual([1, result.volume]);
    expect(result.loudness).not.toBe(-23);
    expect(result.loudness).toBeCloseTo(-23, 1);
  });

  // Silence has no loudness, so there is no factor to multiply by. Running the loop anyway would
  // walk the fader to its ceiling and report a project that is still silent as normalised.
  it("leaves a silent project alone", async () => {
    const silence: AudioBufferSource = {
      async bufferFor(): Promise<AudioBuffer> {
        const ctx = new OfflineAudioContext(2, SECONDS * SAMPLE_RATE, SAMPLE_RATE);
        return ctx.createBuffer(2, SECONDS * SAMPLE_RATE, SAMPLE_RATE) as unknown as AudioBuffer;
      },
    };

    const result = await normalizeToTarget(project(), -14, measuring(silence));

    expect(result.volume).toBe(1);
    expect(result.loudness).toBe(Number.NEGATIVE_INFINITY);
  });

  // The fader stops at four. Material forty decibels too quiet cannot be brought up by it, and the
  // honest report is the level it did reach rather than a loop that keeps asking.
  it("stops at the ceiling of the fader instead of measuring for ever", async () => {
    const measure = measuring(tone(-60));
    let renders = 0;

    const result = await normalizeToTarget(project(), -14, async (candidate) => {
      renders += 1;
      return measure(candidate);
    });

    expect(result.volume).toBe(4);
    expect(result.loudness).toBeLessThan(-40);
    expect(renders).toBeLessThanOrEqual(3);
  });
});

describe("withMasterVolume", () => {
  it("leaves the project it was given untouched", () => {
    const original = project();

    withMasterVolume(original, 2);

    expect(original.master.volume).toBe(1);
  });
});

describe("LOUDNESS_TARGETS", () => {
  it("offers the three anyone asks for", () => {
    expect(LOUDNESS_TARGETS.map((target) => target.lufs)).toEqual([-14, -16, -23]);
  });
});
