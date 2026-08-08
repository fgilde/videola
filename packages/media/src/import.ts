import { cmd, FLICKS_PER_SECOND, mediaKind } from "@videola/core";

import type { MediaAsset, MediaId, MediaKind, Rate, Time, VideolaDocument } from "@videola/core";

import { contentHash } from "./hash";
import { hasMedia, putMedia } from "./opfs";

export interface VideoTrackProbe {
  width: number;
  height: number;
  fps: Rate;
}

export interface AudioTrackProbe {
  sampleRate: number;
  channels: number;
}

export interface MediaProbe {
  duration: Time;
  video?: VideoTrackProbe;
  audio?: AudioTrackProbe;
}

// The demuxer lives in @videola/engine, which depends on this package rather than the other way
// round, so the technical data arrives as a function instead of an import. It takes a Blob and
// not the decoded bytes for the same reason the hash streams: a two-gigabyte file must never
// have to exist in memory to be described.
export type ProbeMedia = (source: Blob) => Promise<MediaProbe>;

export async function importFile(
  file: File,
  doc: VideolaDocument,
  probe: ProbeMedia,
): Promise<MediaId> {
  const kind = mediaKind(file.type);
  const probed = await probe(file);
  const hash = await contentHash(file);
  const asset = describeMedia(file, kind, probed, hash);
  // Bytes into OPFS first, dispatch second, never the reverse: a core that knows a medium whose
  // bytes are absent still looks fine until the next save, where the .videola writer has a
  // library entry it cannot back and the whole project fails to write.
  if (!(await hasMedia(hash))) await putMedia(hash, file);
  doc.dispatch(cmd.mediaImport(asset));
  return asset.id;
}

export interface NamedBytes {
  name: string;
  type: string;
  size: number;
}

// What a library entry for a file is, the checks included. Every host that imports media has to
// arrive at the same entry: one that stores its bytes somewhere other than OPFS still owes the
// timeline the width, the duration and the channel count, because an entry without them is a clip
// that draws nothing and plays nothing.
export function describeMedia(
  file: NamedBytes,
  kind: MediaKind,
  probed: MediaProbe,
  hash: string,
): MediaAsset {
  validateProbe(kind, probed);
  return describeAsset(file, kind, probed, hash);
}

// The bounds the core enforces inside `media.import` (videola-core/src/model/project.rs:
// `bounded`, `rate_bounded`) plus the integer widths it deserialises into - u32 everywhere
// except `channels`, which is a u16. They are repeated here because the dispatch happens after
// the bytes are already in OPFS: an fps of 30/0 out of a truncated container has to be caught
// before that point, not after it.
const MAX_DURATION: Time = FLICKS_PER_SECOND * 60 * 60 * 24;
const MIN_FPS = 1;
const MAX_FPS = 1000;
const MAX_DIMENSION = 16_384;
const MAX_SAMPLE_RATE = 384_000;
const MAX_CHANNELS = 65_535;
const MAX_U32 = 4_294_967_295;
const METADATA = "error.mediaMetadata";

function validateProbe(kind: MediaKind, probed: MediaProbe): void {
  requireInteger(probed.duration, 0, MAX_DURATION, "duration");
  // A file whose mime claims video but that carries no video track is broken or mislabelled.
  // Rejecting it here keeps it out of the library entirely, rather than letting the timeline
  // discover the missing track on the first render of a clip that can never show anything.
  if (kind === "video" && probed.video === undefined) throw new Error("error.mediaNoVideoTrack");
  if (kind === "audio" && probed.audio === undefined) throw new Error("error.mediaNoAudioTrack");
  if (probed.video !== undefined) validateVideo(probed.video);
  if (probed.audio !== undefined) validateAudio(probed.audio);
}

function validateVideo(video: VideoTrackProbe): void {
  requireInteger(video.width, 1, MAX_DIMENSION, "width");
  requireInteger(video.height, 1, MAX_DIMENSION, "height");
  requireInteger(video.fps.numerator, 1, MAX_U32, "fps numerator");
  requireInteger(video.fps.denominator, 1, MAX_U32, "fps denominator");
  const fps = video.fps.numerator / video.fps.denominator;
  if (fps < MIN_FPS || fps > MAX_FPS) throw new RangeError(METADATA, { cause: "fps" });
}

function validateAudio(audio: AudioTrackProbe): void {
  requireInteger(audio.sampleRate, 1, MAX_SAMPLE_RATE, "sample rate");
  requireInteger(audio.channels, 1, MAX_CHANNELS, "channels");
}

// The message is a catalogue key, because the reason reaches the user the moment a drop zone
// calls this. Which field was wrong is of no use to them and every use to whoever debugs it, so
// it rides along as the cause rather than in the key.
function requireInteger(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(METADATA, { cause: what });
  }
}

function describeAsset(
  file: NamedBytes,
  kind: MediaKind,
  probed: MediaProbe,
  hash: string,
): MediaAsset {
  return {
    id: `med_${hash}`,
    originalName: file.name,
    mime: file.type,
    kind,
    sizeBytes: BigInt(file.size),
    duration: probed.duration,
    width: probed.video?.width ?? null,
    height: probed.video?.height ?? null,
    fps: probed.video?.fps ?? null,
    sampleRate: probed.audio?.sampleRate ?? null,
    channels: probed.audio?.channels ?? null,
  };
}
