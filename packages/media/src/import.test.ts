import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createWasmBackend, secondsToTime, VideolaDocument } from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";
import { describe, expect, it } from "vitest";

import type { DocumentBackend } from "@videola/core";

import { installFakeOpfs } from "./fake-opfs";
import { contentHash } from "./hash";
import { importFile } from "./import";
import { getMedia } from "./opfs";

import type { MediaProbe, ProbeMedia } from "./import";

// Same trick as packages/core's roundtrip test: createWasmBackend() loads the module through
// fetch(new URL(...)), which Node does not implement for file:// URLs, so the glue is primed
// from disk first and its own "already initialized" guard short-circuits the later init().
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "../../core/src/wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

const NTSC = { numerator: 30000, denominator: 1001 };

const fullProbe: MediaProbe = {
  duration: secondsToTime(2),
  video: { width: 1920, height: 1080, fps: NTSC },
  audio: { sampleRate: 48_000, channels: 2 },
};

function probeOf(probe: MediaProbe): ProbeMedia {
  return async () => probe;
}

function videoFile(content = "pretend this is an mp4"): File {
  return new File([content], "clip.mp4", { type: "video/mp4" });
}

async function openDocument(log: string[]): Promise<VideolaDocument> {
  const backend = await createWasmBackend();
  return new VideolaDocument({
    ...backend,
    dispatch: (dispatch) => {
      log.push("dispatch");
      return backend.dispatch(dispatch);
    },
  } satisfies DocumentBackend);
}

describe("importFile", () => {
  it("writes the bytes to OPFS before it tells the core the medium exists", async () => {
    const fake = installFakeOpfs();
    const doc = await openDocument(fake.log);
    const file = videoFile();

    const id = await importFile(file, doc, probeOf(fullProbe));

    const hash = await contentHash(file);
    expect(id).toBe(`med_${hash}`);
    expect(fake.log).toEqual([`put:${hash}`, "dispatch"]);
    expect(await getMedia(hash)).toEqual(new Uint8Array(await file.arrayBuffer()));
  });

  it("gives a file the same id the Rust core computes for the same bytes", async () => {
    const doc = await openDocument([]);
    const file = videoFile();

    const fromRust = doc.importMedia(file, new Uint8Array(await file.arrayBuffer()));

    expect(`med_${await contentHash(file)}`).toBe(fromRust);
  });

  it("hands the core metadata it accepts and keeps the frame rate rational", async () => {
    const fake = installFakeOpfs();
    const doc = await openDocument(fake.log);
    const file = videoFile();

    await importFile(file, doc, probeOf(fullProbe));

    const asset = doc.state.library[0];
    expect(asset?.fps).toEqual(NTSC);
    expect(asset?.width).toBe(1920);
    expect(asset?.duration).toBe(secondsToTime(2));
    // ts-rs declares `sizeBytes: bigint` and the dispatch does take a BigInt, but
    // serde_wasm_bindgen hands a u64 back as a plain Number whenever it fits one. Compared
    // numerically so this asserts the value rather than that declared discrepancy.
    expect(Number(asset?.sizeBytes)).toBe(file.size);
  });

  it("leaves one library entry when the same file is imported twice", async () => {
    const fake = installFakeOpfs();
    const doc = await openDocument(fake.log);

    await importFile(videoFile(), doc, probeOf(fullProbe));
    await importFile(videoFile(), doc, probeOf(fullProbe));

    expect(doc.state.library).toHaveLength(1);
    expect(fake.log.filter((entry) => entry.startsWith("put:"))).toHaveLength(1);
  });

  it("rejects a video file without a video track before a command flies", async () => {
    const fake = installFakeOpfs();
    const doc = await openDocument(fake.log);
    const audioOnly: MediaProbe = { duration: secondsToTime(1), audio: fullProbe.audio };

    await expect(importFile(videoFile(), doc, probeOf(audioOnly))).rejects.toThrow("error.mediaNoVideoTrack");

    expect(fake.log).toEqual([]);
    expect(doc.state.library).toHaveLength(0);
  });

  it("rejects a frame rate with a zero denominator before a command flies", async () => {
    const fake = installFakeOpfs();
    const doc = await openDocument(fake.log);
    const broken: MediaProbe = {
      ...fullProbe,
      video: { width: 1920, height: 1080, fps: { numerator: 30, denominator: 0 } },
    };

    await expect(importFile(videoFile(), doc, probeOf(broken))).rejects.toThrow(
      "error.mediaMetadata",
    );

    expect(fake.log).toEqual([]);
  });

  it("rejects a duration past the bound the core would refuse", async () => {
    const fake = installFakeOpfs();
    const doc = await openDocument(fake.log);
    const tooLong: MediaProbe = { ...fullProbe, duration: secondsToTime(25 * 60 * 60) };

    await expect(importFile(videoFile(), doc, probeOf(tooLong))).rejects.toThrow(
      "error.mediaMetadata",
    );

    expect(fake.log).toEqual([]);
  });

  it("rejects a file whose type the core has no media kind for", async () => {
    const fake = installFakeOpfs();
    const doc = await openDocument(fake.log);
    const document = new File(["%PDF"], "sheet.pdf", { type: "application/pdf" });

    await expect(importFile(document, doc, probeOf(fullProbe))).rejects.toThrow(
      "error.unsupportedMedia",
    );

    expect(fake.log).toEqual([]);
  });
});
