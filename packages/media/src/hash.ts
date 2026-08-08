import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { blobChunks } from "./chunks";

// This has to come out byte-identical to Rust's `MediaId::from_bytes` - lowercase hex SHA-256 of
// the entire file - or a project saved in the browser cannot resolve its own media, and the
// mismatch only shows up much later as an asset nobody can find.
//
// That rules out the two shortcuts a large file invites. `crypto.subtle.digest` in one call
// needs the whole two gigabytes resident, and WebCrypto has no incremental digest to fall back
// on; a Merkle tree over chunk digests, or a hash of a prefix, would both scale fine and both
// produce a different number than Rust computes. So the file is fed chunk by chunk into an
// incremental SHA-256 that yields the plain digest of the concatenation.
//
// @noble/hashes rather than a hand-rolled compression function: it is audited, has no
// dependencies of its own, and its streaming interface is exactly this loop. hash.test.ts pins
// the result against `crypto.subtle.digest` and against the Rust core, so the dependency is
// checked rather than trusted.
// ponytail: pure JS SHA-256 runs at roughly 50 to 100 MB/s, so a two-gigabyte import spends
// twenty to forty seconds here and needs a progress indicator rather than a spinner. The upgrade
// path is hash-wasm, whose streaming interface is the same three calls. Better still, and the
// recommendation on record: sha2 is already compiled into videola-core-wasm and already loaded,
// so an incremental hasher exported from there would need no JS dependency, run several times
// faster, and make the agreement with `MediaId::from_bytes` structural instead of test-enforced.
export async function contentHash(blob: Blob): Promise<string> {
  const digest = sha256.create();
  for await (const chunk of blobChunks(blob)) {
    digest.update(chunk);
  }
  return bytesToHex(digest.digest());
}
