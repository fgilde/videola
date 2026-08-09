import { secondsToTime, timeToSeconds } from "@videola/core";
import { sourceBlob } from "@videola/media";
import { EncodedPacketSink, VideoSampleSink } from "mediabunny";

import type { Time } from "@videola/core";
import type { Fidelity } from "@videola/media";
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

export interface Held {
  start: number;
  end: number;
  key: string;
}

export class VideoSource {
  #fidelity: Fidelity;
  #cache: FrameCache;
  #medium?: OpenMedium;
  #window?: AsyncGenerator<VideoSample, void, unknown>;
  #held: Held[] = [];
  #position?: number;
  #duration: Time = 0;
  #decoded = 0;
  #pending: Promise<void> = Promise.resolve();

  // `fidelity` has no default. Everything that draws for the screen wants the proxy and everything
  // that writes a file wants the original, and the two are one word apart -- so the word is asked
  // for rather than assumed, and a new caller that has not thought about it does not compile.
  constructor(fidelity: Fidelity, budgetBytes: number = DEFAULT_FRAME_BUDGET_BYTES) {
    this.#fidelity = fidelity;
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

  // What the frame budget buys on this material: the same cache holds nine times as many frames of
  // a 720p proxy as of the 4K it was made from, and that number is only readable from here.
  get framesHeld(): number {
    return this.#cache.framesHeld();
  }

  get duration(): Time {
    return this.#duration;
  }

  // Nothing is torn down until the new medium has proven itself, so a failed open leaves the
  // source playing what it was playing before instead of leaving it with neither.
  async open(hash: string): Promise<void> {
    const blob = await sourceBlob(hash, this.#fidelity);
    if (blob === undefined) throw new Error("error.mediaMissing");
    const input = openInput(blob);
    try {
      await this.#adopt(input);
    } catch (error) {
      // Everything past the constructor owns this Input, including whatever mediabunny throws out
      // of track lookup or duration. An Input dropped without dispose keeps its reader on the
      // blob open for as long as the source lives.
      input.dispose();
      throw error;
    }
  }

  // The frame belongs to this source's cache and is only borrowed: the caller must not close it.
  // It must not hold it past the next call either -- eviction closes frames, so a consumer that
  // keeps the last good frame to paper over a decode gap, which is exactly what playback is told
  // to do, is holding something this cache may close underneath it.
  async frameAt(t: Time): Promise<VideoFrame | undefined> {
    const medium = this.#medium;
    if (medium === undefined || t < 0 || t >= this.#duration) return undefined;
    const hit = this.#cached(t);
    if (hit !== undefined) return hit;
    await this.#serialize(() => this.#fill(medium, timeToSeconds(t)));
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

  async #adopt(input: Input): Promise<void> {
    const track = await input.getPrimaryVideoTrack();
    if (track === null) throw new Error("error.mediaNoVideoTrack");
    const duration = secondsToTime(await track.computeDuration());
    this.close();
    this.#medium = {
      input,
      samples: new VideoSampleSink(track),
      packets: new EncodedPacketSink(track),
    };
    this.#duration = duration;
  }

  // One decode at a time. Two overlapping fills would each return() the other's generator and
  // then overwrite #window: the loser is orphaned with its VideoDecoder never closed and its pump
  // blocked forever on a queue nobody drains, which not even disposing the Input can release.
  // A tick at display rate over a scrubbing pointer makes that the ordinary case, not a race.
  #serialize(work: () => Promise<void>): Promise<void> {
    const next = this.#pending.then(work, work);
    this.#pending = next;
    return next;
  }

  async #fill(medium: OpenMedium, at: number): Promise<void> {
    try {
      await this.#pump(medium, at);
    } catch (error) {
      // A decoder that failed must leave the source usable: drop the dead generator so the next
      // request builds a fresh one. Throwing here instead would break the promise frameAt makes
      // -- a frame it cannot supply is undefined, never an exception -- and would leave every
      // later call throwing on the same corpse.
      this.#window = undefined;
      this.#position = undefined;
      console.error(error);
    }
  }

  async #pump(medium: OpenMedium, at: number): Promise<void> {
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
      // close() can land between the request and the sample. The cache this frame would go into
      // has already been cleared by then, so keeping it would hand ownership to nobody.
      if (this.#medium !== medium) {
        next.value.close();
        return;
      }
      this.#keep(next.value);
    }
  }

  // Decoding begins at the key packet, and `samples` is handed that timestamp rather than the one
  // asked for: mediabunny emits nothing before its start argument, so `samples(at)` would seek to
  // the same key packet and then throw away everything up to `at`. Those discarded frames are the
  // head of the group of pictures, and keeping them is the entire reverse strategy -- the core
  // hands out source times that walk backwards, and they come out of this cache instead of
  // decoding the group again for every step.
  //
  // ponytail: which means the budget has to hold a whole group of pictures. 256 MiB is 32 frames
  // at 1080p, and long-GOP H.264 -- phone video, screen capture, anything out of a streaming
  // pipeline, where a group of 250 is unremarkable -- passes that at 1080p already, not at 4K.
  // The cost of missing is quadratic: one backwards pass over a 250-frame group is about 31000
  // decodes. The way out is a window that walks backwards in bounded blocks instead of trusting
  // the cache to hold a whole group.
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
    insertHeld(this.#held, { start, end, key });
    this.#position = end;
    this.#decoded += 1;
  }

  #cached(t: Time): VideoFrame | undefined {
    const index = heldIndexAt(this.#held, timeToSeconds(t));
    const held = this.#held[index];
    if (held === undefined) return undefined;
    const frame = this.#cache.get(held.key);
    // The cache evicts under budget pressure without telling anyone, so a miss is how this side
    // learns the frame is gone.
    if (frame === undefined) this.#held.splice(index, 1);
    return frame;
  }
}

// A window that has to start over pays for a key packet lookup and a decoder flush; one that runs
// on pays for nothing. Going backwards always starts over, going far forwards is cheaper that way,
// and everything in between rides the decoder already running.
export function shouldRestartWindow(position: number | undefined, at: number): boolean {
  if (position === undefined) return true;
  return at < position || at > position + MAX_FORWARD_DECODE_SECONDS;
}

// A frame covers [start, end). Between two decoded frames, and past the last one, there is no
// frame to show: the nearest earlier one is the wrong answer rather than an approximate one,
// because it would freeze a gap instead of letting the caller decode into it.
export function heldIndexAt(held: readonly Held[], at: number): number {
  const index = lastStartingAtOrBefore(held, at);
  const entry = index < 0 ? undefined : held[index];
  return entry !== undefined && at < entry.end ? index : -1;
}

// ponytail: entries outlive the frame they describe until a lookup lands on that exact one, so a
// long playthrough accumulates them -- around 216000 after two hours at 30 fps, a few megabytes,
// with the search still logarithmic. Prune from the front once the array outgrows the frame count
// the budget can hold, if it ever turns up in a profile.
export function insertHeld(held: Held[], entry: Held): void {
  const index = lastStartingAtOrBefore(held, entry.start);
  if (held[index]?.start === entry.start) held[index] = entry;
  else held.splice(index + 1, 0, entry);
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
