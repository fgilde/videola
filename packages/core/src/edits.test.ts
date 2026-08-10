import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { cmd, on } from "./commands";
import { createWasmBackend } from "./wasm-backend";
import { VideolaDocument } from "./document";
import {
  ALL_ATTRIBUTES,
  ASPECTS,
  freezeFrame,
  markerTimes,
  pasteAttributes,
  reframe,
  spreadEasing,
  splitAtTimes,
} from "./edits";
import type { Clip } from "./generated/Clip";
import type { Command } from "./generated/Command";
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

describe("one clip's look on another", () => {
  async function pair(): Promise<{ doc: VideolaDocument; model: Clip; other: string }> {
    const doc = await timeline(2);
    const clips = doc.state.timeline.tracks[0]?.clips ?? [];
    const model = clips[0]?.id ?? "";
    const other = clips[1]?.id ?? "";

    doc.dispatch(
      cmd.clipSetTransform(model, {
        x: 120,
        y: -40,
        scaleX: 1.5,
        scaleY: 1.5,
        rotation: 12,
        anchorX: 0.5,
        anchorY: 0.5,
        opacity: 0.8,
        crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 },
      }),
    );
    doc.dispatch(cmd.clipSetVolume(model, 0.4));
    doc.dispatch(cmd.clipSetSpeed(model, 2, false, true));
    doc.dispatch(cmd.effectAdd(on.clip(model), "brightness"));
    doc.dispatch(
      cmd.effectSetParam(on.clip(model), "brightness", "amount", { kind: "float", value: 0.3 }),
    );
    doc.dispatch(
      cmd.keyframeAdd(on.clip(model), null, "opacity", 0, { kind: "float", value: 0 }, "bezier"),
    );
    doc.dispatch(
      cmd.keyframeSetHandles(on.clip(model), null, "opacity", 0, [0.4, 1.2], [0.9, 0.05]),
    );
    doc.dispatch(
      cmd.keyframeAdd(on.clip(model), null, "opacity", SECOND, { kind: "float", value: 1 }),
    );

    return { doc, model: clipOf(doc, model), other };
  }

  const clipOf = (doc: VideolaDocument, id: string): Clip => {
    const found = doc.state.timeline.tracks.flatMap((track) => track.clips).find((c) => c.id === id);
    if (found === undefined) throw new Error(`no clip ${id}`);
    return found;
  };

  function apply(doc: VideolaDocument, commands: readonly Command[]): void {
    for (const command of commands) doc.dispatch(command, "attributes-1");
  }

  it("carries the geometry over", async () => {
    const { doc, model, other } = await pair();
    apply(doc, pasteAttributes(model, [other]));

    const got = clipOf(doc, other).transform;
    expect(got.x).toBeCloseTo(120, 4);
    expect(got.scaleX).toBeCloseTo(1.5, 4);
    expect(got.rotation).toBeCloseTo(12, 4);
    expect(got.crop.bottom).toBeCloseTo(0.2, 4);
  });

  it("carries the effect chain and its parameters", async () => {
    const { doc, model, other } = await pair();
    apply(doc, pasteAttributes(model, [other]));

    const chain = clipOf(doc, other).effects;
    expect(chain.map((effect) => effect.effectType)).toEqual(["brightness"]);
    // To the precision an f32 keeps it in: the value made the trip through the core and back.
    const amount = chain[0]?.params.amount;
    expect(amount?.kind).toBe("float");
    expect(amount?.kind === "float" ? amount.value : NaN).toBeCloseTo(0.3, 6);
  });

  it("carries the gain and the speed", async () => {
    const { doc, model, other } = await pair();
    apply(doc, pasteAttributes(model, [other]));

    expect(clipOf(doc, other).volume).toBeCloseTo(0.4, 4);
    expect(clipOf(doc, other).speed.rate).toBeCloseTo(2, 4);
  });

  // A paste that dropped the easing would hand back a move that lands in the right place and gets
  // there wrongly.
  it("carries the keys, their interpolation and their handles", async () => {
    const { doc, model, other } = await pair();
    apply(doc, pasteAttributes(model, [other]));

    const track = clipOf(doc, other).keyframes.opacity ?? [];
    expect(track).toHaveLength(2);
    expect(track[0]?.interp).toBe("bezier");
    expect(track[0]?.handleIn?.[1]).toBeCloseTo(1.2, 4);
  });

  it("takes only the groups it was asked for", async () => {
    const { doc, model, other } = await pair();
    apply(doc, pasteAttributes(model, [other], { ...ALL_ATTRIBUTES, effects: false }));

    expect(clipOf(doc, other).effects).toEqual([]);
    expect(clipOf(doc, other).transform.x).toBeCloseTo(120, 4);
  });

  // Twice over is the same clip, not two brightnesses: `effect.add` treats a repeated type as a
  // no-op, and the parameters are written again on top.
  it("does not grow a second effect of the same type", async () => {
    const { doc, model, other } = await pair();
    apply(doc, pasteAttributes(model, [other]));
    apply(doc, pasteAttributes(model, [other]));

    expect(clipOf(doc, other).effects).toHaveLength(1);
  });

  it("says nothing about the clip it was read from", async () => {
    const { doc, model } = await pair();
    expect(pasteAttributes(model, [model.id])).toEqual([]);
    void doc;
  });

  it("is one step to undo, however many clips it touched", async () => {
    const { doc, model, other } = await pair();
    const before = clipOf(doc, other).transform.x;
    apply(doc, pasteAttributes(model, [other]));
    expect(clipOf(doc, other).transform.x).not.toBeCloseTo(before, 4);

    doc.undo();
    expect(clipOf(doc, other).transform.x).toBeCloseTo(before, 4);
  });
});

