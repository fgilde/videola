import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cmd, createWasmBackend, secondsToTime, VideolaDocument } from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";
import { describe, expect, it } from "vitest";

import type { Project } from "@videola/core";

import { installFakeOpfs } from "./fake-opfs";
import { importFile } from "./import";
import { mediaForProject } from "./save";

import type { MediaProbe, ProbeMedia } from "./import";

const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "../../core/src/wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

const DURATION = secondsToTime(2);

const probe: ProbeMedia = async () =>
  ({
    duration: DURATION,
    video: { width: 1920, height: 1080, fps: { numerator: 30000, denominator: 1001 } },
  }) satisfies MediaProbe;

const OPTIONS = {
  appVersion: "0.0.0-test",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-01T00:00:00.000Z",
  locale: "de",
};

function firstClipMedia(project: Project): string | undefined {
  const source = project.timeline.tracks[0]?.clips[0]?.source;
  return source?.kind === "media" ? source.media : undefined;
}

describe("saving a project whose media live in OPFS", () => {
  it("survives import, save and reopen with the clip still on the same medium", async () => {
    installFakeOpfs();
    const doc = new VideolaDocument(await createWasmBackend());
    const id = await importFile(new File(["mp4"], "a.mp4", { type: "video/mp4" }), doc, probe);
    doc.dispatch(cmd.trackAdd("video", "V1"));
    const trackId = doc.state.timeline.tracks[0]?.id ?? "";
    doc.dispatch(cmd.clipAdd(trackId, { kind: "media", media: id }, 0, DURATION));

    const archive = doc.save(OPTIONS, await mediaForProject(doc.state));

    const reopened = new VideolaDocument(await createWasmBackend(archive));
    expect(reopened.warnings).toEqual([]);
    expect(reopened.state.library.map((asset) => asset.id)).toEqual([id]);
    expect(firstClipMedia(reopened.state)).toBe(id);
  });

  it("refuses a library larger than a project file can hold", async () => {
    installFakeOpfs();
    const project = {
      library: [{ id: `med_${"a".repeat(64)}`, sizeBytes: 3 * 1024 * 1024 * 1024 }],
    } as unknown as Project;

    await expect(mediaForProject(project)).rejects.toThrow("error.mediaTooLarge");
  });

  it("leaves out an entry OPFS does not have, so the core can fall back to its own copy", async () => {
    installFakeOpfs();
    const doc = new VideolaDocument(await createWasmBackend());
    doc.importMedia({ name: "a.mp4", type: "video/mp4" }, new Uint8Array([1, 2, 3]));

    expect(await mediaForProject(doc.state)).toEqual(new Map());
    expect(() => doc.save(OPTIONS, new Map())).not.toThrow();
  });
});
