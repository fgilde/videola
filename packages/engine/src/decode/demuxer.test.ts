import { beforeAll, describe, expect, it } from "vitest";

import { secondsToTime } from "@videola/core";

import type { ProbeMedia } from "@videola/media";

import { probe, rationalizeFps, readChunks } from "./demuxer";
import { fixtureFrameSeconds, NTSC_FIXTURE, syncSampleNumbers, tinyMp4 } from "./fixture-mp4";

class ChunkStub {
  readonly type: string;
  readonly timestamp: number;
  readonly duration: number;

  constructor(init: { type: string; timestamp: number; duration: number }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }
}

// jsdom has no WebCodecs at all. This stands in for the one constructor mediabunny reaches for
// while turning a packet into a chunk; it carries the timing that the assertions are about and
// claims nothing about decoding.
beforeAll(() => {
  Object.defineProperty(globalThis, "EncodedVideoChunk", { value: ChunkStub, configurable: true });
});

describe("probe", () => {
  it("reads dimensions, duration and the codec description", async () => {
    const info = await probe(tinyMp4());

    expect(info.duration).toBe(secondsToTime(1.001));
    expect(info.video).toBeDefined();
    expect(info.video?.width).toBe(NTSC_FIXTURE.width);
    expect(info.video?.height).toBe(NTSC_FIXTURE.height);
    expect(info.video?.codec).toBe("avc1.42000a");
    // avcC, and its first byte is the configuration version. Without this block
    // VideoDecoder.configure yields neither frames nor an error.
    expect(info.video?.description?.[0]).toBe(1);
  });

  it("keeps NTSC rational instead of rounding it to 29.97", async () => {
    const info = await probe(tinyMp4());

    expect(info.video?.fps).toEqual({ numerator: 30000, denominator: 1001 });
  });

  it("reports a file without an audio track as audio: undefined", async () => {
    const info = await probe(tinyMp4());

    expect(info.audio).toBeUndefined();
  });

  it("rejects truncated bytes with a recognisable reason", async () => {
    const full = tinyMp4();
    const truncated = full.slice(0, Math.floor(full.size / 2));

    await expect(probe(truncated)).rejects.toThrow("error.mediaMetadata");
  });

  it("rejects bytes that are no container at all", async () => {
    await expect(probe(new Blob([new Uint8Array(64)]))).rejects.toThrow("error.mediaMetadata");
  });

  // importFile takes the probe as an argument so that @videola/media stays free of this package.
  // Nothing else holds the two shapes together, so this is where a drift would surface.
  it("fits the shape the media import expects", () => {
    const asImportExpects: ProbeMedia = probe;

    expect(asImportExpects).toBe(probe);
  });
});

describe("rationalizeFps", () => {
  it("recovers the NTSC family exactly", () => {
    expect(rationalizeFps(30000 / 1001)).toEqual({ numerator: 30000, denominator: 1001 });
    expect(rationalizeFps(24000 / 1001)).toEqual({ numerator: 24000, denominator: 1001 });
    expect(rationalizeFps(60000 / 1001)).toEqual({ numerator: 60000, denominator: 1001 });
  });

  it("keeps whole frame rates whole", () => {
    expect(rationalizeFps(30)).toEqual({ numerator: 30, denominator: 1 });
    expect(rationalizeFps(25)).toEqual({ numerator: 25, denominator: 1 });
    expect(rationalizeFps(24)).toEqual({ numerator: 24, denominator: 1 });
  });

  it("does not mistake 30 for 30000/1001", () => {
    expect(rationalizeFps(30).denominator).toBe(1);
    expect(rationalizeFps(29.97002997002997).numerator).toBe(30000);
  });

  it("approximates a rate that is neither", () => {
    const rate = rationalizeFps(12.5);

    expect(rate.numerator / rate.denominator).toBeCloseTo(12.5, 6);
    expect(Number.isInteger(rate.numerator)).toBe(true);
    expect(Number.isInteger(rate.denominator)).toBe(true);
  });

  it("refuses a rate that cannot be one", () => {
    expect(() => rationalizeFps(0)).toThrow("error.mediaMetadata");
    expect(() => rationalizeFps(Number.NaN)).toThrow("error.mediaMetadata");
  });
});

describe("readChunks", () => {
  it("starts at the key packet at or before the requested time", async () => {
    const source = tinyMp4();
    const keyframes = syncSampleNumbers(NTSC_FIXTURE);
    const secondKeyframe = keyframes[1]! - 1;
    const from = secondsToTime(fixtureFrameSeconds(NTSC_FIXTURE, secondKeyframe + 3));

    const chunks = await collect(readChunks(source, "video", from, from));

    expect(chunks[0]?.type).toBe("key");
    expect(chunks[0]?.timestamp).toBe(
      Math.round(fixtureFrameSeconds(NTSC_FIXTURE, secondKeyframe) * 1e6),
    );
  });

  it("yields the packet covering the end of the range, not everything before it", async () => {
    const source = tinyMp4();
    const last = NTSC_FIXTURE.sampleCount - 1;
    const to = secondsToTime(fixtureFrameSeconds(NTSC_FIXTURE, last));

    const chunks = await collect(readChunks(source, "video", 0, to));

    expect(chunks).toHaveLength(NTSC_FIXTURE.sampleCount);
  });

  // With `to` at the last frame, "the packet covering `to`" and "read to the end" agree, so that
  // case alone cannot tell a working end bound from a missing one. A `to` in the middle can.
  it("stops after the packet covering a mid-file end and not at the file end", async () => {
    const to = secondsToTime(fixtureFrameSeconds(NTSC_FIXTURE, 10));

    const chunks = await collect(readChunks(tinyMp4(), "video", 0, to));

    expect(chunks).toHaveLength(11);
    // Truncated, not rounded: WebCodecs timestamps are integer microseconds and mediabunny takes
    // Math.trunc to get there. Frame 10 of an NTSC file sits at 333666.67 us and travels as
    // 333666. That floor is the codec boundary's, not ours -- flicks keep the exact value on both
    // sides of it, which is why nothing derives a project time from a chunk timestamp.
    expect(chunks.at(-1)?.timestamp).toBe(
      Math.trunc(fixtureFrameSeconds(NTSC_FIXTURE, 10) * 1e6),
    );
  });

  it("stops between two frames at the frame that is still showing", async () => {
    const midway = (fixtureFrameSeconds(NTSC_FIXTURE, 5) + fixtureFrameSeconds(NTSC_FIXTURE, 6)) / 2;

    const chunks = await collect(readChunks(tinyMp4(), "video", 0, secondsToTime(midway)));

    expect(chunks).toHaveLength(6);
  });

  it("yields nothing for a track the file does not have", async () => {
    const chunks = await collect(readChunks(tinyMp4(), "audio", 0, secondsToTime(1)));

    expect(chunks).toHaveLength(0);
  });
});

async function collect(chunks: AsyncIterable<unknown>): Promise<ChunkStub[]> {
  const out: ChunkStub[] = [];
  for await (const chunk of chunks) out.push(chunk as ChunkStub);
  return out;
}
