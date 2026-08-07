import { secondsToTime } from "@videola/core";

import type { Time } from "@videola/core";

// Only the reading matters, and narrowing it to that is what lets a test drive the clock without
// a Web Audio implementation underneath.
export interface ClockSource {
  readonly currentTime: number;
}

// The sound leads and the picture follows: elapsed time is read from the audio context, because
// drift in audio is audible and a dropped frame is not.
export class Clock {
  #ctx: ClockSource;
  #startContextTime = 0;
  #startProjectTime: Time = 0;
  #playing = false;
  #listeners = new Set<(t: Time) => void>();
  #raf = 0;

  constructor(ctx: ClockSource) {
    this.#ctx = ctx;
  }

  get isPlaying(): boolean {
    return this.#playing;
  }

  now(): Time {
    if (!this.#playing) return this.#startProjectTime;
    return this.#startProjectTime + secondsToTime(this.#ctx.currentTime - this.#startContextTime);
  }

  play(): void {
    if (this.#playing) return;
    this.#startContextTime = this.#ctx.currentTime;
    this.#playing = true;
    this.#tick();
  }

  pause(): void {
    if (!this.#playing) return;
    this.#startProjectTime = this.now();
    this.#playing = false;
    cancelAnimationFrame(this.#raf);
  }

  // Rounded here rather than trusted, so that `now()` returns whole flicks no matter what a
  // caller computed its target from.
  seek(t: Time): void {
    this.#startProjectTime = Math.round(t);
    this.#startContextTime = this.#ctx.currentTime;
    this.#emit(this.#startProjectTime);
  }

  onTick(cb: (t: Time) => void): () => void {
    this.#listeners.add(cb);
    return () => void this.#listeners.delete(cb);
  }

  #tick(): void {
    if (!this.#playing) return;
    this.#emit(this.now());
    // A listener is free to pause from inside the tick. Scheduling anyway would leave a frame
    // request that `pause` has already had its chance to cancel, and the next `play` would start
    // a second loop alongside it -- every listener called twice per frame from then on.
    if (!this.#playing) return;
    this.#raf = requestAnimationFrame(() => this.#tick());
  }

  // A listener that throws must not stop the clock, or one buggy consumer freezes playback for
  // every other one. Iterating the Set itself and not a copy of it is deliberate: a component
  // tearing down inside a tick unsubscribes, and a copy would call it once more afterwards.
  #emit(t: Time): void {
    for (const cb of this.#listeners) {
      try {
        cb(t);
      } catch (error) {
        console.error(error);
      }
    }
  }
}
