import { describe, expect, it } from "vitest";

import type { MediaAsset } from "@videola/core";

import { installFakeOpfs } from "./fake-opfs";
import { contentHash } from "./hash";
import { missingMedia, relinkMedia } from "./library";
import { getMedia, putMedia } from "./opfs";

const ALIEN = "b".repeat(64);

function asset(id: string): MediaAsset {
  return {
    id,
    originalName: "clip.mp4",
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 3n,
    duration: 1,
    width: 640,
    height: 360,
    fps: { numerator: 30, denominator: 1 },
    sampleRate: null,
    channels: null,
  };
}

async function stored(file: File): Promise<MediaAsset> {
  const hash = await contentHash(file);
  await putMedia(hash, file);
  return asset(`med_${hash}`);
}

describe("missingMedia", () => {
  it("names the entries OPFS has no bytes for and leaves the rest alone", async () => {
    installFakeOpfs();
    const here = await stored(new File(["one"], "one.mp4", { type: "video/mp4" }));
    const gone = asset(`med_${ALIEN}`);

    expect([...(await missingMedia([here, gone]))]).toEqual([gone.id]);
  });

  it("counts an entry whose id is no content hash as missing, because nothing can serve it", async () => {
    installFakeOpfs();

    expect([...(await missingMedia([asset("gen_colourbars")]))]).toEqual(["gen_colourbars"]);
  });
});

describe("relinkMedia", () => {
  it("puts the bytes back where the id says they belong", async () => {
    installFakeOpfs();
    const file = new File(["one"], "one.mp4", { type: "video/mp4" });
    const id = `med_${await contentHash(file)}`;

    await relinkMedia(id, file);

    expect(await missingMedia([asset(id)])).toEqual(new Set());
    expect(await getMedia(await contentHash(file))).toEqual(new Uint8Array([111, 110, 101]));
  });

  // The id is the hash of the content, so another file wearing it would put every clip that
  // points at this medium on a picture that is not theirs.
  it("refuses a file that is not the medium it was asked for", async () => {
    installFakeOpfs();
    const id = `med_${await contentHash(new File(["one"], "one.mp4"))}`;

    await expect(relinkMedia(id, new File(["two"], "two.mp4"))).rejects.toThrow(
      "error.mediaRelinkMismatch",
    );
    expect(await missingMedia([asset(id)])).toEqual(new Set([id]));
  });

  it("refuses an id that was never a content hash", async () => {
    installFakeOpfs();

    await expect(relinkMedia("gen_colourbars", new File(["one"], "one.mp4"))).rejects.toThrow(
      "error.mediaRelinkMismatch",
    );
  });
});
