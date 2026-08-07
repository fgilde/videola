import { secondsToTime, timeToSeconds } from "@videola/core";
import { mediaBlob } from "@videola/media";
import { EncodedPacketSink, VideoSampleSink } from "mediabunny";

import type { Time } from "@videola/core";
import type { Input, VideoSample } from "mediabunny";

import { openInput } from "./demuxer";
import { DEFAULT_FRAME_BUDGET_BYTES, FrameCache } from "./frame-cache";

// Past this far ahead, decoding every frame in between costs more than seeking to the preceding
// key packet and starting over. Under it -- which is every step of ordinary playback -- the
// decoder and its configuration carry on, because reconfiguring on each scrub step is what makes
// a timeline feel broken.
export const MAX_FORWARD_DECODE_SECONDS = 2;

interface OpenMedium {
  input: Input;
  samples: VideoSampleSink;
  packets: EncodedPacketSink;
}

interface Held {
  start: number;
  end: number;
  key: string;
}

export class VideoSource {
  #cache: FrameCache;
  #medium?: OpenMedium;
  #window?: AsyncGenerator<VideoSample, void, unknown>;
  #held: Held[] = [];
  #position?: number;
  #duration: Time = 0;
  #decoded = 0;

  constructor(budgetBytes: number = DEFAULT_FRAME_BUDGET_BYTES) {
    this.#cache = new FrameCache(budgetBytes);
  }

  // Test-only. Counting what was decoded against what the cache still holds is how the browser
  // test proves close() leaves no frame open.
  get framesDecoded(): number {
    return this.#decoded;
  }

  get bytesHeld(): number {
    return this.#cache.bytesHeld();
  }

  get duration(): Time {
    return this.#duration;
  }

  // Nothing is torn down until the new medium has proven itself, so a failed open leaves the
  // source playing what it was playing before instead of leaving it with neither.
  async open(hash: string): Promise<void> {
    const blob = await mediaBlob(hash);
    if (blob === undefined) throw new Error("error.mediaMissing");
    const input = openInput(blob);
    const track = await input.getPrimaryVideoTrack();
    if (track === null) {
      input.dispose();
      throw new Error("error.mediaNoVideoTrack");
    }
    const duration = secondsToTime(await track.computeDuration());
    this.close();
    this.#medium = {
      input,
      samples: new VideoSampleSink(track),
      packets: new EncodedPacketSink(track),
    };
    this.#duration = duration;
  }

  // The frame belongs to this source's cache and is only borrowed. Closing it from the outside
  // takes the frame away from every other consumer of the same timestamp.
  async frameAt(t: Time): Promise<VideoFrame | undefined> {
    const medium = this.#medium;
    if (medium === undefined || t < 0 || t >= this.#duration) return undefined;
    const hit = this.#cached(t);
    if (hit !== undefined) return hit;
    await this.#fill(medium, timeToSeconds(t));
    return this.#cached(t);
  }

  // Decoding up to the target already leaves it in the cache, so the frameAt that follows a seek
  // costs nothing and there is no second path that could disagree with the first.
  async seek(t: Time): Promise<void> {
    await this.frameAt(t);
  }

  close(): void {
    void this.#window?.return(undefined);
    this.#window = undefined;
    this.#medium?.input.dispose();
    this.#medium = undefined;
    this.#position = undefined;
    this.#held = [];
    this.#duration = 0;
    this.#cache.clear();
  }

  #cached(t: Time): VideoFrame | undefined {
    const at = timeToSeconds(t);
    const index = lastStartingAtOrBefore(this.#held, at);
    const held = index < 0 ? undefined : this.#held[index];
    if (held === undefined || at >= held.end) return undefined;
    const frame = this.#cache.get(held.key);
    // The cache evicts under budget pressure without telling anyone, so a miss is how this side
    // learns the frame is gone.
    if (frame === undefined) this.#held.splice(index, 1);
    return frame;
  }

  async #fill(medium: OpenMedium, at: number): Promise<void> {
    if (this.#window === undefined || shouldRestartWindow(this.#position, at)) {
      await this.#restart(medium, at);
    }
    const window = this.#window;
    if (window === undefined) return;
    while (this.#position !== undefined && this.#position <= at) {
      const next = await window.next();
      if (next.done) {
        this.#window = undefined;
        return;
      }
      this.#keep(next.value);
    }
  }

  // Decoding always begins at a key packet, and every frame from there on is kept rather than
  // just the one asked for. That window is what makes a reversed clip affordable: the core hands
  // out source times that walk backwards, and they come out of this cache instead of decoding the
  // group of pictures again for every step.
  //
  // ponytail: which means the budget has to hold a whole group of pictures, or reverse playback
  // evicts the frames it is about to ask for and re-decodes the group per step. The default is
  // sized for 1080p; 4K with long groups wants either a larger budget or a window that decodes
  // backwards in bounded blocks instead of relying on the cache to keep the whole group.
  async #restart(medium: OpenMedium, at: number): Promise<void> {
    await this.#window?.return(undefined);
    const key = await medium.packets.getKeyPacket(at, { metadataOnly: true });
    const from = key?.timestamp ?? 0;
    this.#window = medium.samples.samples(from);
    this.#position = from;
  }

  #keep(sample: VideoSample): void {
    const key = String(sample.microsecondTimestamp);
    const start = sample.timestamp;
    const end = start + sample.duration;
    const frame = sample.toVideoFrame();
    // The sample and the frame it yields hold separate handles. The cache owns the frame from
    // the next line on and is the only thing that will ever close it.
    sample.close();
    this.#cache.put(key, frame);
    this.#remember({ start, end, key });
    this.#position = end;
    this.#decoded += 1;
  }

  #remember(held: Held): void {
    const index = lastStartingAtOrBefore(this.#held, held.start);
    if (this.#held[index]?.start === held.start) this.#held[index] = held;
    else this.#held.splice(index + 1, 0, held);
  }
}

// A window that has to start over pays for a key packet lookup and a decoder flush; one that runs
// on pays for nothing. Going backwards always starts over, going far forwards is cheaper that way,
// and everything in between rides the decoder already running.
export function shouldRestartWindow(position: number | undefined, at: number): boolean {
  if (position === undefined) return true;
  return at < position || at > position + MAX_FORWARD_DECODE_SECONDS;
}

export function lastStartingAtOrBefore(
  held: readonly { readonly start: number }[],
  at: number,
): number {
  let low = 0;
  let high = held.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (held[middle]!.start <= at) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
