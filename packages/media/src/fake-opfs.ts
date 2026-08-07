// jsdom has no OPFS, so the tests in this package run against a fake of the
// `navigator.storage.getDirectory` chain. Test-only support code: nothing here is re-exported
// from index.ts, so it cannot reach a bundle. It lives beside the tests rather than inside one
// because both opfs.test.ts and import.test.ts need it.
//
// It copies the two behaviours the production code actually depends on: `getFileHandle` with
// `create` materialises a zero-byte entry immediately, and a writable commits only on `close`,
// so `abort` leaves whatever the entry held before.

const NOT_FOUND = "NotFoundError";
const QUOTA_EXCEEDED = "QuotaExceededError";

export interface FakeOpfs {
  root: FakeDirectory;
  quotaBytes: number;
  // Every committed write, in order, so a test can assert that bytes land before the dispatch.
  log: string[];
}

export function installFakeOpfs(quotaBytes = Number.MAX_SAFE_INTEGER): FakeOpfs {
  const fake: FakeOpfs = { root: new FakeDirectory(), quotaBytes, log: [] };
  fake.root.attach(fake);
  const storage = {
    getDirectory: async () => fake.root,
    estimate: async () => ({ usage: usageOf(fake.root), quota: fake.quotaBytes }),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage },
  });
  return fake;
}

export class FakeDirectory {
  readonly dirs = new Map<string, FakeDirectory>();
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>();
  #opfs: FakeOpfs | undefined;

  attach(opfs: FakeOpfs): void {
    this.#opfs = opfs;
  }

  get opfs(): FakeOpfs {
    if (this.#opfs === undefined) throw new Error("fake directory is not attached");
    return this.#opfs;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    const existing = this.dirs.get(name);
    if (existing !== undefined) return existing;
    if (options?.create !== true) throw fail(NOT_FOUND);
    const created = new FakeDirectory();
    created.attach(this.opfs);
    this.dirs.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    if (!this.files.has(name)) {
      if (options?.create !== true) throw fail(NOT_FOUND);
      this.files.set(name, new Uint8Array());
    }
    return new FakeFileHandle(this, name);
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw fail(NOT_FOUND);
  }
}

class FakeFileHandle {
  constructor(
    private readonly dir: FakeDirectory,
    private readonly name: string,
  ) {}

  async getFile(): Promise<File> {
    return new File([this.dir.files.get(this.name) ?? new Uint8Array()], this.name);
  }

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable(this.dir, this.name);
  }
}

class FakeWritable {
  #parts: Uint8Array<ArrayBuffer>[] = [];
  #pending = 0;

  constructor(
    private readonly dir: FakeDirectory,
    private readonly name: string,
  ) {}

  async write(chunk: Uint8Array<ArrayBuffer>): Promise<void> {
    this.#pending += chunk.byteLength;
    const root = this.dir.opfs;
    if (usageOf(root.root) + this.#pending > root.quotaBytes) throw fail(QUOTA_EXCEEDED);
    this.#parts.push(chunk);
  }

  async close(): Promise<void> {
    this.dir.files.set(this.name, concat(this.#parts));
    this.dir.opfs.log.push(`put:${this.name}`);
  }

  async abort(): Promise<void> {
    this.#parts = [];
    this.#pending = 0;
  }
}

function usageOf(dir: FakeDirectory): number {
  let total = 0;
  for (const bytes of dir.files.values()) total += bytes.byteLength;
  for (const nested of dir.dirs.values()) total += usageOf(nested);
  return total;
}

function concat(parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function fail(name: string): DOMException {
  return new DOMException(name, name);
}
