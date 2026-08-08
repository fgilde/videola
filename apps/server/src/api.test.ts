import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmd, secondsToTime } from "@videola/core";
import { tinyMp4 } from "@videola/engine/src/decode/fixture-mp4";
import type { Command } from "@videola/core";
import { beforeEach, describe, expect, it } from "vitest";

import { Api, ApiError } from "./api";

// A real, probeable file: the import describes what it reads, so bytes that no demuxer can
// read are refused before they ever reach the library.
const MP4 = Buffer.from(await tinyMp4().arrayBuffer());

let root = "";
let api: Api;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "videola-api-"));
  api = new Api({ storageRoot: root, maxProjects: 2 });
});

function trackOf(id: string): string {
  const track = api.state(id).timeline.tracks[0];
  if (track === undefined) throw new Error("no track");
  return track.id;
}

async function projectWithTrack(): Promise<string> {
  const { id } = await api.create();
  api.apply(id, [cmd.trackAdd("video", "V1")]);
  return id;
}

describe("a fresh project", () => {
  it("starts at revision zero with nothing to undo", async () => {
    const view = await api.create();

    expect(view).toMatchObject({ revision: 0, canUndo: false, canRedo: false, source: null });
    expect(api.state(view.id).timeline.tracks).toEqual([]);
  });

  it("is refused once the open-project limit is reached", async () => {
    await api.create();
    await api.create();

    await expect(api.create()).rejects.toMatchObject({ status: 429 });
  });

  it("can be closed and is then unknown", async () => {
    const { id } = await api.create();

    api.close(id);

    expect(() => api.view(id)).toThrow(ApiError);
    expect(api.list()).toEqual([]);
  });
});

