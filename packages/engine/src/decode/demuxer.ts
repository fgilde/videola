import { secondsToTime, timeToSeconds } from "@videola/core";
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from "mediabunny";

import type { Rate, Time } from "@videola/core";
import type { InputAudioTrack, InputTrack, InputVideoTrack } from "mediabunny";

export type TrackId = "video" | "audio";

export interface VideoTrackInfo {
  codec: string;
  width: number;
  height: number;
  fps: Rate;
  description?: Uint8Array;
}

export interface AudioTrackInfo {
  codec: string;
  sampleRate: number;
  channels: number;
}

export interface MediaInfo {
  duration: Time;
  video?: VideoTrackInfo;
  audio?: AudioTrackInfo;
}

const METADATA = "error.mediaMetadata";

// Enough packets for the rate of a constant-frame-rate file to be exact and few enough that the
// sample table is only touched at its head. mediabunny stops early once it has this many.
const FPS_SAMPLE_PACKETS = 120;

// A Blob is a handle, not a copy: opening a two-gigabyte file here reads its header and nothing
// else. Every consumer in this package goes through it, which is what keeps media in OPFS rather
// than in the heap.
export function openInput(source: Blob): Input {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
}

export async function probe(source: Blob): Promise<MediaInfo> {
  const input = openInput(source);
  try {
    return await describe(input);
  } catch (error) {
    // Truncated or mislabelled bytes surface as whatever mediabunny happened to trip over. The
    // caller needs one recognisable reason; the original travels as the cause for whoever debugs.
    throw error instanceof Error && error.message === METADATA
      ? error
      : new Error(METADATA, { cause: error });
  } finally {
    input.dispose();
  }
}

// The range starts at the key packet at or before `from`, because no decoder can begin mid-GOP,
// and ends with the packet covering `to` rather than before it, so a caller asking for the last
// frame of a medium is not handed everything but that frame.
//
// ponytail: one Input per call, so every call re-reads the container header. That is right for
// the batch reads this is for -- an audio buffer, an export pass -- and wrong per frame, which is
// why VideoSource keeps its own open instead. If a caller ever wants this in a tight loop, hand
// it an already open Input rather than making it pay for the header again.
export async function* readChunks(
  source: Blob,
  trackId: TrackId,
  from: Time,
  to: Time,
): AsyncIterable<EncodedVideoChunk | EncodedAudioChunk> {
  const input = openInput(source);
  try {
    const track = await trackOf(input, trackId);
    if (track === null) return;
    const sink = new EncodedPacketSink(track);
    const start = (await sink.getKeyPacket(timeToSeconds(from))) ?? undefined;
    const covering = await sink.getPacket(timeToSeconds(to));
    const end = (covering && (await sink.getNextPacket(covering))) ?? undefined;
    for await (const packet of sink.packets(start, end)) {
      yield trackId === "video" ? packet.toEncodedVideoChunk() : packet.toEncodedAudioChunk();
    }
  } finally {
    input.dispose();
  }
}

// mediabunny reports the frame rate as a float and no container field carries it as a rational,
// so it has to be reconstructed. The NTSC family is matched first and exactly: 30000/1001 rounded
// to 29.97 costs a frame every thirty-three seconds, and the core stores a Rate for that reason.
//
// ponytail: this reads an average, so a genuinely variable frame rate comes out as a nominal one.
// Constant frame rate material -- everything an editor gets handed in practice -- is exact. The
// way out is the container's own timing: the media timescale over the modal packet delta in ticks
// is the rational the file actually stores, and mediabunny exposes the timescale already.
export function rationalizeFps(rate: number): Rate {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(METADATA, { cause: "fps" });
  const ntsc = Math.round((rate * 1001) / 1000);
  if (ntsc > 0 && matches(rate, (ntsc * 1000) / 1001)) {
    return { numerator: ntsc * 1000, denominator: 1001 };
  }
  const whole = Math.round(rate);
  if (whole > 0 && matches(rate, whole)) return { numerator: whole, denominator: 1 };
  return approximate(rate);
}

const FPS_TOLERANCE = 1e-4;
const MAX_FPS_DENOMINATOR = 100_000;

function matches(rate: number, candidate: number): boolean {
  return Math.abs(rate - candidate) <= rate * FPS_TOLERANCE;
}

// Continued fractions: the last convergent whose denominator still fits is the closest rational
// with a denominator that small, which is what a variable frame rate file deserves.
function approximate(rate: number): Rate {
  let [numerator, denominator, previousNumerator, previousDenominator] = [1, 0, 0, 1];
  let value = rate;
  for (let step = 0; step < 32; step += 1) {
    const whole = Math.floor(value);
    const nextDenominator = whole * denominator + previousDenominator;
    if (nextDenominator > MAX_FPS_DENOMINATOR) break;
    [previousNumerator, numerator] = [numerator, whole * numerator + previousNumerator];
    [previousDenominator, denominator] = [denominator, nextDenominator];
    const remainder = value - whole;
    if (remainder < Number.EPSILON) break;
    value = 1 / remainder;
  }
  return { numerator, denominator: Math.max(denominator, 1) };
}

async function describe(input: Input): Promise<MediaInfo> {
  if (!(await input.canRead())) throw new Error(METADATA, { cause: "format" });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  // A file cut short before its track table is still a readable container to mediabunny -- it
  // reports no tracks and a duration of zero rather than failing. Left alone that reaches the
  // library as a medium with nothing in it, so the emptiness is the error.
  if (video === null && audio === null) throw new Error(METADATA, { cause: "no tracks" });
  return {
    duration: secondsToTime(await input.computeDuration()),
    video: video === null ? undefined : await describeVideo(video),
    audio: audio === null ? undefined : await describeAudio(audio),
  };
}

async function describeVideo(track: InputVideoTrack): Promise<VideoTrackInfo> {
  const config = await track.getDecoderConfig();
  if (config === null) throw new Error(METADATA, { cause: "video codec" });
  const stats = await track.computePacketStats(FPS_SAMPLE_PACKETS);
  return {
    codec: config.codec,
    width: await track.getCodedWidth(),
    height: await track.getCodedHeight(),
    fps: rationalizeFps(stats.averagePacketRate),
    // avcC for H.264. Without it VideoDecoder.configure produces neither frames nor an error, so
    // it travels with the metadata and not as something a later task has to remember to fetch.
    description: asBytes(config.description),
  };
}

async function describeAudio(track: InputAudioTrack): Promise<AudioTrackInfo> {
  const config = await track.getDecoderConfig();
  if (config === null) throw new Error(METADATA, { cause: "audio codec" });
  return {
    codec: config.codec,
    sampleRate: config.sampleRate,
    channels: config.numberOfChannels,
  };
}

function asBytes(description: AllowSharedBufferSource | undefined): Uint8Array | undefined {
  if (description === undefined) return undefined;
  if (!ArrayBuffer.isView(description)) return new Uint8Array(description as ArrayBuffer);
  const { buffer, byteOffset, byteLength } = description;
  return new Uint8Array(buffer as ArrayBuffer, byteOffset, byteLength);
}

async function trackOf(input: Input, trackId: TrackId): Promise<InputTrack | null> {
  return trackId === "video" ? input.getPrimaryVideoTrack() : input.getPrimaryAudioTrack();
}
