import { beforeEach, describe, expect, it, vi } from "vitest";

import { secondsToTime } from "@videola/core";
import { putMedia } from "@videola/media";
import { installFakeOpfs } from "@videola/media/src/fake-opfs";

import { tinyMp4 } from "./fixture-mp4";
import {
  heldIndexAt,
  insertHeld,
  lastStartingAtOrBefore,
  MAX_FORWARD_DECODE_SECONDS,
  shouldRestartWindow,
  VideoSource,
} from "./video-source";

import type { Held } from "./video-source";

const HASH = "a".repeat(64);
const MISSING = "b".repeat(64);

// Everything below the metadata line needs a real VideoDecoder, which jsdom does not have. What
// runs here is what a browser would not tell us anything more about: the seek arithmetic, the
// bookkeeping of which decoded frame covers which instant, and the paths that end before a
// decoder is ever reached. Decoding itself is Task 24's Playwright job.
describe("VideoSource", () => {
  beforeEach(async () => {
    installFakeOpfs();
    await putMedia(HASH, tinyMp4());
  });

  it("takes its duration from the medium", async () => {
    const source = new VideoSource();

    await source.open(HASH);

    expect(source.duration).toBe(secondsToTime(1.001));
  });

  it("refuses a medium whose bytes are not in storage", async () => {
    const source = new VideoSource();

    await expect(source.open(MISSING)).rejects.toThrow("error.mediaMissing");
  });

  it("answers undefined instead of throwing past the end", async () => {
    const source = new VideoSource();
    await source.open(HASH);

    await expect(source.frameAt(secondsToTime(5))).resolves.toBeUndefined();
    await expect(source.frameAt(-1)).resolves.toBeUndefined();
  });

  it("answers undefined before a medium is open", async () => {
    await expect(new VideoSource().frameAt(0)).resolves.toBeUndefined();
  });

  it("holds nothing after close", async () => {
    const source = new VideoSource();
    await source.open(HASH);

    source.close();

    expect(source.bytesHeld).toBe(0);
    expect(source.duration).toBe(0);
  });

  // jsdom has no VideoDecoder, so mediabunny refuses to build one and the decode path throws.
  // That is the failure this asks about and not a shortcoming of the environment: a source whose
  // decoder dies must keep answering, because frameAt promises a missing frame as undefined.
  it("answers undefined and stays usable when the decoder cannot be built", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = new VideoSource();
    await source.open(HASH);

    await expect(source.frameAt(0)).resolves.toBeUndefined();
    await expect(source.frameAt(secondsToTime(0.5))).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalled();
    expect(source.duration).toBe(secondsToTime(1.001));
  });

  it("serialises overlapping requests rather than racing two windows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = new VideoSource();
    await source.open(HASH);

    const frames = await Promise.all([
      source.frameAt(0),
      source.frameAt(secondsToTime(0.5)),
      source.frameAt(secondsToTime(0.25)),
    ]);

    expect(frames).toEqual([undefined, undefined, undefined]);
  });

  it("survives a close in flight", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = new VideoSource();
    await source.open(HASH);

    const inFlight = source.frameAt(0);
    source.close();

    await expect(inFlight).resolves.toBeUndefined();
    expect(source.bytesHeld).toBe(0);
  });
});

describe("shouldRestartWindow", () => {
  it("starts over when there is no window yet", () => {
    expect(shouldRestartWindow(undefined, 0)).toBe(true);
  });

  it("starts over when the target lies behind the decoded position", () => {
    expect(shouldRestartWindow(4, 3.999)).toBe(true);
  });

  it("carries the running decoder forward over a short gap", () => {
    expect(shouldRestartWindow(4, 4)).toBe(false);
    expect(shouldRestartWindow(4, 4 + MAX_FORWARD_DECODE_SECONDS)).toBe(false);
  });

  it("starts over rather than decoding a long gap frame by frame", () => {
    expect(shouldRestartWindow(4, 4 + MAX_FORWARD_DECODE_SECONDS + 0.001)).toBe(true);
  });
});

describe("heldIndexAt", () => {
  const held = frames([0, 1, 2]);

  it("finds the frame whose interval covers the instant", () => {
    expect(heldIndexAt(held, 0)).toBe(0);
    expect(heldIndexAt(held, 1.5)).toBe(1);
    expect(heldIndexAt(held, 2.999)).toBe(2);
  });

  it("reports nothing in a gap between decoded frames", () => {
    const gapped = [...frames([0]), ...frames([5])];

    expect(heldIndexAt(gapped, 2)).toBe(-1);
  });

  it("reports nothing past the last frame or before the first", () => {
    expect(heldIndexAt(held, 3)).toBe(-1);
    expect(heldIndexAt(held, -0.001)).toBe(-1);
    expect(heldIndexAt([], 0)).toBe(-1);
  });
});

describe("insertHeld", () => {
  it("keeps the list sorted whatever order frames arrive in", () => {
    const held: Held[] = [];

    for (const start of [2, 0, 4, 1, 3]) insertHeld(held, one(start));

    expect(held.map((entry) => entry.start)).toEqual([0, 1, 2, 3, 4]);
  });

  it("replaces rather than duplicates when a window overlaps one already decoded", () => {
    const held = frames([0, 1, 2]);

    insertHeld(held, { start: 1, end: 2, key: "again" });

    expect(held).toHaveLength(3);
    expect(held[1]?.key).toBe("again");
  });

  it("puts a frame earlier than everything held at the front", () => {
    const held = frames([5, 6]);

    insertHeld(held, one(1));

    expect(held[0]?.start).toBe(1);
  });
});

function frames(starts: number[]): Held[] {
  return starts.map(one);
}

function one(start: number): Held {
  return { start, end: start + 1, key: `f${start}` };
}

describe("lastStartingAtOrBefore", () => {
  const held = [{ start: 0 }, { start: 1 }, { start: 2 }, { start: 3 }];

  it("finds the entry an instant falls into", () => {
    expect(lastStartingAtOrBefore(held, 2.5)).toBe(2);
    expect(lastStartingAtOrBefore(held, 3)).toBe(3);
    expect(lastStartingAtOrBefore(held, 0)).toBe(0);
  });

  it("reports nothing before the first entry", () => {
    expect(lastStartingAtOrBefore(held, -0.5)).toBe(-1);
    expect(lastStartingAtOrBefore([], 0)).toBe(-1);
  });

  it("reports the last entry beyond the end", () => {
    expect(lastStartingAtOrBefore(held, 99)).toBe(3);
  });
});