describe("the same edit in a frame of another shape", () => {
  const settings = (doc: VideolaDocument) => doc.state.settings;
  const only = (doc: VideolaDocument): Clip => {
    const found = doc.state.timeline.tracks[0]?.clips[0];
    if (found === undefined) throw new Error("no clip");
    return found;
  };

  async function landscape(): Promise<VideolaDocument> {
    const doc = await timeline(1);
    doc.dispatch(cmd.projectSetSettings({ ...doc.state.settings, width: 1920, height: 1080 }));
    return doc;
  }

  function apply(doc: VideolaDocument, commands: readonly Command[]): void {
    for (const command of commands) doc.dispatch(command, "reframe-1");
  }

  it("changes the frame", async () => {
    const doc = await landscape();
    apply(doc, reframe(doc.state, { width: 1080, height: 1920, fit: "cover" }));

    expect([settings(doc).width, settings(doc).height]).toEqual([1080, 1920]);
  });

  // 1920x1080 into 1080x1920: across is 0.5625 and down is 1.777, so covering takes the larger of
  // the two. A picture scaled by the smaller would leave bars down both sides, which is the one
  // thing a portrait cut must not have.
  it("scales every clip to cover the new frame", async () => {
    const doc = await landscape();
    apply(doc, reframe(doc.state, { width: 1080, height: 1920, fit: "cover" }));

    expect(only(doc).transform.scaleX).toBeCloseTo(1920 / 1080, 4);
    expect(only(doc).transform.scaleY).toBeCloseTo(1920 / 1080, 4);
  });

  it("scales it to fit inside where nothing may be cropped", async () => {
    const doc = await landscape();
    apply(doc, reframe(doc.state, { width: 1080, height: 1920, fit: "contain" }));

    expect(only(doc).transform.scaleX).toBeCloseTo(1080 / 1920, 4);
  });

  // The factor is applied to what the author chose rather than replacing it: a clip already blown up
  // keeps that relationship to the others.
  it("keeps what the author already did to a clip", async () => {
    const doc = await landscape();
    doc.dispatch(cmd.clipSetTransform(only(doc).id, { ...only(doc).transform, scaleX: 1.5, scaleY: 1.5 }));
    apply(doc, reframe(doc.state, { width: 1080, height: 1920, fit: "cover" }));

    expect(only(doc).transform.scaleX).toBeCloseTo(1.5 * (1920 / 1080), 4);
  });

  // A lower third belongs at the lower third of the new frame, not 1080 px from the middle of it.
  it("moves a placed clip by the ratio of the axis it is placed on", async () => {
    const doc = await landscape();
    doc.dispatch(cmd.clipSetTransform(only(doc).id, { ...only(doc).transform, x: 480, y: 270 }));
    apply(doc, reframe(doc.state, { width: 1080, height: 1920, fit: "cover" }));

    expect(only(doc).transform.x).toBeCloseTo(480 * (1080 / 1920), 3);
    expect(only(doc).transform.y).toBeCloseTo(270 * (1920 / 1080), 3);
  });

  it("changes the frame and nothing else when told to keep the scales", async () => {
    const doc = await landscape();
    apply(doc, reframe(doc.state, { width: 1080, height: 1080, fit: "keep" }));

    expect(settings(doc).width).toBe(1080);
    expect(only(doc).transform.scaleX).toBeCloseTo(1, 6);
  });

  it("has nothing to do for the frame it is already in", async () => {
    const doc = await landscape();
    expect(reframe(doc.state, { width: 1920, height: 1080, fit: "keep" })).toEqual([]);
  });

  // A locked track is passed over, the same rule cutting at the markers follows: the core would
  // refuse the edit, and one locked track must not take the whole reframe with it.
  it("passes over a locked track", async () => {
    const doc = await timeline(1, 2);
    const locked = doc.state.timeline.tracks[0]?.id ?? "";
    doc.dispatch(cmd.trackSetFlags(locked, null, null, true, null));

    apply(doc, reframe(doc.state, { width: 1080, height: 1920, fit: "cover" }));

    expect(doc.state.timeline.tracks[0]?.clips[0]?.transform.scaleX).toBeCloseTo(1, 6);
    expect(doc.state.timeline.tracks[1]?.clips[0]?.transform.scaleX).toBeGreaterThan(1);
  });

  it("is one step to undo, frame and clips together", async () => {
    const doc = await landscape();
    apply(doc, reframe(doc.state, { width: 1080, height: 1920, fit: "cover" }));

    doc.undo();
    expect([settings(doc).width, settings(doc).height]).toEqual([1920, 1080]);
    expect(only(doc).transform.scaleX).toBeCloseTo(1, 6);
  });

  it("offers the four shapes anyone asks for", () => {
    expect(ASPECTS.map((aspect) => `${aspect.width}x${aspect.height}`)).toEqual([
      "1920x1080",
      "1080x1920",
      "1080x1080",
      "1080x1350",
    ]);
  });
});

