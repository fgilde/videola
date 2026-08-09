import { mediaBlob, proxyBlob } from "./opfs";

/**
 * What a decode is for.
 *
 * `preview` is everything the editor draws for a person to look at and then throws away: the
 * programme monitor, the source monitor, a thumbnail. `master` is everything that leaves the
 * program as a file -- the export, a still.
 *
 * There is no default. A new decoder has to say which of the two it is, because the one mistake
 * that matters here is silent: a run that reads a proxy and writes it out as the delivery looks
 * exactly like a correct one until somebody plays the file.
 */
export type Fidelity = "preview" | "master";

// ponytail: process-wide, because it is a person's preference about their own editor and there is
// one editor per page. It cannot reach the export: the export asks for `master`, and `master`
// never consults it. Per-project would need a place in the document, and a proxy is not a property
// of a project -- it is a property of this disk.
let proxiesWanted = true;

/** Whether the preview is allowed to read proxies. The export is not affected either way. */
export function useProxies(wanted: boolean): void {
  proxiesWanted = wanted;
}

export function proxiesInUse(): boolean {
  return proxiesWanted;
}

/**
 * The bytes a decoder should open for this medium, and **the only place in the program where a
 * proxy is ever chosen over an original**. Everything that decodes video comes through here, so
 * there is one answer to "which file is this" rather than one per caller -- and the caller that
 * forgets is a type error, not a wrong file.
 *
 * A missing proxy is not a failure. It is the ordinary state of a medium that was just imported,
 * of one whose proxy the browser evicted, and of every medium at all if the machine cannot encode:
 * the original is opened instead and nothing else in the program can tell.
 */
export async function sourceBlob(hash: string, fidelity: Fidelity): Promise<File | undefined> {
  if (fidelity === "preview" && proxiesWanted) {
    const proxy = await proxyBlob(hash);
    if (proxy !== undefined) return proxy;
  }
  return mediaBlob(hash);
}
