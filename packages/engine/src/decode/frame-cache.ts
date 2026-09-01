const BYTES_PER_PIXEL = 4;

export const DEFAULT_FRAME_BUDGET_BYTES = 256 * 1024 * 1024;

// The one place in the program that owns decoded frames, and therefore the only place that closes
// them. A VideoFrame holds GPU or system memory the collector never reclaims, so every path that
// drops one -- eviction, overwrite, clear -- closes it here and nowhere else. Closing a frame a
// second time somewhere else is how playback starts rendering holes.
//
// The budget is in bytes, not entries: a 4K frame is sixteen times a 540p frame, and a cache
// counted in entries is sized for one of them and wrong for the other.
export class FrameCache {
  #budget: number;
  #frames = new Map<string, Entry>();
  #pinned = new Set<string>();
  #bytes = 0;

  constructor(budgetBytes: number = DEFAULT_FRAME_BUDGET_BYTES) {
    this.#budget = budgetBytes;
  }

  get(key: string): VideoFrame | undefined {
    const entry = this.#frames.get(key);
    if (entry === undefined) return undefined;
    // A Map iterates in insertion order, so re-inserting is what makes the eviction order LRU.
    this.#frames.delete(key);
    this.#frames.set(key, entry);
    return entry.frame;
  }

  // The size is taken once, here, and carried with the entry. A closed VideoFrame reports
  // codedWidth and codedHeight as zero, so anything that measures a frame on the way out
  // subtracts nothing and leaves the accounting climbing until the tab dies.
  put(key: string, frame: VideoFrame): void {
    this.#discard(key);
    const bytes = frame.codedWidth * frame.codedHeight * BYTES_PER_PIXEL;
    this.#frames.set(key, { frame, bytes });
    this.#bytes += bytes;
    this.#evict();
  }

  /**
   * Keep this frame until the tick that asked for it has drawn.
   *
   * The preview gathers one picture per visible clip and then renders once. Between the two, another
   * clip's decode can push this one out of the budget -- and because the cache is the only thing that
   * closes frames, what the compositor gets handed is a closed frame it has to skip. On screen that is
   * a layer showing the picture it had a moment ago, which is exactly what several media on a timeline
   * used to look like.
   *
   * Pinned frames are skipped by eviction, so the budget can be exceeded while a tick is in flight --
   * by what one drawn frame needs, and no longer than that, because the tick releases them.
   */
  pin(key: string): void {
    if (this.#frames.has(key)) this.#pinned.add(key);
  }

  /** The tick is over. Frames are ordinary cache entries again, and the budget applies to them. */
  unpinAll(): void {
    this.#pinned.clear();
    this.#evict();
  }

  clear(): void {
    this.#pinned.clear();
    for (const key of [...this.#frames.keys()]) this.#discard(key);
  }

  bytesHeld(): number {
    return this.#bytes;
  }

  // The number the budget is really about. Bytes are what the cache is sized in, because a 4K
  // frame is sixteen times a 540p one -- but what decides whether scrubbing feels instant or
  // ruinous is how many frames of *this* material fit, and that is only visible from here.
  framesHeld(): number {
    return this.#frames.size;
  }

  // A frame larger than the whole budget is kept anyway rather than closed on the way in: the
  // caller holds the reference `put` just accepted, and handing back something already closed
  // would be worse than exceeding a budget by one frame. Size the budget above one 4K frame.
  #evict(): void {
    const keys = [...this.#frames.keys()];
    // Never the newest: `put` has just handed that frame to a caller holding the reference, and a
    // cache that closes it under them is worse than a cache one frame over its budget. It used to be
    // covered by the size guard below, which stopped at one entry -- until a pinned frame became that
    // one entry and the eviction walked straight over the picture that had just arrived.
    const newest = keys[keys.length - 1];
    for (const key of keys) {
      if (this.#bytes <= this.#budget || this.#frames.size === 1) return;
      // A pinned frame is being drawn right now. Skipping it can leave the cache over budget for the
      // length of one tick, which is the trade this pin exists to make: a picture that is late is a
      // picture, and a picture that was closed under the compositor is a hole.
      if (key === newest || this.#pinned.has(key)) continue;
      this.#discard(key);
    }
  }

  #discard(key: string): void {
    const entry = this.#frames.get(key);
    if (entry === undefined) return;
    this.#pinned.delete(key);
    this.#frames.delete(key);
    this.#bytes -= entry.bytes;
    entry.frame.close();
  }
}

interface Entry {
  frame: VideoFrame;
  bytes: number;
}
