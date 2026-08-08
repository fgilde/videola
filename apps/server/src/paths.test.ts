import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { PathOutsideRoot, Storage, writeAtomic } from "./paths";

let root = "";
let outside = "";

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), "videola-paths-"));
  root = join(base, "root");
  outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
});

describe("Storage.forReading", () => {
  it("resolves a plain relative path inside the root", async () => {
    await writeFile(join(root, "a.videola"), "x");

    const resolved = await new Storage(root).forReading("a.videola");

    expect(await readFile(resolved, "utf8")).toBe("x");
  });

  it("resolves through a subdirectory", async () => {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "a.videola"), "x");

    await expect(new Storage(root).forReading("nested/a.videola")).resolves.toContain("a.videola");
  });

  it("refuses a path that climbs out with ..", async () => {
    await writeFile(join(outside, "secret"), "s");

    await expect(new Storage(root).forReading("../outside/secret")).rejects.toThrow(PathOutsideRoot);
  });

  it("refuses an absolute path instead of reinterpreting it", async () => {
    await writeFile(join(outside, "secret"), "s");

    await expect(new Storage(root).forReading(join(outside, "secret"))).rejects.toThrow(
      PathOutsideRoot,
    );
  });

  // The check that `resolve` alone cannot make: the resolved path is entirely inside the root and
  // still lands outside it once the link is followed.
  it("refuses a symlink inside the root that points out of it", async () => {
    await writeFile(join(outside, "secret"), "s");
    await symlink(join(outside, "secret"), join(root, "link"));

    await expect(new Storage(root).forReading("link")).rejects.toThrow(PathOutsideRoot);
  });

  it("refuses an empty path", async () => {
    await expect(new Storage(root).forReading("")).rejects.toThrow(PathOutsideRoot);
  });
});

describe("Storage.forWriting", () => {
  it("accepts a file that does not exist yet and creates its directory", async () => {
    const target = await new Storage(root).forWriting("out/new.videola");

    await writeFile(target, "y");
    expect(await readFile(join(root, "out", "new.videola"), "utf8")).toBe("y");
  });

  it("refuses to write through a symlinked directory that leaves the root", async () => {
    await symlink(outside, join(root, "away"), "dir");

    await expect(new Storage(root).forWriting("away/new.videola")).rejects.toThrow(PathOutsideRoot);
  });

  it("refuses to write above the root", async () => {
    await expect(new Storage(root).forWriting("../new.videola")).rejects.toThrow(PathOutsideRoot);
  });

  // A refusal that has already created directories outside the storage root is not a refusal.
  it("creates nothing outside the root when it refuses", async () => {
    await expect(new Storage(root).forWriting("../outside/made/up/new.videola")).rejects.toThrow(
      PathOutsideRoot,
    );

    expect(await readdir(outside)).toEqual([]);
  });

  it("resolves a target several missing levels deep inside the root", async () => {
    const target = await new Storage(root).forWriting("a/b/c/new.videola");

    await writeFile(target, "z");
    expect(await readFile(join(root, "a", "b", "c", "new.videola"), "utf8")).toBe("z");
  });
});

describe("writeAtomic", () => {
  it("leaves the finished file and no staging file behind", async () => {
    const target = join(root, "a.bin");

    await writeAtomic(target, new Uint8Array([1, 2, 3]));

    expect([...(await readFile(target))]).toEqual([1, 2, 3]);
    expect(await readdir(root)).toEqual(["a.bin"]);
  });

  // Two writers of different lengths. A plain writeFile pair can interleave and leave a file that
  // is neither; two bare renames onto one target race into EPERM on Windows. What must hold is
  // that both calls succeed and the file is exactly one writer's content, all of it.
  it("leaves the later writer's complete content when two write the same path at once", async () => {
    const target = join(root, "a.bin");
    const short = new Uint8Array(64).fill(1);
    const long = new Uint8Array(1024 * 512).fill(2);

    await Promise.all([writeAtomic(target, short), writeAtomic(target, long)]);

    const written = await readFile(target);
    expect(written.byteLength).toBe(long.byteLength);
    expect(new Set(written)).toEqual(new Set([2]));
    expect(await readdir(root)).toEqual(["a.bin"]);
  });

  it("serialises many writers to one path without losing any of them", async () => {
    const target = join(root, "a.bin");

    await Promise.all(
      [...Array(12).keys()].map((index) => writeAtomic(target, new Uint8Array(8).fill(index))),
    );

    expect(new Set(await readFile(target))).toEqual(new Set([11]));
    expect(await readdir(root)).toEqual(["a.bin"]);
  });
});