describe("applying commands", () => {
  it("changes the project and advances the revision", async () => {
    const id = await projectWithTrack();

    expect(api.state(id).timeline.tracks).toHaveLength(1);
    expect(api.view(id)).toMatchObject({ revision: 1, canUndo: true });
  });

  it("reports the core's own label and patch for each command", async () => {
    const { id } = await api.create();

    const { results } = api.apply(id, [cmd.trackAdd("video", "V1"), cmd.projectSetTitle("Reel")]);

    expect(results.map((result) => result.label)).toEqual(["cmd.track.add", "cmd.project.setTitle"]);
    expect(results.every((result) => (result.patch as unknown[]).length > 0)).toBe(true);
  });

  // The batch is one undo step, which is also what makes the rollback below a single call.
  it("collapses a batch into one undo step", async () => {
    const { id } = await api.create();
    api.apply(id, [cmd.trackAdd("video", "V1"), cmd.trackAdd("audio", "A1")]);

    api.undo(id);

    expect(api.state(id).timeline.tracks).toEqual([]);
  });

  it("rolls the whole batch back when one command is rejected", async () => {
    const id = await projectWithTrack();
    const before = api.state(id);
    const revisionBefore = api.view(id).revision;

    expect(() =>
      api.apply(id, [
        cmd.trackAdd("audio", "A1"),
        cmd.trackRename("trk_does_not_exist", "nope") as Command,
      ]),
    ).toThrow(ApiError);

    expect(api.state(id)).toEqual(before);
    expect(api.view(id)).toMatchObject({ revision: revisionBefore, canRedo: false });
  });

  // The trap a plain undo would leave: the half of the batch that did land sits on the redo stack,
  // one call away from coming back.
  it("leaves nothing on the redo stack after a rollback", async () => {
    const id = await projectWithTrack();

    expect(() =>
      api.apply(id, [cmd.trackAdd("audio", "A1"), cmd.trackRemove("trk_nope") as Command]),
    ).toThrow(ApiError);

    expect(() => api.redo(id)).toThrow(ApiError);
    expect(api.state(id).timeline.tracks).toHaveLength(1);
  });

  it("refuses a batch whose expected revision is stale", async () => {
    const id = await projectWithTrack();

    expect(() => api.apply(id, [cmd.projectSetTitle("Reel")], 0)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(api.state(id).meta.title).toBe("");
  });

  it("accepts a batch whose expected revision is current", async () => {
    const id = await projectWithTrack();

    api.apply(id, [cmd.projectSetTitle("Reel")], 1);

    expect(api.state(id).meta.title).toBe("Reel");
  });

  it("refuses an empty batch instead of pretending it did something", async () => {
    const { id } = await api.create();

    expect(() => api.apply(id, [])).toThrow(ApiError);
  });

  it("does not advance the revision for a command that changes nothing", async () => {
    const id = await projectWithTrack();
    const track = trackOf(id);
    api.apply(id, [cmd.trackRename(track, "V1")]);

    expect(api.view(id).revision).toBe(1);
  });

  it("reports an unknown project rather than creating one", () => {
    expect(() => api.apply("prj_nope", [cmd.projectSetTitle("x")])).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});

describe("media", () => {
  const bytes = MP4;
  const expectedId = `med_${createHash("sha256").update(bytes).digest("hex")}`;

  it("imports a file from the storage root under its content hash", async () => {
    await writeFile(join(root, "clip.mp4"), bytes);
    const { id } = await api.create();

    const mediaId = await api.importPath(id, "clip.mp4");

    expect(mediaId).toBe(expectedId);
    expect(api.state(id).library).toMatchObject([
      { id: expectedId, originalName: "clip.mp4", mime: "video/mp4", kind: "video" },
    ]);
  });

  it("refuses a file outside the storage root", async () => {
    const { id } = await api.create();

    await expect(api.importPath(id, "../escape.mp4")).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a file whose type it cannot name", async () => {
    await writeFile(join(root, "clip.unknown"), bytes);
    const { id } = await api.create();

    await expect(api.importPath(id, "clip.unknown")).rejects.toMatchObject({
      status: 400,
      code: "unknownMediaType",
    });
  });

  it("takes an explicit mime over the extension", async () => {
    await writeFile(join(root, "clip.unknown"), bytes);
    const { id } = await api.create();

    await expect(api.importPath(id, "clip.unknown", "video/mp4")).resolves.toBe(expectedId);
    expect(api.state(id).library[0]?.kind).toBe("video");
  });

  // Without this the library entry carries a name and a size and nothing else, and every clip of
  // that medium is dropped from the draw list for want of a size -- silently.
  it("describes what it imported, so a clip of it can be drawn and heard", async () => {
    await writeFile(join(root, "clip.mp4"), bytes);
    const { id } = await api.create();

    await api.importPath(id, "clip.mp4");

    expect(api.state(id).library[0]).toMatchObject({
      width: 320,
      height: 176,
      fps: { numerator: 30000, denominator: 1001 },
      duration: secondsToTime(1.001),
    });
  });

  it("refuses a mime the core has no kind for", async () => {
    const { id } = await api.create();

    await expect(
      api.importBytes(id, "x.bin", "application/octet-stream", bytes),
    ).rejects.toThrow(ApiError);
  });
});

describe("saving and reopening", () => {
  it("writes an archive that reopens with its media and timeline intact", async () => {
    await writeFile(join(root, "clip.mp4"), MP4);
    const id = await projectWithTrack();
    const mediaId = await api.importPath(id, "clip.mp4");
    api.apply(id, [
      cmd.clipAdd(trackOf(id), { kind: "media", media: mediaId }, 0, secondsToTime(2)),
      cmd.projectSetTitle("Reel"),
    ]);

    await api.savePath(id, "out/reel.videola");
    api.close(id);
    const reopened = await api.openPath("out/reel.videola");

    expect(reopened.title).toBe("Reel");
    expect(reopened.warnings).toEqual([]);
    const project = api.state(reopened.id);
    expect(project.library.map((asset) => asset.id)).toEqual([mediaId]);
    expect(project.timeline.tracks[0]?.clips).toHaveLength(1);
  });

  it("hands out the archive as bytes for a client with no file system", async () => {
    const id = await projectWithTrack();

    const archive = api.archive(id);

    expect(Buffer.from(archive.subarray(0, 2)).toString()).toBe("PK");
    const reopened = await api.openArchive(archive);
    expect(api.state(reopened.id).timeline.tracks).toHaveLength(1);
  });

  it("refuses to write outside the storage root", async () => {
    const id = await projectWithTrack();

    await expect(api.savePath(id, "../escape.videola")).rejects.toMatchObject({ status: 403 });
  });

  it("rejects an archive that is not a project", async () => {
    await writeFile(join(root, "junk.videola"), "not a zip");

    await expect(api.openPath("junk.videola")).rejects.toMatchObject({ code: "notAProject" });
  });

  it("remembers where a project was saved", async () => {
    const id = await projectWithTrack();

    const view = await api.savePath(id, "reel.videola");

    expect(view.source).toBe("reel.videola");
    expect((await readFile(join(root, "reel.videola"))).byteLength).toBeGreaterThan(0);
  });
});

describe("undo and redo", () => {
  it("reports an empty history rather than throwing something unhandled", async () => {
    const { id } = await api.create();

    expect(() => api.undo(id)).toThrow(ApiError);
    expect(() => api.redo(id)).toThrow(ApiError);
  });

  it("round trips a change", async () => {
    const id = await projectWithTrack();

    api.undo(id);
    expect(api.state(id).timeline.tracks).toEqual([]);

    api.redo(id);
    expect(api.state(id).timeline.tracks).toHaveLength(1);
  });
});

// Every one of these has to be refused before a browser is started, because the alternative to a
// refusal is a picture that says nothing about what was asked for.
describe("a still of a moment", () => {
  it("is unknown for an unknown project", async () => {
    await expect(api.frames("prj_nope", [0])).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a request that names no instant", async () => {
    const id = await projectWithTrack();

    await expect(api.frames(id, [])).rejects.toMatchObject({ status: 400, code: "noTimes" });
  });

  it("refuses more instants than it will render", async () => {
    const id = await projectWithTrack();

    await expect(api.frames(id, Array.from({ length: 9 }, () => 0))).rejects.toMatchObject({
      code: "tooManyFrames",
    });
  });

  it("refuses a time that is not a whole number of flicks", async () => {
    const id = await projectWithTrack();

    await expect(api.frames(id, [secondsToTime(1) + 0.5])).rejects.toMatchObject({
      code: "badTime",
    });
    await expect(api.frames(id, [-1])).rejects.toMatchObject({ code: "badTime" });
  });

  it("refuses a width that is not a whole number of pixels", async () => {
    const id = await projectWithTrack();

    await expect(api.frames(id, [0], 12.5)).rejects.toMatchObject({ code: "badWidth" });
  });
});
