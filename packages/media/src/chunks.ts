// 8 MiB is large enough that the per-chunk overhead disappears next to the copy itself and small
// enough that a two-gigabyte import never holds more than one chunk at a time.
const CHUNK_BYTES = 8 * 1024 * 1024;

// Blob.slice is lazy - it hands back a view, and only arrayBuffer() actually reads. That is what
// keeps both the hash and the OPFS write off the whole-file-in-memory path.
export async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
    yield new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
  }
}
