import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";

import type { Clip, MediaAsset, Project, Time, Track } from "@videola/core";

import { AudioGraph } from "./graph";
import type { AudioBufferSource } from "./graph";
import { CHANNEL, isSurround, LFE_CUTOFF_HZ, stereoSpread, surroundGains } from "./surround";

const SAMPLE_RATE = 48_000;
const SECOND = 705_600_000;
const MEDIA = `med_${"a".repeat(64)}`;

const power = (gains: Float32Array): number =>
  Array.from(gains).reduce((total, gain) => total + gain * gain, 0);

describe("a point in the surround field", () => {
  // The law every desk uses, and the reason: a linear pan dips by 3 dB in the middle of every sweep,
  // which is heard as the sound receding as it crosses the centre.
  it("keeps the same power wherever it is placed", () => {
    for (const pan of [-1, -0.5, 0, 0.3, 1]) {
      for (const rear of [0, 0.25, 0.5, 1]) {
        expect(power(surroundGains(pan, rear))).toBeCloseTo(1, 2);
      }
    }
  });

  it("puts what is centred in the centre speaker, and nothing else there", () => {
    const middle = surroundGains(0, 0);
    expect(middle[CHANNEL.centre]).toBeCloseTo(1, 3);
    expect(middle[CHANNEL.left]).toBeCloseTo(0, 6);
    expect(middle[CHANNEL.right]).toBeCloseTo(0, 6);

    const right = surroundGains(1, 0);
    expect(right[CHANNEL.centre]).toBeCloseTo(0, 6);
    expect(right[CHANNEL.right]).toBeCloseTo(1, 3);
  });

  it("moves a track from the front pair to the rear pair as it is pushed back", () => {
    const front = surroundGains(-1, 0);
    const back = surroundGains(-1, 1);

    expect(front[CHANNEL.left]).toBeCloseTo(1, 3);
    expect(front[CHANNEL.rearLeft]).toBeCloseTo(0, 6);
    expect(back[CHANNEL.left]).toBeCloseTo(0, 6);
    expect(back[CHANNEL.rearLeft]).toBeCloseTo(1, 3);

    // Halfway is halfway in power rather than in level, which is what a constant-power law means.
    const middle = surroundGains(-1, 0.5);
    expect(middle[CHANNEL.left]! ** 2).toBeCloseTo(0.5, 2);
    expect(middle[CHANNEL.rearLeft]! ** 2).toBeCloseTo(0.5, 2);
  });

  // Never anything in the LFE from a position: what goes there is a band, which is why it is a send.
  it("puts nothing in the LFE, wherever the track is", () => {
    for (const rear of [0, 0.5, 1]) {
      expect(surroundGains(0.4, rear)[CHANNEL.lfe]).toBe(0);
    }
  });
});

describe("a stereo track placed in the field", () => {
  // The claim that makes a music bed usable: left alone, it comes out of the front pair the way it
  // went in. Summed to mono and placed as a point it would lose the width somebody recorded.
  it("leaves a bed at the front where it was", () => {
    const [left, right] = stereoSpread(0, 0);

    expect(left![CHANNEL.left]).toBeCloseTo(1, 3);
    expect(left![CHANNEL.right]).toBeCloseTo(0, 6);
    expect(right![CHANNEL.right]).toBeCloseTo(1, 3);
    expect(right![CHANNEL.left]).toBeCloseTo(0, 6);
  });

  it("collapses to a point at the edge, because there is nowhere left to spread", () => {
    const [left, right] = stereoSpread(1, 1);

    expect(left![CHANNEL.rearRight]).toBeGreaterThan(0.5);
    expect(right![CHANNEL.rearRight]).toBeCloseTo(1, 3);
  });
});

describe("which layouts exist", () => {
  it("calls six channels surround and two not", () => {
    expect(isSurround(2)).toBe(false);
    expect(isSurround(6)).toBe(true);
  });

  it("cuts the LFE send where the specification for that channel says", () => {
    expect(LFE_CUTOFF_HZ).toBe(120);
  });
});

