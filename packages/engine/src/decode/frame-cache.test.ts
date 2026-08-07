import { describe, expect, it } from "vitest";

import { FrameCache } from "./frame-cache";

interface Fake {
  frame: VideoFrame;
  closed: () => boolean;
}

// jsdom has no VideoFrame, and a fake with a real decoder behind it would prove less, not more:
// what is under test here is who closes what, which is bookkeeping and nothing else.
//
// It has to be unfriendly in exactly one respect, though, and that respect is the whole point of
// this file: closing a real VideoFrame zeroes codedWidth and codedHeight. A fake that keeps them
// lets a cache which measures frames on the way out subtract the right number by accident, and
// the budget test then passes over an unbounded cache.
function fakeFrame(width: number, height: number): Fake {
  let closed = false;
  const frame = {
    codedWidth: width,
    codedHeight: height,
    close: () => {
      closed = true;
      frame.codedWidth = 0;
      frame.codedHeight = 0;
    },
  };
  return { frame: frame as unknown as VideoFrame, closed: () => closed };
}

const PIXEL_BYTES = 4;

function bytesOf(width: number, height: number): number {
  return width * height * PIXEL_BYTES;
}

describe("FrameCache", () => {
  it("hands back what was put in", () => {
    const cache = new FrameCache(bytesOf(64, 64) * 4);
    const first = fakeFrame(64, 64);

    cache.put("a", first.frame);

    expect(cache.get("a")).toBe(first.frame);
    expect(first.closed()).toBe(false);
  });

  it("closes the frame it evicts", () => {
    const cache = new FrameCache(bytesOf(64, 64) * 2);
    const oldest = fakeFrame(64, 64);
    cache.put("a", oldest.frame);
    cache.put("b", fakeFrame(64, 64).frame);

    cache.put("c", fakeFrame(64, 64).frame);

    expect(oldest.closed()).toBe(true);
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts least recently used, not least recently put", () => {
    const cache = new FrameCache(bytesOf(64, 64) * 2);
    const first = fakeFrame(64, 64);
    const second = fakeFrame(64, 64);
    cache.put("a", first.frame);
    cache.put("b", second.frame);

    cache.get("a");
    cache.put("c", fakeFrame(64, 64).frame);

    expect(second.closed()).toBe(true);
    expect(first.closed()).toBe(false);
  });

  it("closes the old frame when a key is put again", () => {
    const cache = new FrameCache(bytesOf(64, 64) * 4);
    const old = fakeFrame(64, 64);
    const replacement = fakeFrame(64, 64);
    cache.put("a", old.frame);

    cache.put("a", replacement.frame);

    expect(old.closed()).toBe(true);
    expect(replacement.closed()).toBe(false);
    expect(cache.get("a")).toBe(replacement.frame);
    expect(cache.bytesHeld()).toBe(bytesOf(64, 64));
  });

  it("accounts with the size a frame had going in, not what it reports once closed", () => {
    const cache = new FrameCache(bytesOf(64, 64) * 2);
    cache.put("a", fakeFrame(64, 64).frame);
    cache.put("b", fakeFrame(64, 64).frame);

    cache.put("c", fakeFrame(64, 64).frame);

    expect(cache.bytesHeld()).toBe(bytesOf(64, 64) * 2);
  });

  it("closes everything on clear", () => {
    const cache = new FrameCache(bytesOf(64, 64) * 8);
    const frames = [fakeFrame(64, 64), fakeFrame(32, 32), fakeFrame(16, 16)];
    frames.forEach((fake, index) => cache.put(String(index), fake.frame));

    cache.clear();

    expect(frames.every((fake) => fake.closed())).toBe(true);
    expect(cache.bytesHeld()).toBe(0);
  });

  it("holds the budget across many puts of mixed sizes", () => {
    const budget = bytesOf(640, 320) * 3;
    const cache = new FrameCache(budget);

    for (let index = 0; index < 40; index += 1) {
      const side = index % 2 === 0 ? 320 : 640;
      cache.put(String(index), fakeFrame(side, side / 2).frame);
      expect(cache.bytesHeld()).toBeLessThanOrEqual(budget);
    }
  });

  it("accounts for size per frame and not per entry", () => {
    const cache = new FrameCache(bytesOf(3840, 2160) * 4);

    cache.put("small", fakeFrame(960, 540).frame);
    cache.put("large", fakeFrame(3840, 2160).frame);

    expect(cache.bytesHeld()).toBe(bytesOf(960, 540) + bytesOf(3840, 2160));
  });

  it("keeps a frame that alone exceeds the budget rather than handing back a closed one", () => {
    const cache = new FrameCache(bytesOf(64, 64));
    const oversized = fakeFrame(3840, 2160);

    cache.put("huge", oversized.frame);

    expect(oversized.closed()).toBe(false);
    expect(cache.get("huge")).toBe(oversized.frame);
  });
});
