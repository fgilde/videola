import { mediaBlob } from "@videola/media";

import type { Time } from "@videola/core";
import type { Fidelity } from "@videola/media";

import { ImageSource, looksLikeStill } from "./image-source";
import { VideoSource } from "./video-source";

import type { FrameSource } from "../playback";

/**
 * The frames of a medium, whichever kind of medium it turns out to be.
 *
 * The choice cannot be made before `open`, because a hash says nothing about what it addresses --
 * so it is made here, once, and everything downstream goes on talking to one interface. Playback,
 * the export and the scene scan all ask for pictures at an instant; only this knows that some of
 * them come from a decoder and some from a single `createImageBitmap`.
 */
export class MediaFrames implements FrameSource {
  #fidelity: Fidelity;
  #inner?: FrameSource;

  constructor(fidelity: Fidelity) {
    this.#fidelity = fidelity;
  }

  // The original is looked at rather than what will be decoded: a proxy is a transcode of a moving
  // picture and never exists for a still, so the first bytes of the imported file are the answer.
  async open(hash: string): Promise<void> {
    const blob = await mediaBlob(hash);
    if (blob === undefined) throw new Error("error.mediaMissing");
    const source = (await looksLikeStill(blob))
      ? new ImageSource()
      : new VideoSource(this.#fidelity);
    try {
      await source.open(hash);
    } catch (error) {
      source.close();
      throw error;
    }
    this.#inner?.close();
    this.#inner = source;
  }

  async frameAt(at: Time): Promise<VideoFrame | undefined> {
    return this.#inner?.frameAt(at);
  }

  release(): void {
    this.#inner?.release?.();
  }

  close(): void {
    this.#inner?.close();
    this.#inner = undefined;
  }
}
