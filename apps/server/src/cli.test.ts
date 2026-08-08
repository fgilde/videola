import { createHash } from "node:crypto";

import { tinyMp4 } from "@videola/engine/src/decode/fixture-mp4";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { run } from "./cli";

let dir = "";
let out: string[] = [];
let warned: string[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "videola-cli-"));
  out = [];
  warned = [];
});

function cli(...argv: string[]): Promise<number> {
  return run(
    argv,
    (line) => out.push(line),
    (line) => warned.push(line),
  );
}

async function file(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

// Real container bytes, not a string: the import probes what it is handed and refuses anything it
// cannot read, which is what keeps a library entry from existing without a duration or a size.
async function mediaFile(name: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, Buffer.from(await tinyMp4().arrayBuffer()));
  return path;
}

describe("apply", () => {
  it("writes an archive for a project that started empty", async () => {
    const archive = join(dir, "new.videola");

    const code = await cli("apply", "--out", archive);

    expect(code).toBe(0);
    expect((await readFile(archive)).subarray(0, 2).toString()).toBe("PK");
  });

  it("runs the commands from a file and the result survives a reopen", async () => {
    const commands = await file(
      "cut.json",
      JSON.stringify([
        { type: "track.add", kind: "video", name: "V1" },
        { type: "project.setTitle", title: "Reel" },
      ]),
    );
    const archive = join(dir, "reel.videola");

    expect(await cli("apply", "--commands", commands, "--out", archive)).toBe(0);
    out = [];
    await cli("describe", archive);

    expect(out.join("")).toContain('video "V1"');
    expect(out.join("")).toContain("Reel");
  });

  it("takes a single command object as well as an array", async () => {
    const commands = await file("one.json", JSON.stringify({ type: "track.add", kind: "audio", name: "A1" }));
    const archive = join(dir, "one.videola");

    await cli("apply", "--commands", commands, "--out", archive);
    out = [];
    await cli("describe", archive);

    expect(out.join("")).toContain('audio "A1"');
  });

  // The id is the SHA-256 of the file, which is what lets a commands file name a medium the same
  // run imports without anyone having to look the id up first.
  it("imports media under an id the caller could have worked out", async () => {
    const media = await mediaFile("clip.mp4");
    const expected = `med_${createHash("sha256").update(await readFile(media)).digest("hex")}`;

    const code = await cli("apply", "--media", media, "--out", join(dir, "with-media.videola"));

    expect(code).toBe(0);
    expect(out.join("")).toContain(expected);
  });

  // The name is what the editor shows for the medium, and the archive travels: the caller's whole
  // directory tree has no business being in a file they hand to someone else.
  it("names the medium after the file, not after the path it came from", async () => {
    const media = await mediaFile("clip.mp4");
    const archive = join(dir, "named.videola");

    await cli("apply", "--media", media, "--out", archive);
    out = [];
    await cli("describe", archive);

    expect(out.join("")).toContain("clip.mp4 [");
    expect(out.join("")).not.toContain(dir);
  });

  it("refuses a file type it cannot name", async () => {
    const media = await file("notes.xyz", "whatever");

    expect(await cli("apply", "--media", media, "--out", join(dir, "x.videola"))).toBe(1);
    expect(warned.join("")).toContain("cannot tell the media type");
  });

  // The core's refusal is the message worth showing; a batch that dies half-applied would be worse
  // than one that dies whole, and `Api.apply` already rolls back.
  it("passes a rejected command through and writes nothing", async () => {
    const commands = await file("bad.json", JSON.stringify([{ type: "track.remove", track: "trk_nope" }]));
    const archive = join(dir, "never.videola");

    expect(await cli("apply", "--commands", commands, "--out", archive)).toBe(1);
    expect(warned.join("")).toContain("videola:");
    await expect(readFile(archive)).rejects.toThrow();
  });

  it("insists on a destination", async () => {
    expect(await cli("apply")).toBe(1);
    expect(warned.join("")).toContain("--out");
  });
});

describe("validate", () => {
  it("reports findings as JSON", async () => {
    const archive = join(dir, "empty.videola");
    await cli("apply", "--out", archive);
    out = [];

    expect(await cli("validate", archive)).toBe(0);
    expect(JSON.parse(out.join(""))).toEqual([]);
  });

  it("needs a path", async () => {
    expect(await cli("validate")).toBe(1);
  });
});

describe("schema", () => {
  it("lists every command the core exports", async () => {
    expect(await cli("schema")).toBe(0);

    expect(out.join("")).toContain("clip.split");
    expect(out.join("").trim().split("\n").length).toBeGreaterThan(30);
  });

  it("prints one command's schema as JSON", async () => {
    expect(await cli("schema", "clip.add")).toBe(0);

    expect(JSON.parse(out.join(""))).toMatchObject({ type: "object" });
  });

  it("says so when the command does not exist", async () => {
    expect(await cli("schema", "clip.teleport")).toBe(1);
    expect(warned.join("")).toContain("no such command");
  });
});

describe("the front door", () => {
  it("prints usage on --help and keeps it out of a pipe otherwise", async () => {
    expect(await cli("--help")).toBe(0);
    expect(out.join("")).toContain("videola apply");

    out = [];
    expect(await cli()).toBe(1);
    expect(out.join("")).toBe("");
    expect(warned.join("")).toContain("videola apply");
  });

  it("names an unknown subcommand and an unknown option", async () => {
    expect(await cli("render")).toBe(1);
    expect(warned.join("")).toContain("no such subcommand: render");

    warned = [];
    expect(await cli("apply", "--codec", "h264")).toBe(1);
    expect(warned.join("")).toContain("codec");
  });
});
