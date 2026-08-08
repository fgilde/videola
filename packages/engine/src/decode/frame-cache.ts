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

  clear(): void {
    for (const key of [...this.#frames.keys()]) this.#discard(key);
  }

  bytesHeld(): number {
    return this.#bytes;
  }

  // A frame larger than the whole budget is kept anyway rather than closed on the way in: the
  // caller holds the reference `put` just accepted, and handing back something already closed
  // would be worse than exceeding a budget by one frame. Size the budget above one 4K frame.
  #evict(): void {
    for (const key of this.#frames.keys()) {
      if (this.#bytes <= this.#budget || this.#frames.size === 1) return;
      this.#discard(key);
    }
  }

  #discard(key: string): void {
    const entry = this.#frames.get(key);
    if (entry === undefined) return;
    this.#frames.delete(key);
    this.#bytes -= entry.bytes;
    entry.frame.close();
  }
}

interface Entry {
  frame: VideoFrame;
  bytes: number;
}
