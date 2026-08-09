import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installFakeOpfs } from "./fake-opfs";
import { missingMedia } from "./library";
import {
  deleteProxy,
  hasMedia,
  hasProxy,
  mediaSize,
  proxySize,
  putMedia,
  putProxy,
} from "./opfs";
import { proxiesInUse, sourceBlob, useProxies } from "./proxy";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);

const ORIGINAL = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const PROXY = new Uint8Array([9, 9]);

async function bytesOf(blob: File | undefined): Promise<number[]> {
  return blob === undefined ? [] : Array.from(new Uint8Array(await blob.arrayBuffer()));
}

describe("the proxy store", () => {
  beforeEach(() => {
    installFakeOpfs();
    useProxies(true);
  });

  afterEach(() => {
    useProxies(true);
  });

  it("keeps the proxy beside the original rather than over it", async () => {
    await putMedia(HASH, ORIGINAL);
    await putProxy(HASH, PROXY);

    expect(await mediaSize(HASH)).toBe(ORIGINAL.length);
    expect(await proxySize(HASH)).toBe(PROXY.length);
  });

  // The proxy is named after the medium it was made from, and that is the whole mapping. A store
  // that keyed them together would hand a proxy out under the original's own name, which is the
  // one thing a content hash may never mean.
  it("keeps the two stores apart", async () => {
    await putProxy(HASH, PROXY);

    expect(await hasProxy(HASH)).toBe(true);
    expect(await hasMedia(HASH)).toBe(false);
  });

  // A medium whose bytes are gone is missing whether or not a proxy of it survives: a proxy cannot
  // be exported, cannot be saved into a .videola, and is not the material.
  it("does not let a proxy pass for the medium it was made from", async () => {
    await putProxy(HASH, PROXY);

    expect(await missingMedia([`med_${HASH}`])).toEqual(new Set([`med_${HASH}`]));
  });
});

describe("which file a decode opens", () => {
  beforeEach(async () => {
    installFakeOpfs();
    useProxies(true);
    await putMedia(HASH, ORIGINAL);
  });

  afterEach(() => {
    useProxies(true);
  });

  it("gives the preview the proxy", async () => {
    await putProxy(HASH, PROXY);

    expect(await bytesOf(await sourceBlob(HASH, "preview"))).toEqual([9, 9]);
  });

  it("gives the master the original even when a proxy is there", async () => {
    await putProxy(HASH, PROXY);

    expect(await bytesOf(await sourceBlob(HASH, "master"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives the preview the original when there is no proxy", async () => {
    expect(await bytesOf(await sourceBlob(HASH, "preview"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("goes back to the original when a proxy is dropped", async () => {
    await putProxy(HASH, PROXY);
    await deleteProxy(HASH);

    expect(await bytesOf(await sourceBlob(HASH, "preview"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("gives the preview the original once proxies are switched off", async () => {
    await putProxy(HASH, PROXY);
    useProxies(false);

    expect(proxiesInUse()).toBe(false);
    expect(await bytesOf(await sourceBlob(HASH, "preview"))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  // Switching proxies off must not be able to conjure bytes, and switching them on must not be
  // able to hide their absence.
  it("answers nothing for a medium neither store has", async () => {
    expect(await sourceBlob(OTHER, "preview")).toBeUndefined();
    expect(await sourceBlob(OTHER, "master")).toBeUndefined();
  });

  // A proxy without its original is a preview of something that can no longer be exported. It is
  // still worth showing -- the alternative is a black clip where the editor could tell the person
  // what they are missing -- but the master path must not find it.
  it("shows a proxy whose original is gone, and never exports it", async () => {
    installFakeOpfs();
    await putProxy(HASH, PROXY);

    expect(await bytesOf(await sourceBlob(HASH, "preview"))).toEqual([9, 9]);
    expect(await sourceBlob(HASH, "master")).toBeUndefined();
  });
});
