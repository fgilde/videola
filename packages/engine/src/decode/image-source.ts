import { FLICKS_PER_SECOND } from "@videola/core";
import { mediaBlob } from "@videola/media";

import type { Time } from "@videola/core";

import type { MediaInfo } from "./demuxer";
import type { FrameSource } from "../playback";

/**
 * How long a still is when it reaches the timeline.
 *
 * A picture has no length to measure, so this is a choice and not a reading. Five seconds is what a
 * logo or an end card is worth before anybody reaches for the trim handles, and the handles are
 * right there. It rides in the library entry's duration because that is already what every part of
 * the program asks when it wants to know how long a medium is.
 */
export const STILL_DURATION: Time = FLICKS_PER_SECOND * 5;

// What a picture starts with. The mime type answers for a file somebody picked off a disk and for
// nothing else: media live in OPFS under a content hash, and a file read back from there has no
// extension to infer a type from and no type of its own -- so the bytes have to say.
const SIGNATURES: readonly (readonly [number, readonly number[]])[] = [
  [0, [0x89, 0x50, 0x4e, 0x47]], // PNG
  [0, [0xff, 0xd8, 0xff]], // JPEG
  [0, [0x47, 0x49, 0x46, 0x38]], // GIF8
  [0, [0x42, 0x4d]], // BM
  [8, [0x57, 0x45, 0x42, 0x50]], // WEBP, past RIFF and the length
];

// `ftyp` at four heads a picture and a video both, so the brand at eight is what separates an AVIF
// from an mp4. Anything not on this list goes to the demuxer, which is the right way round: a
// container mistaken for a picture decodes nothing at all, while a picture mistaken for a container
// is reported as media this build cannot read.
const STILL_BRANDS = ["avif", "avis", "heic", "heif", "mif1"];

const SNIFF_BYTES = 12;

export function isStill(source: Blob): boolean {
  return source.type.startsWith("image/");
}

/**
 * Whether these bytes are a picture, asked of the bytes themselves.
 *
 * Everything that reads stored media comes through here rather than through the mime type, because
 * a file read back out of OPFS has none.
 */
export async function looksLikeStill(source: Blob): Promise<boolean> {
  if (isStill(source)) return true;
  const head = new Uint8Array(await source.slice(0, SNIFF_BYTES).arrayBuffer());
  const matches = ([offset, magic]: readonly [number, readonly number[]]): boolean =>
    magic.every((byte, index) => head[offset + index] === byte);
  if (SIGNATURES.some(matches)) return true;
  const text = (from: number, to: number): string => String.fromCharCode(...head.slice(from, to));
  return text(4, 8) === "ftyp" && STILL_BRANDS.includes(text(8, 12));
}

/**
 * What a picture is worth as a library entry: its size, and a length somebody chose.
 *
 * No frame rate. A still has none, and the field is how the first import of an untouched project
 * decides the format -- a project that adopted a picture's frame rate would run at whatever number
 * was invented here.
 */
export async function probeStill(source: Blob): Promise<MediaInfo> {
  const bitmap = await createImageBitmap(source);
  try {
    return {
      duration: STILL_DURATION,
      video: { codec: "image", width: bitmap.width, height: bitmap.height },
    };
  } finally {
    bitmap.close();
  }
}

/**
 * A still, as the same kind of source everything else reads frames from.
 *
 * One frame, decoded once and handed over at every instant the clip is on screen: a watermark over
 * a five minute video is one picture, not nine thousand. The frame belongs to this object like a
 * decoded frame belongs to `VideoSource`'s cache -- nothing that draws it closes it -- so `close`
 * is the only place it ends.
 */
export class ImageSource implements FrameSource {
  #frame?: VideoFrame;

  get duration(): Time {
    return STILL_DURATION;
  }

  // The original rather than `sourceBlob`: a proxy is a transcode of a moving picture and no still
  // ever has one, so asking would be a lookup that always misses.
  async open(hash: string): Promise<void> {
    const blob = await mediaBlob(hash);
    if (blob === undefined) throw new Error("error.mediaMissing");
    const bitmap = await createImageBitmap(blob);
    try {
      const frame = new VideoFrame(bitmap, { timestamp: 0 });
      this.#frame?.close();
      this.#frame = frame;
    } finally {
      bitmap.close();
    }
  }

  // Every instant of a still is the same instant, so the time is not read.
  async frameAt(): Promise<VideoFrame | undefined> {
    return this.#frame;
  }

  close(): void {
    this.#frame?.close();
    this.#frame = undefined;
  }
}
