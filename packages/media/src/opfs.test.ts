import { beforeEach, describe, expect, it } from "vitest";

import { installFakeOpfs } from "./fake-opfs";
import {
  deleteMedia,
  getMedia,
  hasMedia,
  mediaBlob,
  mediaSize,
  putMedia,
  storageEstimate,
} from "./opfs";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

describe("OPFS media store", () => {
  beforeEach(() => {
    installFakeOpfs();
  });

  it("reads back exactly what was written", async () => {
    await putMedia(HASH, bytes(1, 2, 3, 250));
    expect(await getMedia(HASH)).toEqual(bytes(1, 2, 3, 250));
  });

  it("writes the same content twice without doubling it", async () => {
    await putMedia(HASH, bytes(7, 7, 7));
    await putMedia(HASH, bytes(7, 7, 7));
    expect(await getMedia(HASH)).toEqual(bytes(7, 7, 7));
    expect(await mediaSize(HASH)).toBe(3);
  });

  it("reports an unknown hash as absent", async () => {
    await putMedia(HASH, bytes(1));
    expect(await hasMedia(OTHER)).toBe(false);
    expect(await getMedia(OTHER)).toBeUndefined();
    expect(await mediaSize(OTHER)).toBeUndefined();
  });

  it("stores a blob in chunks", async () => {
    await putMedia(HASH, new Blob([bytes(1, 2), bytes(3)]));
    expect(await getMedia(HASH)).toEqual(bytes(1, 2, 3));
  });

  it("hands out a blob handle without reading the whole entry", async () => {
    await putMedia(HASH, bytes(9, 8, 7));
    expect(await (await mediaBlob(HASH))?.arrayBuffer()).toEqual(bytes(9, 8, 7).buffer);
    expect(await mediaBlob(OTHER)).toBeUndefined();
  });

  it("rejects a hash that is not a canonical content hash", async () => {
    await expect(putMedia("../escape", bytes(1))).rejects.toThrow(TypeError);
    await expect(hasMedia("ABCD")).rejects.toThrow(TypeError);
  });

  it("surfaces a quota failure instead of losing the write silently", async () => {
    installFakeOpfs(4);
    await expect(putMedia(HASH, bytes(1, 2, 3, 4, 5))).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect(await hasMedia(HASH)).toBe(false);
  });

  it("keeps an entry that was already there when a rewrite runs out of quota", async () => {
    installFakeOpfs(100);
    await putMedia(HASH, bytes(1, 2, 3));
    await expect(putMedia(HASH, new Uint8Array(200))).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect(await getMedia(HASH)).toEqual(bytes(1, 2, 3));
  });

  it("estimates usage and quota", async () => {
    installFakeOpfs(1000);
    await putMedia(HASH, bytes(1, 2, 3));
    expect(await storageEstimate()).toEqual({ usage: 3, quota: 1000 });
  });

  it("deletes an entry when a cleanup command asks for it", async () => {
    await putMedia(HASH, bytes(1));
    await deleteMedia(HASH);
    expect(await hasMedia(HASH)).toBe(false);
    await expect(deleteMedia(HASH)).resolves.toBeUndefined();
  });
});
