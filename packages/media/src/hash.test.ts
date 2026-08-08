import { webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

import { contentHash } from "./hash";

// jsdom ships no SubtleCrypto, so the oracle comes from Node directly. It is the whole point of
// this file: the incremental digest has to agree with a single-shot SHA-256 over the same bytes,
// including across a chunk boundary, or the ids drift away from Rust's `MediaId::from_bytes`.
async function digestHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pattern(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + 7) & 0xff;
  return bytes;
}

describe("contentHash", () => {
  it("hashes an empty blob to the known SHA-256 of nothing", async () => {
    expect(await contentHash(new Blob([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("agrees with a single-shot digest for a small input", async () => {
    const bytes = pattern(1024);
    expect(await contentHash(new Blob([bytes]))).toBe(await digestHex(bytes));
  });

  it("agrees with a single-shot digest across a chunk boundary", async () => {
    const bytes = pattern(8 * 1024 * 1024 + 12345);
    expect(await contentHash(new Blob([bytes]))).toBe(await digestHex(bytes));
  });

  it("produces lowercase hex of the canonical length", async () => {
    expect(await contentHash(new Blob([pattern(17)]))).toMatch(/^[0-9a-f]{64}$/);
  });
});
