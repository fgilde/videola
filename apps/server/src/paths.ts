import { randomBytes } from "node:crypto";
import { mkdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export class PathOutsideRoot extends Error {
  constructor(given: string) {
    super(`path escapes the storage root: ${given}`);
  }
}

// Every file name in a request is untrusted, and the storage root is the whole of the server's
// authority over the file system. Resolving alone is not enough: `resolve` collapses `..`, but a
// symlink inside the root can still point out of it, so containment is checked against the real
// path. For a file about to be written it is the deepest existing ancestor that gets resolved —
// the leaf does not exist yet, and refusing to create new files would be the wrong answer.
export class Storage {
  #root: Promise<string>;

  constructor(root: string) {
    this.#root = realpath(resolve(root));
  }

  root(): Promise<string> {
    return this.#root;
  }

  async forReading(given: string): Promise<string> {
    const target = await this.#joined(given);
    return this.#contained(given, await realpath(target).catch(() => null));
  }

  // Containment is settled before anything is created. Creating the directory first and checking
  // afterwards would leave a refused request having made directories outside the storage root —
  // the refusal is honest, the side effect is not.
  async forWriting(given: string): Promise<string> {
    const target = await this.#joined(given);
    await this.#contained(given, await resolvedAncestor(target));
    await mkdir(dirname(target), { recursive: true });
    return target;
  }

  async #joined(given: string): Promise<string> {
    // The containment check below would refuse an absolute path anyway (`resolve` discards the root
    // for one, landing outside it). This is here so that a hostile path costs no file system call
    // at all — kept deliberately as the cheaper refusal, not as the only one.
    if (given === "" || isAbsolute(given)) throw new PathOutsideRoot(given);
    return resolve(await this.#root, given);
  }

  async #contained(given: string, real: string | null): Promise<string> {
    const root = await this.#root;
    if (real === null || (real !== root && !real.startsWith(root + sep))) {
      throw new PathOutsideRoot(given);
    }
    return real;
  }
}

// The path a file *would* have, with every symlink on the part that already exists resolved. A
// target that does not exist yet cannot be handed to `realpath`, and resolving only its parent is
// not enough either: several levels of it may be missing at once.
async function resolvedAncestor(target: string): Promise<string | null> {
  const missing: string[] = [basename(target)];
  let existing = dirname(target);
  for (;;) {
    const real = await realpath(existing).catch(() => null);
    if (real !== null) return join(real, ...[...missing].reverse());
    const parent = dirname(existing);
    if (parent === existing) return null;
    missing.push(basename(existing));
    existing = parent;
  }
}

// ponytail: a lock table in module scope, so two *processes* sharing a storage root are not
// covered — for that the staging file would have to be claimed with an exclusive create and the
// loser made to wait. Entries are dropped once the chain drains, so this does not grow with the
// number of paths ever written.
const writesInFlight = new Map<string, Promise<unknown>>();

// Two requests saving the same project to the same path can interleave inside a plain `writeFile`
// and leave a file that is half of each. Two answers, and both are needed: the write goes to a
// private staging name and is renamed into place, which keeps a crash mid-write from truncating an
// existing archive; and writers to one path queue, because on Windows two renames onto the same
// target race into EPERM rather than one of them simply winning.
export function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  const queued = (writesInFlight.get(path) ?? Promise.resolve()).then(
    () => stageAndRename(path, bytes),
    () => stageAndRename(path, bytes),
  );
  const settled = queued.then(
    () => undefined,
    () => undefined,
  );
  writesInFlight.set(path, settled);
  void settled.then(() => {
    if (writesInFlight.get(path) === settled) writesInFlight.delete(path);
  });
  return queued;
}

async function stageAndRename(path: string, bytes: Uint8Array): Promise<void> {
  const staging = `${path}.${randomBytes(6).toString("hex")}.part`;
  await writeFile(staging, bytes);
  await rename(staging, path);
}
