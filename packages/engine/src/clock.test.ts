import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Clock } from "./clock";

const FLICKS_PER_SECOND = 705_600_000;

// AudioContext.currentTime is in seconds, starts at zero, and never runs backwards -- the spec
// calls it monotonically increasing. Anything the clock may not assume about it, this must not
// grant: advancing is the only thing a test can do to it.
class FakeAudioContext {
  #currentTime = 0;

  get currentTime(): number {
    return this.#currentTime;
  }

  advance(seconds: number): void {
    if (seconds < 0) throw new RangeError("currentTime never runs backwards");
    this.#currentTime += seconds;
  }
}

let frames = new Map<number, FrameRequestCallback>();
let nextHandle = 1;

function runFrame(): void {
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(0);
}

beforeEach(() => {
  frames = new Map();
  nextHandle = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    frames.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => void frames.delete(handle));
});

afterEach(() => vi.unstubAllGlobals());

describe("Clock", () => {
  it("stands still while paused, however far the context runs on", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);

    ctx.advance(3);

    expect(clock.isPlaying).toBe(false);
    expect(clock.now()).toBe(0);
  });

  it("advances by the elapsed context time in flicks", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);

    ctx.advance(10);
    clock.play();
    ctx.advance(0.5);

    expect(clock.now()).toBe(FLICKS_PER_SECOND / 2);
  });

  it("freezes at the point playback reached and resumes from there", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);

    clock.play();
    ctx.advance(2);
    clock.pause();
    ctx.advance(60);

    expect(clock.now()).toBe(2 * FLICKS_PER_SECOND);

    clock.play();
    ctx.advance(1);

    expect(clock.now()).toBe(3 * FLICKS_PER_SECOND);
  });

  it("moves the base on seek without stopping playback", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);

    clock.play();
    ctx.advance(1);
    clock.seek(10 * FLICKS_PER_SECOND);

    expect(clock.isPlaying).toBe(true);
    expect(clock.now()).toBe(10 * FLICKS_PER_SECOND);

    ctx.advance(0.25);

    expect(clock.now()).toBe(10.25 * FLICKS_PER_SECOND);
  });

  it("reports whole flicks whatever the context time is", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);

    clock.play();
    for (const step of [1 / 3, Math.PI / 7, 0.1, 1e-9]) {
      ctx.advance(step);
      expect(Number.isInteger(clock.now())).toBe(true);
    }

    clock.seek(1.7);

    expect(Number.isInteger(clock.now())).toBe(true);
  });

  it("emits the current time on every animation frame while playing", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];
    clock.onTick((t) => seen.push(t));

    clock.play();
    ctx.advance(1);
    runFrame();
    ctx.advance(1);
    runFrame();

    expect(seen).toEqual([0, FLICKS_PER_SECOND, 2 * FLICKS_PER_SECOND]);
  });

  it("stops emitting once paused", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];

    clock.play();
    ctx.advance(1);
    clock.onTick((t) => seen.push(t));
    clock.pause();
    runFrame();
    runFrame();

    expect(seen).toEqual([FLICKS_PER_SECOND]);
  });

  it("leaves no second tick loop behind when a listener pauses it", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    let ticks = 0;
    let pauseOnce = true;
    clock.onTick(() => {
      ticks += 1;
      if (!pauseOnce) return;
      pauseOnce = false;
      clock.pause();
    });

    clock.play();
    clock.play();
    ticks = 0;
    runFrame();

    expect(ticks).toBe(1);

    runFrame();

    expect(ticks).toBe(2);
  });

  it("keeps running and keeps notifying when a listener throws", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    clock.onTick(() => {
      throw new Error("bad consumer");
    });
    clock.onTick((t) => seen.push(t));

    clock.play();
    ctx.advance(1);
    runFrame();

    expect(seen).toEqual([0, FLICKS_PER_SECOND]);
    expect(clock.isPlaying).toBe(true);
  });

  it("unsubscribes through the returned function, even from inside a tick", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];
    const off = clock.onTick((t) => {
      seen.push(t);
      off();
    });

    clock.play();
    ctx.advance(1);
    runFrame();
    runFrame();

    expect(seen).toEqual([0]);
  });

  it("skips a listener another one unsubscribed during the same tick", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];
    const later = { off: () => {} };
    clock.onTick(() => later.off());
    later.off = clock.onTick((t) => seen.push(t));

    clock.play();
    ctx.advance(1);
    runFrame();

    expect(seen).toEqual([]);
  });

  it("leaves no second tick loop behind when a listener loops the playhead", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    let ticks = 0;
    let looped = false;
    // Loop playback, written the way anyone would write it.
    clock.onTick((t) => {
      ticks += 1;
      if (looped || t < FLICKS_PER_SECOND) return;
      looped = true;
      clock.pause();
      clock.seek(0);
      clock.play();
    });

    clock.play();
    ctx.advance(1);
    runFrame();
    ticks = 0;
    runFrame();

    expect(ticks).toBe(1);

    ticks = 0;
    runFrame();

    expect(ticks).toBe(1);
  });

  it("reports the frozen position to its listeners on pause", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];
    clock.onTick((t) => seen.push(t));

    clock.play();
    ctx.advance(1);
    runFrame();
    ctx.advance(0.016);
    clock.pause();

    expect(seen.at(-1)).toBe(clock.now());
  });

  it("leaves every listener holding the newest time when one of them seeks", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];
    clock.onTick((t) => {
      if (t !== 0) clock.seek(0);
    });
    clock.onTick((t) => seen.push(t));

    clock.play();
    ctx.advance(1);
    runFrame();

    expect(seen.at(-1)).toBe(clock.now());
    expect(clock.now()).toBe(0);
  });

  it("does not recurse when a listener seeks on every notification", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    let calls = 0;
    clock.onTick((t) => {
      calls += 1;
      clock.seek(t + FLICKS_PER_SECOND);
    });

    clock.play();

    expect(calls).toBeLessThan(10);
    expect(clock.isPlaying).toBe(true);
  });

  it("clamps a seek before the start of the timeline", () => {
    const ctx = new FakeAudioContext();
    const clock = new Clock(ctx);
    const seen: number[] = [];
    clock.onTick((t) => seen.push(t));

    clock.seek(-5 * FLICKS_PER_SECOND);

    expect(clock.now()).toBe(0);
    expect(seen).toEqual([0]);
  });
});
