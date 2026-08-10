import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { cmd, on } from "./commands";
import { createWasmBackend } from "./wasm-backend";
import { VideolaDocument } from "./document";
import { markerTimes, spreadEasing, splitAtTimes } from "./edits";
import type { Keyframe } from "./generated/Keyframe";
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

describe("one key's easing on the whole track", () => {
  async function eased(): Promise<{ doc: VideolaDocument; clip: string }> {
    const doc = await timeline(1);
    const clip = doc.state.timeline.tracks[0]?.clips[0]?.id ?? "";
    for (const [at, value] of [
      [0, 1],
      [1, 0.5],
      [2, 0.2],
      [3, 1],
    ] as const) {
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip), null, "opacity", at * SECOND, { kind: "float", value }),
      );
    }
    doc.dispatch(cmd.keyframeSetInterp(on.clip(clip), null, "opacity", 0, "bezier"));
    doc.dispatch(
      cmd.keyframeSetHandles(on.clip(clip), null, "opacity", 0, [0.4, 1.2], [0.9, 0.05]),
    );
    return { doc, clip };
  }

  const keys = (doc: VideolaDocument): readonly Keyframe[] =>
    doc.state.timeline.tracks[0]?.clips[0]?.keyframes.opacity ?? [];

  it("gives every other key the same shape", async () => {
    const { doc, clip } = await eased();
    const model = keys(doc)[0];
    expect(model).toBeDefined();

    for (const command of spreadEasing(keys(doc), on.clip(clip), null, "opacity", model!)) {
      doc.dispatch(command, "spread-1");
    }

    for (const key of keys(doc)) {
      expect(key.interp).toBe("bezier");
      expect(key.handleOut?.[0]).toBeCloseTo(0.9, 5);
      expect(key.handleOut?.[1]).toBeCloseTo(0.05, 5);
      expect(key.handleIn?.[0]).toBeCloseTo(0.4, 5);
      expect(key.handleIn?.[1]).toBeCloseTo(1.2, 5);
    }
  });

  // An overshoot survives the trip: the pair the model key carries is the pair the others get, and
  // the core keeps a y above 1 because that is what a bounce is.
  it("carries an overshoot with it", async () => {
    const { doc, clip } = await eased();
    for (const command of spreadEasing(keys(doc), on.clip(clip), null, "opacity", keys(doc)[0]!)) {
      doc.dispatch(command, "spread-2");
    }
    expect(keys(doc).every((key) => (key.handleIn?.[1] ?? 0) > 1)).toBe(true);
  });

  it("is one step to undo, however many keys it touched", async () => {
    const { doc, clip } = await eased();
    const before = keys(doc).map((key) => key.interp);
    for (const command of spreadEasing(keys(doc), on.clip(clip), null, "opacity", keys(doc)[0]!)) {
      doc.dispatch(command, "spread-3");
    }
    expect(keys(doc).map((key) => key.interp)).not.toEqual(before);

    doc.undo();
    expect(keys(doc).map((key) => key.interp)).toEqual(before);
  });

  it("says nothing about the key it was read from", async () => {
    const { doc, clip } = await eased();
    const commands = spreadEasing(keys(doc), on.clip(clip), null, "opacity", keys(doc)[0]!);
    expect(commands).toHaveLength(6);
    expect(commands.every((command) => (command as { time: number }).time !== 0)).toBe(true);
  });

  it("has nothing to say about a track of one key", async () => {
    const { doc, clip } = await eased();
    expect(spreadEasing([keys(doc)[0]!], on.clip(clip), null, "opacity", keys(doc)[0]!)).toEqual([]);
  });
});