// Through a real renderer, six channels out: what the table above says has to be what a rendered mix
// actually carries, and only the graph can be asked that.
describe("a surround project through the graph", () => {
  function context(channels: number): OfflineAudioContext {
    return new OfflineAudioContext(channels, SAMPLE_RATE, SAMPLE_RATE);
  }

  const asset = {
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
  } as unknown as MediaAsset;

  // A steady one on both channels, so any number other than a gain is the graph's doing. Built on the
  // context that will render it, like every other source in these tests: a buffer made on another
  // context is a buffer this renderer plays as silence.
  const steady = (ctx: OfflineAudioContext, hertz = 0): AudioBufferSource => ({
    async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
      const frames = Math.max(1, Math.round(((to - from) / SECOND) * SAMPLE_RATE));
      const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
      const data = new Float32Array(frames);
      for (let i = 0; i < frames; i += 1) {
        // Zero hertz is a steady one, which is what the placement checks want: any number other than
        // a gain is then the graph's doing. A real frequency is what the LFE check wants, because a
        // filter cannot be told from no filter by direct current.
        data[i] = hertz === 0 ? 1 : Math.sin((2 * Math.PI * hertz * i) / SAMPLE_RATE);
      }
      buffer.copyToChannel(data, 0);
      buffer.copyToChannel(data, 1);
      return buffer as unknown as AudioBuffer;
    },
  });

  function project(over: Partial<Track>, channels: number): Project {
    const clip = {
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
    } as unknown as Clip;
    return {
      settings: { sampleRate: SAMPLE_RATE, audioChannels: channels },
      library: [asset],
      timeline: {
        tracks: [
          {
            id: "trk_0",
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
            rear: 0,
            lfe: 0,
            clips: [clip],
            effects: [],
            ...over,
          } as unknown as Track,
        ],
      },
      markers: [],
      master: { volume: 1, effects: [] },
    } as unknown as Project;
  }

  async function rendered(
    over: Partial<Track>,
    channels = 6,
    hertz = 0,
  ): Promise<AudioBuffer> {
    const ctx = context(channels);
    const graph = new AudioGraph(ctx as unknown as BaseAudioContext, steady(ctx, hertz));
    await graph.prepare(project(over, channels));
    graph.startAt(0, 0);
    return (await ctx.startRendering()) as unknown as AudioBuffer;
  }

  // The middle of the second, so nothing being measured is a fade or a ramp.
  const level = (buffer: AudioBuffer, channel: number): number =>
    Math.abs(buffer.getChannelData(channel)[SAMPLE_RATE / 2] ?? 0);

  it("renders six channels for a 5.1 project", async () => {
    const out = await rendered({});
    expect(out.numberOfChannels).toBe(6);
    // A bed left alone: front pair, nothing behind, nothing in the centre.
    expect(level(out, CHANNEL.left)).toBeCloseTo(1, 2);
    expect(level(out, CHANNEL.right)).toBeCloseTo(1, 2);
    expect(level(out, CHANNEL.rearLeft)).toBeCloseTo(0, 3);
    expect(level(out, CHANNEL.rearRight)).toBeCloseTo(0, 3);
  });

  it("sends a track pushed back to the rear speakers", async () => {
    const out = await rendered({ rear: 1 } as Partial<Track>);

    expect(level(out, CHANNEL.rearLeft)).toBeGreaterThan(0.7);
    expect(level(out, CHANNEL.rearRight)).toBeGreaterThan(0.7);
    expect(level(out, CHANNEL.left)).toBeCloseTo(0, 2);
  });

  it("moves a bed towards the middle onto the centre speaker", async () => {
    const bed = await rendered({});
    const centred = await rendered({ pan: 0.5 });

    // A stereo bed at pan 0 is the front pair and nothing in the centre; panned inwards, the half of
    // it that reaches the middle lands on the centre speaker, which is what a centre channel is for.
    expect(level(bed, CHANNEL.centre)).toBeCloseTo(0, 2);
    expect(level(centred, CHANNEL.centre)).toBeGreaterThan(0.5);
  });

  it("sends the low end to the LFE only when asked", async () => {
    const off = await rendered({ lfe: 0 } as Partial<Track>);
    const on = await rendered({ lfe: 1 } as Partial<Track>);

    expect(level(off, CHANNEL.lfe)).toBeCloseTo(0, 4);
    // A steady one is direct current and passes a 120 Hz low-pass untouched, so what arrives is the
    // send itself rather than a filtered fraction of it.
    expect(level(on, CHANNEL.lfe)).toBeGreaterThan(0.5);
  });

  // Two claims a steady level cannot make: that the send is a *band* and that it is a *send*. A tone
  // at a kilohertz is above the cutoff the specification for that channel names, so what arrives is
  // what the filter left -- and half a send has to arrive at half the level.
  it("sends only the low end, and only as much as the send asks for", async () => {
    const high = await rendered({ lfe: 1 } as Partial<Track>, 6, 1000);
    const low = await rendered({ lfe: 1 } as Partial<Track>, 6, 40);
    const half = await rendered({ lfe: 0.5 } as Partial<Track>, 6, 40);

    const peak = (buffer: AudioBuffer, channel: number): number =>
      Math.max(...Array.from(buffer.getChannelData(channel).subarray(SAMPLE_RATE / 4), Math.abs));

    // Forty hertz passes; a kilohertz is most of the way gone. A send with no filter in it would put
    // the two at the same level.
    expect(peak(low, CHANNEL.lfe)).toBeGreaterThan(peak(high, CHANNEL.lfe) * 4);
    expect(peak(half, CHANNEL.lfe)).toBeCloseTo(peak(low, CHANNEL.lfe) / 2, 1);

    // Off both channels, so a track panned hard to one side still reaches the subwoofer: taking one
    // channel would send half the low end of every panned track and nothing at all of one that sits
    // entirely in the other. Two channels of the same tone sum to twice it, which is what this reads.
    expect(peak(low, CHANNEL.lfe)).toBeGreaterThan(1.5);
  });

  it("still renders stereo for a stereo project, through the native panner", async () => {
    const out = await rendered({ pan: -1 }, 2);

    expect(out.numberOfChannels).toBe(2);
    expect(level(out, 0)).toBeGreaterThan(1.3);
    expect(level(out, 1)).toBeCloseTo(0, 3);
  });
});