describe("holding one frame", () => {
  const pieces = (doc: VideolaDocument) => doc.state.timeline.tracks[0]?.clips ?? [];
  const spans = (doc: VideolaDocument) =>
    pieces(doc).map((clip) => [clip.start / SECOND, clip.duration / SECOND]);

  it("cuts the clip into three and holds the middle one", async () => {
    const doc = await timeline(1);
    expect(freezeFrame(doc, pieces(doc)[0]!.id, SECOND, SECOND)).toBe(true);

    expect(spans(doc)).toEqual([
      [0, 1],
      [1, 1],
      [2, 2],
    ]);
    const frozen = pieces(doc)[1]!;
    expect(frozen.keyframes.speed?.map((key) => key.value)).toEqual([
      { kind: "float", value: 0 },
      { kind: "float", value: 0 },
    ]);
  });

  // What makes it a freeze rather than a gap: a rate of zero consumes no source, so the held piece
  // shows the frame it starts on for its whole length.
  it("consumes no source while it holds", async () => {
    const doc = await timeline(1);
    freezeFrame(doc, pieces(doc)[0]!.id, SECOND, SECOND);

    const frozen = pieces(doc)[1]!;
    expect(frozen.inPoint / SECOND).toBeCloseTo(1, 4);
  });

  // The tail carries on from the frame the freeze started on. Splitting set its in point from where
  // the cut fell, which is right for a cut and would put a jump at the end of a freeze.
  it("lets the clip go on where it left off", async () => {
    const doc = await timeline(1);
    freezeFrame(doc, pieces(doc)[0]!.id, SECOND, SECOND);

    expect(pieces(doc)[2]!.inPoint / SECOND).toBeCloseTo(1, 4);
  });

  it("leaves the timeline as long as it was", async () => {
    const doc = await timeline(1);
    const before = pieces(doc)[0]!.duration;
    freezeFrame(doc, pieces(doc)[0]!.id, SECOND, SECOND);

    const total = pieces(doc).reduce((sum, clip) => sum + clip.duration, 0);
    expect(total).toBe(before);
  });

  it("refuses an instant on the clip's own edge", async () => {
    const doc = await timeline(1);
    const clip = pieces(doc)[0]!;
    expect(freezeFrame(doc, clip.id, clip.start, SECOND)).toBe(false);
    expect(pieces(doc)).toHaveLength(1);
  });

  it("refuses a hold that would reach past the end", async () => {
    const doc = await timeline(1);
    const clip = pieces(doc)[0]!;
    expect(freezeFrame(doc, clip.id, 3 * SECOND, 2 * SECOND)).toBe(false);
    expect(pieces(doc)).toHaveLength(1);
  });

  it("refuses a hold of nothing", async () => {
    const doc = await timeline(1);
    expect(freezeFrame(doc, pieces(doc)[0]!.id, SECOND, 0)).toBe(false);
  });

  it("is one step to undo, both cuts and the hold together", async () => {
    const doc = await timeline(1);
    freezeFrame(doc, pieces(doc)[0]!.id, SECOND, SECOND);
    expect(pieces(doc)).toHaveLength(3);

    doc.undo();
    expect(pieces(doc)).toHaveLength(1);
    expect(pieces(doc)[0]!.keyframes.speed).toBeUndefined();
  });
});
