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
  #emitting = false;
  #restated?: Time;

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

  // The last frame lands between the last tick and here, so pausing without saying where it
  // stopped leaves every listener up to one frame behind the position the clock reports.
  pause(): void {
    if (!this.#playing) return;
    this.#startProjectTime = this.now();
    this.#playing = false;
    cancelAnimationFrame(this.#raf);
    this.#emit(this.#startProjectTime);
  }

  // Rounded and clamped here rather than trusted: `now()` returns whole flicks no matter what a
  // caller computed its target from, and the timeline has no time before zero for any of them to
  // land on.
  seek(t: Time): void {
    this.#startProjectTime = Math.max(0, Math.round(t));
    this.#startContextTime = this.#ctx.currentTime;
    this.#emit(this.#startProjectTime);
  }

  onTick(cb: (t: Time) => void): () => void {
    this.#listeners.add(cb);
    return () => void this.#listeners.delete(cb);
  }

  #tick(): void {
    if (!this.#playing) return;
    const mine = this.#raf;
    this.#emit(this.now());
    // A listener is free to pause, or to loop with pause-seek-play, from inside the tick. Either
    // way this run is no longer the one that owns the loop: a paused clock has none, and a
    // restarted one has already requested its own frame. Adding a request here would leave two
    // loops side by side, and every listener called twice per frame from then on.
    if (!this.#playing || this.#raf !== mine) return;
    this.#raf = requestAnimationFrame(() => this.#tick());
  }

  // A listener may seek from inside a tick, which asks for another round. Delivering it nested
  // would leave the listeners behind it holding the older time as their last word, and a
  // listener that seeks every time would recurse until the stack gives out. So a nested request
  // is remembered and delivered once, flat, afterwards -- and a request raised during *that* is
  // dropped, because the position is in `now()` either way and the next frame carries it.
  #emit(t: Time): void {
    if (this.#emitting) {
      this.#restated = t;
      return;
    }
    this.#emitting = true;
    try {
      this.#deliver(t);
      const restated = this.#restated;
      if (restated !== undefined && restated !== t) this.#deliver(restated);
    } finally {
      this.#emitting = false;
      this.#restated = undefined;
    }
  }

  // A listener that throws must not stop the clock, or one buggy consumer freezes playback for
  // every other one. Iterating the Set itself and not a copy of it is deliberate: a component
  // tearing down inside a tick unsubscribes, and a copy would call it once more afterwards.
  #deliver(t: Time): void {
    for (const cb of this.#listeners) {
      try {
        cb(t);
      } catch (error) {
        console.error(error);
      }
    }
  }
}
