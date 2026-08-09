import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { cmd } from "./commands";
import { createWasmBackend } from "./wasm-backend";
import { VideolaDocument } from "./document";
import { markerTimes, splitAtTimes } from "./edits";
import { initSync } from "./wasm/videola_core.js";

// The real core, because what is being asked is what a split leaves behind — and a stand-in that
// halved a duration would agree with itself about everything.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "wasm");
beforeAll(() => {
  initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });
});

const SECOND = 705_600_000;

async function timeline(clips: number, tracks = 1): Promise<VideolaDocument> {
  const doc = new VideolaDocument(await createWasmBackend());
  for (let track = 0; track < tracks; track += 1) {
    doc.dispatch(cmd.trackAdd("video", `V${track + 1}`));
    const id = doc.state.timeline.tracks[track]?.id ?? "";
    for (let index = 0; index < clips; index += 1) {
      doc.dispatch(
        cmd.clipAdd(
          id,
          { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
          index * 4 * SECOND,
          4 * SECOND,
        ),
      );
    }
  }
  return doc;
}

function starts(doc: VideolaDocument): number[][] {
  return doc.state.timeline.tracks.map((track) => track.clips.map((clip) => clip.start / SECOND));
}

describe("cutting at instants", () => {
  it("cuts one clip into two where a marker falls inside it", async () => {
    const doc = await timeline(1);
    expect(splitAtTimes(doc, [2 * SECOND])).toBe(1);
    expect(starts(doc)).toEqual([[0, 2]]);
  });

  // The whole reason this is applied against a live document: the second cut falls in a clip the
  // first one minted, and a list of commands built up front would name the clip that no longer
  // reaches that far.
  it("cuts the same clip twice, at both instants", async () => {
    const doc = await timeline(1);
    expect(splitAtTimes(doc, [1 * SECOND, 3 * SECOND])).toBe(2);
    expect(starts(doc)).toEqual([[0, 1, 3]]);
  });

  it("takes the instants in any order and leaves the same timeline", async () => {
    const forwards = await timeline(1);
    const backwards = await timeline(1);
    splitAtTimes(forwards, [1 * SECOND, 2 * SECOND, 3 * SECOND]);
    splitAtTimes(backwards, [3 * SECOND, 1 * SECOND, 2 * SECOND]);
    expect(starts(backwards)).toEqual(starts(forwards));
  });

  it("cuts every track the instant passes through", async () => {
    const doc = await timeline(1, 3);
    expect(splitAtTimes(doc, [2 * SECOND])).toBe(3);
    expect(starts(doc)).toEqual([
      [0, 2],
      [0, 2],
      [0, 2],
    ]);
  });

  // A marker on a cut has nothing to do. Asking the core anyway means a refusal per marker, which
  // would take the whole press down with it.
  it("does nothing at an instant that is already a cut", async () => {
    const doc = await timeline(2);
    expect(splitAtTimes(doc, [0, 4 * SECOND, 8 * SECOND])).toBe(0);
    expect(starts(doc)).toEqual([[0, 4]]);
  });

  it("counts two markers on the same instant as one cut", async () => {
    const doc = await timeline(1);
    expect(splitAtTimes(doc, [2 * SECOND, 2 * SECOND])).toBe(1);
  });

  // One locked track must not take the rest with it: the core refuses the edit, and a dispatch
  // that throws in the middle of a hundred cuts leaves half a press applied.
  it("passes over a locked track and cuts the others", async () => {
    const doc = await timeline(1, 2);
    const locked = doc.state.timeline.tracks[0]?.id ?? "";
    doc.dispatch(cmd.trackSetFlags(locked, null, null, true, null));

    expect(splitAtTimes(doc, [2 * SECOND])).toBe(1);
    expect(starts(doc)).toEqual([[0], [0, 2]]);
  });

  it("is one step to undo however many cuts it made", async () => {
    const doc = await timeline(1);
    splitAtTimes(doc, [1 * SECOND, 2 * SECOND, 3 * SECOND], "cut-at-markers-1");
    expect(starts(doc)).toEqual([[0, 1, 2, 3]]);

    doc.undo();
    expect(starts(doc)).toEqual([[0]]);
  });

  it("reads the instants off the markers", async () => {
    const doc = await timeline(1);
    doc.dispatch(cmd.markerAdd(1 * SECOND, "1"));
    doc.dispatch(cmd.markerAdd(3 * SECOND, "2"));

    expect(markerTimes(doc.state)).toEqual([1 * SECOND, 3 * SECOND]);
    expect(splitAtTimes(doc, markerTimes(doc.state))).toBe(2);
    expect(starts(doc)).toEqual([[0, 1, 3]]);
  });
});
