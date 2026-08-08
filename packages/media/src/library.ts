import type { MediaAsset, MediaId } from "@videola/core";

import { contentHash } from "./hash";
import { hasMedia, mediaHash, putMedia } from "./opfs";

// Which library entries have nothing behind them. Not the load warning: that one is a snapshot of
// what a `.videola` carried, while everything that decodes, draws or exports reads OPFS -- and a
// project opened on a second machine has its media in the core and not on this disk.
export async function missingMedia(library: readonly MediaAsset[]): Promise<Set<MediaId>> {
  const missing = new Set<MediaId>();
  for (const asset of library) {
    const hash = mediaHash(asset.id);
    if (hash === undefined || !(await hasMedia(hash))) missing.add(asset.id);
  }
  return missing;
}

// Bytes back under an id that lost them. It has to be the same file: the id *is* the hash of the
// content, so any other file would be a different medium wearing this one's name, and every clip
// pointing at it would quietly show the wrong picture.
export async function relinkMedia(media: MediaId, file: File): Promise<void> {
  const hash = mediaHash(media);
  if (hash === undefined || (await contentHash(file)) !== hash) {
    throw new Error("error.mediaRelinkMismatch");
  }
  await putMedia(hash, file);
}
