import type { Project } from "@videola/core";

// The project state and nothing else. A `.videola` every half minute would pull every medium the
// project uses back out of OPFS, re-hash it and zip it -- gigabytes of copying to remember where a
// clip sits. The media are already in storage under their content hash, which is where the
// renderer reads them from, so a snapshot that names them is a snapshot that can be restored.
const SESSION_FILE = "session.json";

export interface Session {
  savedAt: string;
  project: Project;
}

// Written whole and replaced whole. A crash during the write leaves a truncated file, which
// `readSession` reports as nothing rather than as a project -- one lost snapshot, not a document
// that opens into rubbish.
export async function writeSession(project: Project): Promise<void> {
  const body: Session = { savedAt: new Date().toISOString(), project };
  const handle = await sessionFile(true);
  if (handle === undefined) return;
  const writable = await handle.createWritable();
  try {
    await writable.write(new TextEncoder().encode(JSON.stringify(body)));
    await writable.close();
  } catch (error) {
    await writable.abort().catch(ignore);
    throw error;
  }
}

// Anything unreadable is answered as "there is no snapshot": an autosave nobody asked for must
// never be the reason the editor refuses to start. The core still judges the project itself --
// `fromProject` runs the same `normalize` a `.videola` goes through.
export async function readSession(): Promise<Session | undefined> {
  const handle = await sessionFile(false);
  const text = await handle?.getFile().then((file) => file.text());
  if (text === undefined || text === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function clearSession(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(SESSION_FILE).catch(swallowNotFound);
}

// A project with neither a track nor a medium is the state every fresh tab is in, and writing it
// is how a real snapshot gets overwritten by the empty editor that was offering to restore it.
export function worthSaving(project: Project): boolean {
  return project.timeline.tracks.length > 0 || project.library.length > 0;
}

function isSession(value: unknown): value is Session {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Session>;
  return typeof candidate.savedAt === "string" && typeof candidate.project === "object";
}

async function sessionFile(create: boolean): Promise<FileSystemFileHandle | undefined> {
  const root = await navigator.storage.getDirectory();
  return root.getFileHandle(SESSION_FILE, { create }).catch(swallowNotFound);
}

function swallowNotFound(error: unknown): undefined {
  if (error instanceof DOMException && error.name === "NotFoundError") return undefined;
  throw error;
}

function ignore(): undefined {
  return undefined;
}
