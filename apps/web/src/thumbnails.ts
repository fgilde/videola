import { useEffect, useRef, useState } from "react";

import { thumbnail } from "@videola/engine";
import { mediaBlob, mediaHash } from "@videola/media";

import type { MediaAsset, MediaId } from "@videola/core";

/**
 * One still per medium in the library, as object URLs. A medium whose frame could not be had is
 * absent rather than mapped to a placeholder -- the library draws nothing for those on purpose.
 *
 * Each medium is decoded once and kept for as long as the tab lives. The id is the hash of the
 * bytes, so a picture under an id cannot go stale.
 */
export function useThumbnails(library: readonly MediaAsset[]): ReadonlyMap<MediaId, string> {
  const [urls, setUrls] = useState<ReadonlyMap<MediaId, string>>(new Map());
  // Which media have been through `still` already, whether or not one came out. Without the
  // failures in here a medium with no video track is re-decoded on every project state.
  const seen = useRef(new Set<MediaId>());
  const live = useRef<ReadonlyMap<MediaId, string>>(urls);
  live.current = urls;
  // Keyed on the ids rather than on the library array: the core hands back a fresh project on
  // every dispatch, so a drag across the timeline would otherwise re-run this per pointer move.
  const ids = library.map((asset) => asset.id).join(" ");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const id of ids === "" ? [] : ids.split(" ")) {
        if (cancelled) return;
        if (seen.current.has(id)) continue;
        seen.current.add(id);
        const made = await still(id);
        if (made === undefined) continue;
        // Not `cancelled`: the effect re-runs on every import, and dropping a finished picture
        // because the library grew would leave that medium without one forever.
        setUrls((current) => new Map(current).set(id, made));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  // Only when the tab goes away. Revoking on a library change would break the picture of every
  // medium that survived the edit, and an id is a content hash -- it never points at other bytes.
  useEffect(() => {
    return () => {
      for (const url of live.current.values()) URL.revokeObjectURL(url);
    };
  }, []);

  return urls;
}

async function still(media: MediaId): Promise<string | undefined> {
  try {
    const hash = mediaHash(media);
    if (hash === undefined) return undefined;
    const blob = await mediaBlob(hash);
    if (blob === undefined) return undefined;
    const image = await thumbnail(blob);
    return image === undefined ? undefined : URL.createObjectURL(image);
  } catch {
    // A medium this build cannot decode still belongs in the list with its name and its length.
    return undefined;
  }
}
