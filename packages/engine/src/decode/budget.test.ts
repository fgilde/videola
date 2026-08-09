import { describe, expect, it } from "vitest";

import { framesWithin, MIN_CACHED_FRAMES, PROXY_MAX_HEIGHT } from "../index";
import { DEFAULT_FRAME_BUDGET_BYTES, FrameCache } from "./frame-cache";

// One frame of a given size, sized the way the cache sizes it: `codedWidth * codedHeight * 4`.
// jsdom has no VideoFrame, and this needs none -- what the cache reads of a frame is two numbers
// and a close.
function framed(width: number, height: number): VideoFrame {
  return { codedWidth: width, codedHeight: height, close: () => undefined } as unknown as VideoFrame;
}

describe("the frame budget", () => {
  // The whole argument for proxies, as a number. 4K frames cost sixteen times what 1080p ones do
  // and nine times what 720p ones do, and the cache is sized in bytes, so that ratio is exactly
  // how much less of a scrub survives in memory.
  it("holds nine times as many 720p frames as 4K ones", () => {
    expect(framesWithin(3840, 2160)).toBe(8);
    expect(framesWithin(1920, 1080)).toBe(32);
    expect(framesWithin(1280, PROXY_MAX_HEIGHT)).toBe(72);
  });

  // The budget with teeth: the proxy size clears it and the material it is made from does not.
  it("is met at the proxy size and missed at 4K", () => {
    expect(framesWithin(1280, PROXY_MAX_HEIGHT)).toBeGreaterThanOrEqual(MIN_CACHED_FRAMES);
    expect(framesWithin(3840, 2160)).toBeLessThan(MIN_CACHED_FRAMES);
  });

  it("counts nothing for a frame with no pixels", () => {
    expect(framesWithin(0, 0)).toBe(0);
  });

  // The arithmetic above is worth nothing if the cache does not behave that way. This is the same
  // number, measured on the cache instead of computed.
  it("is the number the cache really holds", () => {
    const cache = new FrameCache(DEFAULT_FRAME_BUDGET_BYTES);

    for (let index = 0; index < 200; index += 1) {
      cache.put(String(index), framed(1280, PROXY_MAX_HEIGHT));
    }

    expect(cache.framesHeld()).toBe(framesWithin(1280, PROXY_MAX_HEIGHT));
  });

  it("and the number it really holds of the material a proxy is made from", () => {
    const cache = new FrameCache(DEFAULT_FRAME_BUDGET_BYTES);

    for (let index = 0; index < 200; index += 1) {
      cache.put(String(index), framed(3840, 2160));
    }

    expect(cache.framesHeld()).toBe(framesWithin(3840, 2160));
  });
});
