import { blobChunks } from "./chunks";

const MEDIA_DIR = "media";

// The same canonical form the core requires (`format::reader::is_content_hash`), minus the
// `med_` prefix: the entry name is the content hash and nothing else, so an asset in OPFS and
// the same asset in a project file are literally the same thing and a video imported into two
// projects occupies one entry on disk. Checked here rather than trusted from the caller, because
// this string is interpolated straight into a filesystem path.
const CONTENT_HASH = /^[0-9a-f]{64}$/;

const ID_PREFIX = "med_";

// A MediaId is the prefix plus the content hash (`import::describeAsset`). Anything else is a
// library entry OPFS was never asked to hold -- a generator, or a project written by something
// that made ids up -- and the caller has to cope with its absence rather than build a path out
// of it.
export function mediaHash(assetId: string): string | undefined {
  const hash = assetId.startsWith(ID_PREFIX) ? assetId.slice(ID_PREFIX.length) : "";
  return CONTENT_HASH.test(hash) ? hash : undefined;
}

export async function putMedia(
  hash: string,
  content: Uint8Array<ArrayBuffer> | Blob,
): Promise<void> {
  const existed = await hasMedia(hash);
  const handle = await fileHandle(hash, true);
  const writable = await handle.createWritable();
  try {
    await writeAll(writable, content);
    await writable.close();
  } catch (error) {
    await rollback(writable, hash, existed);
    throw error;
  }
}

export async function getMedia(hash: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const file = await mediaFile(hash);
  return file === undefined ? undefined : new Uint8Array(await file.arrayBuffer());
}

// The lazy counterpart to getMedia, and the one every consumer that reads a whole video wants:
// a Blob is a handle, so a demuxer or decoder slices what it needs instead of pulling a
// two-gigabyte file into the heap to find its duration.
export async function mediaBlob(hash: string): Promise<File | undefined> {
  return mediaFile(hash);
}

export async function hasMedia(hash: string): Promise<boolean> {
  return (await mediaFile(hash)) !== undefined;
}

export async function mediaSize(hash: string): Promise<number | undefined> {
  return (await mediaFile(hash))?.size;
}

// OPFS is per origin, not per project. Two projects that use the same video share this entry,
// which is the point of content addressing - but it also means removing a medium from one
// project must never touch the bytes, because the other project still needs them. Nothing in M1
// calls this: `media.remove` drops the library entry and leaves the file alone. It exists for a
// later cleanup command that can see every project at once and decide what is truly unreachable.
export async function deleteMedia(hash: string): Promise<void> {
  await removeEntry(hash);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

async function writeAll(
  writable: FileSystemWritableFileStream,
  content: Uint8Array<ArrayBuffer> | Blob,
): Promise<void> {
  if (!(content instanceof Blob)) {
    await writable.write(content);
    return;
  }
  for await (const chunk of blobChunks(content)) {
    await writable.write(chunk);
  }
}

// A quota failure must not look like a stored medium. Aborting restores whatever the entry held
// before, so an entry that was already there survives untouched - but `getFileHandle` with
// `create` leaves a zero-byte file behind when the write never completed, and `hasMedia` would
// then claim bytes we do not have. Only the entry this call brought into existence is dropped.
async function rollback(
  writable: FileSystemWritableFileStream,
  hash: string,
  existed: boolean,
): Promise<void> {
  await writable.abort().catch(ignore);
  if (!existed) {
    await removeEntry(hash).catch(ignore);
  }
}

async function removeEntry(hash: string): Promise<void> {
  const dir = await mediaDir(false);
  await dir?.removeEntry(entryName(hash)).catch(swallowNotFound);
}

async function mediaFile(hash: string): Promise<File | undefined> {
  const dir = await mediaDir(false);
  const handle = await dir?.getFileHandle(entryName(hash)).catch(swallowNotFound);
  return handle?.getFile();
}

async function fileHandle(hash: string, create: boolean): Promise<FileSystemFileHandle> {
  const dir = await mediaDir(create);
  if (dir === undefined) throw new Error("error.mediaStoreUnavailable");
  return dir.getFileHandle(entryName(hash), { create });
}

async function mediaDir(create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MEDIA_DIR, { create }).catch(swallowNotFound);
}

function entryName(hash: string): string {
  if (!CONTENT_HASH.test(hash)) {
    throw new TypeError("error.mediaHashInvalid");
  }
  return hash;
}

function swallowNotFound(error: unknown): undefined {
  if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
  throw error;
}

function ignore(): undefined {
  return undefined;
}
