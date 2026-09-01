import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { putMedia } from "@videola/media";
import { installFakeOpfs } from "@videola/media/src/fake-opfs";

import { tinyMp4 } from "./fixture-mp4";
import { tinyPngBytes } from "./fixture-png";
import { MediaFrames } from "./frames";

const STILL = "e".repeat(64);
const MOVING = "f".repeat(64);
const MISSING = "0".repeat(64);

// Whether the frames come from a decoder or from one `createImageBitmap` is decided on the bytes,
// and that decision is all this class makes. The stub reports being reached; a real decode is the
// browser harness's job, and jsdom would not get past `VideoDecoder` here anyway.
let decoded = 0;

beforeEach(async () => {
  decoded = 0;
  installFakeOpfs();
  // Stored the way OPFS stores everything: bytes under a hash, with no type left on them.
  await putMedia(STILL, tinyPngBytes());
  await putMedia(MOVING, tinyMp4());
  vi.stubGlobal("createImageBitmap", async () => {
    decoded += 1;
    return { width: 8, height: 8, close: () => undefined };
  });
  vi.stubGlobal(
    "VideoFrame",
    class {
      close(): void {
        return undefined;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MediaFrames", () => {
  it("reads a still with one decode of the picture", async () => {
    const frames = new MediaFrames("preview");

    await frames.open(STILL);

    expect(decoded).toBe(1);
    expect(await frames.frameAt(0)).toBeDefined();
    frames.close();
  });

  it("leaves a container to the video decoder", async () => {
    const frames = new MediaFrames("preview");

    await frames.open(MOVING);

    // Nothing was asked of `createImageBitmap`: an mp4 goes to `VideoSource`, which in jsdom gets
    // as far as the container and no further.
    expect(decoded).toBe(0);
    frames.close();
  });

  it("says the medium is missing rather than choosing a source for bytes that are not there", async () => {
    const frames = new MediaFrames("preview");

    await expect(frames.open(MISSING)).rejects.toThrow("error.mediaMissing");
  });

  it("hands nothing back once it is closed", async () => {
    const frames = new MediaFrames("preview");
    await frames.open(STILL);

    frames.close();

    expect(await frames.frameAt(0)).toBeUndefined();
  });
});
