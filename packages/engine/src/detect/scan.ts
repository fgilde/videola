import { frameDuration, timeToSeconds } from "@videola/core";

import { VideoSource } from "../decode/video-source";
import { frameSignature, sceneCuts, signatureDistance, SCENE_DEFAULTS } from "./scenes";
import type { SceneOptions } from "./scenes";

import type { Rate, Time } from "@videola/core";

/** What a scan needs about the clip it is looking through. */
export interface ScanRequest {
  /** The content hash of the medium, the same key everything else opens a decoder with. */
  hash: string;
  /** Where in the *source* to start and stop, which is what a decoder counts in. */
  from: Time;
  to: Time;
  /** The project's timebase: a scan looks at every frame of the timeline, not of the file. */
  fps: Rate;
  options?: SceneOptions;
  /** Called with how far along the scan is, 0 to 1. A scan of a long card takes a while. */
  onProgress?: (done: number) => void;
  /** Answering true abandons the scan; it then returns what it found so far. */
  cancelled?: () => boolean;
}

/**
 * Every cut in one range of one medium, as source times.
 *
 * Frame by frame, at the project's own rate. Sampling every second frame would halve the work and
 * report a cut up to two frames late, and two frames of the previous take at the head of a clip is
 * exactly the thing somebody would then fix by hand — so the expensive answer is the only useful one.
 *
 * The proxy, not the original: a cut is a change in the whole picture, and the smallest copy of the
 * frame that exists shows it just as clearly. That is the difference between a scan of a ten-minute card
 * taking a minute and taking ten.
 *
 * Returns source times, not project times. The caller knows how its clip maps one to the other -- a
 * speed ramp makes that a question only the core can answer -- and a scan that guessed would put the
 * splits in the wrong places on any clip that is not running at 1.
 */
export async function scanForCuts(request: ScanRequest): Promise<Time[]> {
  const step = frameDuration(request.fps);
  if (step <= 0 || request.to <= request.from) return [];
  const canvas = new OffscreenCanvas(32, 18);
  // `willReadFrequently`, because this reads back every frame it draws: without it a driver keeps the
  // surface on the GPU and every read is a stall, which on a long card is the whole cost of the scan.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const source = new VideoSource("preview");
  if (ctx === null) return [];
  const distances: number[] = [];
  const times: Time[] = [];
  try {
    await source.open(request.hash);
    let previous: Float32Array | undefined;
    const total = Math.max(1, Math.floor((request.to - request.from) / step));
    for (let index = 0; index <= total; index += 1) {
      if (request.cancelled?.() === true) break;
      const at = request.from + index * step;
      if (at >= request.to) break;
      const frame = await source.frameAt(at);
      if (frame === undefined) continue;
      const signature = frameSignature(ctx, frame);
      if (previous !== undefined) {
        distances.push(signatureDistance(previous, signature));
        times.push(at);
      }
      previous = signature;
      // Reported per frame rather than per block: a scan is the one thing here that takes long enough
      // for a person to wonder whether it is still running.
      request.onProgress?.((index + 1) / (total + 1));
    }
  } finally {
    source.close();
  }
  return sceneCuts(distances, request.options ?? SCENE_DEFAULTS).map(
    (index) => times[index - 1] ?? request.from,
  );
}

/** Seconds, for a caller that reports how long a scan looked at rather than how many frames. */
export function scanSeconds(request: Pick<ScanRequest, "from" | "to">): number {
  return timeToSeconds(Math.max(0, request.to - request.from));
}
