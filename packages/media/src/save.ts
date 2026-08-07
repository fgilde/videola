import type { MediaBytes, Project } from "@videola/core";

import { getMedia } from "./opfs";

// Mirrors `reader::MAX_TOTAL_MEDIA_BYTES` (crates/videola-core/src/format/reader.rs). Checked
// against the library's recorded sizes before a single byte is read, because a cap that only
// fires once the data is in memory has already lost.
const MAX_TOTAL_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;

const CANONICAL_ID = /^med_[0-9a-f]{64}$/;

// ponytail: this pulls every medium the project references into memory for the length of the
// save -- `writer::write` takes each entry as an owned Vec<u8>, so OPFS buys nothing on this one
// path. The way out is a streaming writer that accepts a Blob per entry and pushes it into the
// ZIP, at which point this can hand over handles instead of bytes.
export async function mediaForProject(project: Project): Promise<MediaBytes> {
  requireWritableTotal(project);
  const media: MediaBytes = new Map();
  for (const asset of project.library) {
    // An entry whose bytes OPFS does not have is left out rather than failing here: a project
    // opened from a .videola still carries its media inside the core, and the writer falls back
    // to those. A medium neither side holds fails in the writer, which names the id.
    if (!CANONICAL_ID.test(asset.id)) continue;
    const bytes = await getMedia(asset.id.slice("med_".length));
    if (bytes !== undefined) media.set(asset.id, bytes);
  }
  return media;
}

function requireWritableTotal(project: Project): void {
  const total = project.library.reduce((sum, asset) => sum + Number(asset.sizeBytes), 0);
  if (total > MAX_TOTAL_MEDIA_BYTES) throw new RangeError("error.mediaTooLarge");
}
