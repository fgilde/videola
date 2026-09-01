import { beforeEach, describe, expect, it, vi } from "vitest";

import { FLICKS_PER_SECOND } from "@videola/core";
import { putMedia } from "@videola/media";
import { installFakeOpfs } from "@videola/media/src/fake-opfs";

import { tinyMp4 } from "./fixture-mp4";

import { tinyPng, tinyPngBytes } from "./fixture-png";
import { ImageSource, isStill, looksLikeStill, probeStill, STILL_DURATION } from "./image-source";

const HASH = "c".repeat(64);
const MISSING = "d".repeat(64);

// jsdom has neither `createImageBitmap` nor `VideoFrame`, so both are stood in for. What that
// leaves testable is everything this class decides -- which file it opens, how often it decodes,
// what it hands back at an instant, and what it closes -- while the browser harness draws a real
// picture through a real decoder.
interface Fake {
  bitmaps: number;
  closed: number;
  frames: FakeFrame[];
}

interface FakeFrame {
  from: unknown;
  closed: boolean;
}

function stubImageDecoding(): Fake {
  const fake: Fake = { bitmaps: 0, closed: 0, frames: [] };
  vi.stubGlobal("createImageBitmap", async (source: Blob) => {
    fake.bitmaps += 1;
    return {
      width: 640,
      height: 360,
      source,
      close: () => {
        fake.closed += 1;
      },
    };
  });
  vi.stubGlobal(
    "VideoFrame",
    class {
      closed = false;
      constructor(public from: unknown) {
        fake.frames.push(this as unknown as FakeFrame);
      }
      close(): void {
        this.closed = true;
      }
    },
  );
  return fake;
}

const png = tinyPng;

describe("isStill", () => {
  it("goes by the type and not by the name", () => {
    expect(isStill(png())).toBe(true);
    expect(isStill(new File(["x"], "logo.png", { type: "video/mp4" }))).toBe(false);
    expect(isStill(new File(["x"], "clip.mov", { type: "video/quicktime" }))).toBe(false);
  });
});

describe("looksLikeStill", () => {
  it("knows a picture with no type and no name, which is how OPFS hands one back", async () => {
    expect(await looksLikeStill(tinyPngBytes())).toBe(true);
  });

  it("leaves a container to the demuxer", async () => {
    expect(await looksLikeStill(new File([tinyMp4()], ""))).toBe(false);
  });

  it("tells an AVIF from an mp4, which start the same way", async () => {
    expect(await looksLikeStill(ftyp("avif"))).toBe(true);
    expect(await looksLikeStill(ftyp("isom"))).toBe(false);
  });

  it("is not fooled by a file that only claims to be a picture", async () => {
    expect(await looksLikeStill(new File(["not a picture at all"], ""))).toBe(false);
  });
});

// The first twelve bytes of an ISO base media file: a length, `ftyp`, and the brand that says what
// kind of file it is.
function ftyp(brand: string): File {
  const head = new Uint8Array([0, 0, 0, 0x14, ...[..."ftyp" + brand].map((c) => c.charCodeAt(0))]);
  return new File([head], "");
}

describe("probeStill", () => {
  it("reports the size of the picture and a length nobody measured", async () => {
    stubImageDecoding();

    const probed = await probeStill(png());

    expect(probed.video).toEqual({ codec: "image", width: 640, height: 360 });
    expect(probed.duration).toBe(STILL_DURATION);
    expect(STILL_DURATION).toBe(FLICKS_PER_SECOND * 5);
  });

  it("leaves no bitmap open behind it", async () => {
    const fake = stubImageDecoding();

    await probeStill(png());

    expect(fake.closed).toBe(1);
  });
});

describe("ImageSource", () => {
  beforeEach(async () => {
    installFakeOpfs();
    await putMedia(HASH, png());
  });

  it("says the medium is missing rather than opening nothing", async () => {
    stubImageDecoding();
    const source = new ImageSource();

    await expect(source.open(MISSING)).rejects.toThrow("error.mediaMissing");
  });

  it("decodes once and hands the same picture back at every instant", async () => {
    const fake = stubImageDecoding();
    const source = new ImageSource();

    await source.open(HASH);
    const first = await source.frameAt();
    const later = await source.frameAt();

    expect(fake.bitmaps).toBe(1);
    expect(first).toBe(later);
    expect(fake.frames).toHaveLength(1);
  });

  it("closes the picture it holds and nothing else is left open", async () => {
    const fake = stubImageDecoding();
    const source = new ImageSource();
    await source.open(HASH);

    source.close();

    expect(fake.frames[0]?.closed).toBe(true);
    expect(await source.frameAt()).toBeUndefined();
    // The bitmap goes back the moment the frame has copied it, not at close: holding both would be
    // the picture twice in memory for as long as the clip is in the project.
    expect(fake.closed).toBe(1);
  });
});
