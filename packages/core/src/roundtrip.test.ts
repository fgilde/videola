import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cmd, FLICKS_PER_SECOND, MAX_COMPOUND_DEPTH, on, readableSourceTimeAt } from "./commands";
import { VideolaDocument } from "./document";
import type { Clip, Interp, Project } from "./generated";
import { createProjectBackend, createWasmBackend } from "./wasm-backend";
import { initSync } from "./wasm/videola_core.js";

// Needs the real build in packages/core/src/wasm (gitignored - run `pnpm wasm` first). Every
// other test in this package dispatches against the fake backend from document.test.ts /
// commands.test.ts; this is the one test that goes through the actual Rust core.
//
// createWasmBackend() loads the module via fetch(new URL(...)), which Node's undici does not
// implement for file:// URLs. initSync populates the glue module's internal instance directly
// from disk first, so the later fetch-based init() call in createWasmBackend() short-circuits
// on its own "already initialized" guard instead of ever calling fetch.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

describe("save and reopen through the real WASM backend", () => {
  it("keeps a track across a save and reopen", async () => {
    const doc = new VideolaDocument(await createWasmBackend());
    doc.dispatch(cmd.trackAdd("video", "V1"));

    const bytes = doc.save(
      {
        appVersion: "0.0.0-test",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        locale: "de",
      },
      new Map(),
    );

    const reopened = new VideolaDocument(await createWasmBackend(bytes));
    expect(reopened.state.timeline.tracks).toHaveLength(1);
    expect(reopened.state.timeline.tracks[0]?.name).toBe("V1");
  });
});

const MEDIA = `med_${"a".repeat(64)}`;
const SECOND = FLICKS_PER_SECOND;

async function timeline(): Promise<VideolaDocument> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("video", "V1"));
  doc.dispatch(cmd.trackAdd("video", "V2"));
  return doc;
}

function trackId(doc: VideolaDocument, index: number): string {
  return doc.state.timeline.tracks[index]!.id;
}

function clipOn(doc: VideolaDocument, track: number): Clip {
  return doc.state.timeline.tracks[track]!.clips[0]!;
}

// The batch query is the one thing playback asks the core sixty times a second, and no fake
// stands in for it here: the arithmetic, the clamp and the boundary marshalling are all Rust.
describe("source times through the real WASM backend", () => {
  it("answers for every clip the moment touches and for no other", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 4 * SECOND));
    doc.dispatch(
      cmd.clipAdd(trackId(doc, 1), { kind: "media", media: MEDIA }, 3 * SECOND, 4 * SECOND),
    );
    const lower = clipOn(doc, 0);
    const upper = clipOn(doc, 1);

    expect(doc.sourceTimesAt(SECOND)).toEqual(new Map([[lower.id, SECOND]]));
    expect(doc.sourceTimesAt(3.5 * SECOND)).toEqual(
      new Map([
        [lower.id, 3.5 * SECOND],
        [upper.id, 0.5 * SECOND],
      ]),
    );
    // The end is exclusive on both, so the moment the lower one ends only the upper answers.
    expect(doc.sourceTimesAt(4 * SECOND)).toEqual(new Map([[upper.id, SECOND]]));
    expect(doc.sourceTimesAt(9 * SECOND)).toEqual(new Map());
  });

  it("keeps a reversed clip's first frame inside the range it may read", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    doc.dispatch(cmd.clipSetSpeed(clipOn(doc, 0).id, 2, true));
    const clip = clipOn(doc, 0);
    const consumed = clip.duration * clip.speed.rate;

    // Straight from source_time_at this would be `consumed`, one flick past the last sample --
    // the decoder reads past end of media and the first frame of a reversed clip is black.
    expect(doc.sourceTimesAt(0)).toEqual(new Map([[clip.id, clip.inPoint + consumed - 1]]));
    expect(doc.sourceTimesAt(SECOND)).toEqual(new Map([[clip.id, clip.inPoint + consumed / 2]]));
  });

  // Two levels of Map, and `to_js_value` would have flattened both into object literals. Asking
  // through `.get` is the point: an object literal answers `undefined` here and nothing throws.
  it("hands effect parameters over as maps keyed by effect id", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    const clip = clipOn(doc, 0);
    doc.dispatch(cmd.effectAdd(on.clip(clip.id), "brightness"));
    doc.dispatch(cmd.effectSetParam(on.clip(clip.id), "brightness", "amount", { kind: "float", value: 1.5 }));
    const effect = clipOn(doc, 0).effects[0]!;

    const params = doc.effectParamsAt(SECOND);

    expect(params.get(effect.id)?.get("amount")).toEqual({ kind: "float", value: 1.5 });
    expect(doc.effectParamsAt(2 * SECOND).size).toBe(0);
  });

  // Until `keyframe.add` existed, only static values had ever crossed this boundary -- the
  // interpolation was proven in Rust and the value-to-pixel chain on the GPU, with the join
  // between them untested. This is that join: two keys, and a value that moves in between.
  it("interpolates a keyframed parameter on the way across", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 4 * SECOND));
    const clip = clipOn(doc, 0);
    doc.dispatch(cmd.effectAdd(on.clip(clip.id), "brightness"));
    doc.dispatch(cmd.effectSetParam(on.clip(clip.id), "brightness", "amount", { kind: "float", value: 9 }));
    doc.dispatch(cmd.keyframeAdd(on.clip(clip.id), "brightness", "amount", 0, { kind: "float", value: 0 }));
    doc.dispatch(
      cmd.keyframeAdd(on.clip(clip.id), "brightness", "amount", 2 * SECOND, { kind: "float", value: 1 }),
    );
    const effect = clipOn(doc, 0).effects[0]!;
    const amountAt = (at: number): unknown => doc.effectParamsAt(at).get(effect.id)?.get("amount");

    expect(amountAt(0)).toEqual({ kind: "float", value: 0 });
    expect(amountAt(SECOND)).toEqual({ kind: "float", value: 0.5 });
    expect(amountAt(3 * SECOND)).toEqual({ kind: "float", value: 1 });

    // Stretching the ramp: the later key moves out to 4 s, so one second in is a quarter of the
    // way. A `from`/`to` the wrong way round would refuse instead of quietly doing something else.
    doc.dispatch(cmd.keyframeMove(on.clip(clip.id), "brightness", "amount", 2 * SECOND, 4 * SECOND));
    expect(amountAt(SECOND)).toEqual({ kind: "float", value: 0.25 });
    doc.dispatch(cmd.keyframeMove(on.clip(clip.id), "brightness", "amount", 4 * SECOND, 2 * SECOND));

    doc.dispatch(cmd.keyframeSetInterp(on.clip(clip.id), "brightness", "amount", 0, "hold"));
    expect(amountAt(SECOND)).toEqual({ kind: "float", value: 0 });

    // Off the clock again the static value takes over -- and it was there the whole time.
    doc.dispatch(cmd.keyframeRemove(on.clip(clip.id), "brightness", "amount", 0));
    doc.dispatch(cmd.keyframeRemove(on.clip(clip.id), "brightness", "amount", 2 * SECOND));
    expect(amountAt(SECOND)).toEqual({ kind: "float", value: 9 });
  });

  // "Fit the clip to the frame" in the only form the core knows: a scale factor that reaches the
  // compositor unchanged. Every field goes across, because the command carries the whole struct.
  it("carries a whole transform across the boundary", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    const clip = clipOn(doc, 0);
    const fitted = {
      ...clip.transform,
      scaleX: 3,
      scaleY: 3,
      crop: { ...clip.transform.crop, left: 0.25 },
    };

    doc.dispatch(cmd.clipSetTransform(clip.id, fitted));

    expect(clipOn(doc, 0).transform).toEqual(fitted);
  });

  it("carries a transition across the boundary and takes it off again", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    const clip = clipOn(doc, 0);
    const crossfade = {
      transitionType: "crossfade",
      duration: SECOND / 2,
      alignment: "in" as const,
      params: {},
    };

    doc.dispatch(cmd.clipSetTransition(clip.id, crossfade));
    expect(clipOn(doc, 0).transitionIn).toEqual(crossfade);

    // Cleared means *absent*, not null: `transitionIn` is skipped when it is none, so the
    // Inspector has to test for undefined rather than compare against null.
    doc.dispatch(cmd.clipSetTransition(clip.id, null));
    expect(clipOn(doc, 0).transitionIn).toBeUndefined();
  });

  // The Inspector's own drag: two hundred dispatches under one key, one step back.
  it("collapses a drag over a keyframed parameter into one undo step", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 4 * SECOND));
    const clip = clipOn(doc, 0);
    doc.dispatch(cmd.effectAdd(on.clip(clip.id), "brightness"));
    const before = doc.state.timeline.tracks[0]!.clips[0]!.effects[0]!.keyframes;

    for (let step = 0; step < 200; step += 1) {
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip.id), "brightness", "amount", SECOND, {
          kind: "float",
          value: step / 200,
        }),
        "kf:amount",
      );
    }
    expect(doc.canUndo).toBe(true);
    doc.undo();

    expect(doc.state.timeline.tracks[0]!.clips[0]!.effects[0]!.keyframes).toEqual(before);
  });

  it("carries whole flicks across the boundary, not seconds", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, SECOND));
    const clip = clipOn(doc, 0);

    const at = doc.sourceTimesAt(333_667)!.get(clip.id);

    expect(at).toBe(333_667);
    expect(Number.isInteger(at)).toBe(true);
  });
});

// The join `Clip::keyframes` never had: until now the field existed, could be written, saved and
// reloaded, and nothing in the repository ever evaluated it. These go through the real core.
describe("keyframed transforms across the boundary", () => {
  async function clipWithMotion(): Promise<{ doc: VideolaDocument; clip: Clip }> {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 4 * SECOND));
    const clip = clipOn(doc, 0);
    doc.dispatch(cmd.keyframeAdd(on.clip(clip.id), null, "x", 0, { kind: "float", value: 0 }));
    doc.dispatch(
      cmd.keyframeAdd(on.clip(clip.id), null, "x", 2 * SECOND, { kind: "float", value: 100 }),
    );
    return { doc, clip };
  }

  it("interpolates a transform field on the way across", async () => {
    const { doc, clip } = await clipWithMotion();
    const xAt = (at: number): number | undefined => doc.transformsAt(at).get(clip.id)?.x;

    expect(xAt(0)).toBe(0);
    expect(xAt(SECOND)).toBe(50);
    expect(xAt(3 * SECOND)).toBe(100);
    // Past the clip there is no geometry to report, however far the ramp would carry on.
    expect(doc.transformsAt(4 * SECOND).size).toBe(0);
  });

  // The static transform is what the field is worth when nothing is on the clock, and the batch
  // must keep answering with it -- otherwise the draw list would need a rule of its own.
  it("answers with the static transform for a clip that is not animated", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    const clip = clipOn(doc, 0);

    expect(doc.transformsAt(SECOND).get(clip.id)).toEqual(clip.transform);
  });

  // A name no transform carries is refused rather than stored: a keyframe the picture cannot read
  // is exactly the state this work exists to end.
  it("refuses a transform field the renderer would never read", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    const clip = clipOn(doc, 0);

    expect(() =>
      doc.dispatch(cmd.keyframeAdd(on.clip(clip.id), null, "wobble", 0, { kind: "float", value: 1 })),
    ).toThrow();
    expect(clipOn(doc, 0).keyframes).toEqual({});
  });

  it("collapses a drag over a keyframed transform into one undo step", async () => {
    const { doc, clip } = await clipWithMotion();
    const before = clipOn(doc, 0).keyframes;

    for (let step = 0; step < 50; step += 1) {
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip.id), null, "x", SECOND, { kind: "float", value: step }),
        "kf:x",
      );
    }
    doc.undo();

    expect(clipOn(doc, 0).keyframes).toEqual(before);
  });
});

// The other half of the model that had no address: chains on a track and on the project, and the
// one fader the whole mix passes through.
describe("effects beyond a clip, across the boundary", () => {
  it("puts an effect on a track and on the project and resolves both at every moment", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    const track = trackId(doc, 0);

    doc.dispatch(cmd.effectAdd(on.track(track), "eq"));
    doc.dispatch(cmd.effectSetParam(on.track(track), "eq", "gain", { kind: "float", value: 3 }));
    doc.dispatch(cmd.effectAdd(on.project, "limiter"));
    doc.dispatch(
      cmd.keyframeAdd(on.project, "limiter", "ceiling", 0, { kind: "float", value: 0 }),
    );
    doc.dispatch(
      cmd.keyframeAdd(on.project, "limiter", "ceiling", 2 * SECOND, { kind: "float", value: 1 }),
    );

    const onTrack = doc.state.timeline.tracks[0]!.effects[0]!;
    const onProject = doc.state.master.effects[0]!;
    // Well past the only clip: a bus and a mastering chain do not stop existing between two cuts.
    const params = doc.effectParamsAt(9 * SECOND);

    expect(params.get(onTrack.id)?.get("gain")).toEqual({ kind: "float", value: 3 });
    expect(doc.effectParamsAt(SECOND).get(onProject.id)?.get("ceiling")).toEqual({
      kind: "float",
      value: 0.5,
    });
  });

  it("moves the master fader and clamps what a slider can produce", async () => {
    const doc = await timeline();

    doc.dispatch(cmd.projectSetMasterVolume(0.3));
    expect(doc.state.master.volume).toBeCloseTo(0.3);

    doc.dispatch(cmd.projectSetMasterVolume(99));
    expect(doc.state.master.volume).toBe(4);
  });
});

// Two implementations of one mapping: `Clip::source_time_at` in Rust, `sourceTimeAt` in
// commands.ts. The draw list needs the TypeScript one because the instant inside a nested timeline
// decides which clips are on screen, which is the question the batch query is being asked -- so the
// two cannot be replaced by each other and have to be pinned against each other instead. A
// disagreement of a single flick puts a clip in the draw list that no frame will ever arrive for.
describe("the source-time mapping on both sides of the boundary", () => {
  const shapes: [string, number, boolean][] = [
    ["plain", 1, false],
    ["double speed", 2, false],
    ["half speed", 0.5, false],
    ["reversed", 1, true],
    ["reversed at 2.5x", 2.5, true],
    ["an awkward rate", 1.0 / 3.0, false],
  ];

  for (const [name, rate, reverse] of shapes) {
    it(`agrees flick for flick on ${name}`, async () => {
      const doc = await timeline();
      doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, SECOND, 3 * SECOND));
      doc.dispatch(cmd.clipSetSpeed(clipOn(doc, 0).id, rate, reverse));
      const clip = clipOn(doc, 0);

      // The edges by name as well as by sweep: the clamp on a reversed head differs from the raw
      // mapping at exactly one flick, and a stride that never lands on `clip.start` walks past it.
      const edges = [
        clip.start - 1,
        clip.start,
        clip.start + 1,
        clip.start + clip.duration - 1,
        clip.start + clip.duration,
      ];
      const sweep = Array.from({ length: 15 }, (_, step) => step * 333_667);
      for (const at of [...edges, ...sweep]) {
        expect(readableSourceTimeAt(clip, at)).toBe(doc.sourceTimesAt(at).get(clip.id));
      }
    });
  }

  // The same pinning for the shape the mapping stops being proportional in. Two implementations of
  // one integral is a worse hazard than two of one multiplication was: a disagreement accumulates
  // over the clip instead of being a single rounding, and a reversed ramp reads the *total* to
  // place its head, so an error in the last segment moves the first frame. Every rate here rounds
  // exactly to f32, so both sides start from the same bits and any drift is arithmetic.
  const ramps: [string, [number, number, Interp][], boolean][] = [
    ["a linear ramp", [[0, 0.5, "linear"], [3, 2, "linear"]], false],
    ["an eased ramp", [[0, 0.25, "ease"], [3, 4, "linear"]], false],
    ["a ramp run backwards", [[0, 0.5, "linear"], [3, 2, "linear"]], true],
    ["an eased ramp run backwards", [[0, 3, "ease"], [3, 0.25, "linear"]], true],
    ["a frame hold from the middle", [[0, 1, "hold"], [1.5, 0, "hold"]], false],
    [
      "four keys of mixed easing",
      [[0, 2, "linear"], [1, 0.5, "ease"], [2, 4, "hold"], [3, 1, "linear"]],
      false,
    ],
    // The keys sit inside the clip, so the flat stretch outside them has to agree at both ends too.
    ["a ramp shorter than its clip", [[1.5, 0.5, "linear"], [2.5, 2, "linear"]], false],
  ];

  for (const [name, keys, reverse] of ramps) {
    it(`agrees flick for flick on ${name}`, async () => {
      const doc = await timeline();
      doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, SECOND, 3 * SECOND));
      const id = clipOn(doc, 0).id;
      doc.dispatch(cmd.clipSetSpeed(id, 1, reverse));
      for (const [seconds, rate, interp] of keys) {
        doc.dispatch(
          cmd.keyframeAdd(
            on.clip(id),
            null,
            "speed",
            SECOND + Math.round(seconds * SECOND),
            { kind: "float", value: rate },
            interp,
          ),
        );
      }
      const clip = clipOn(doc, 0);

      const edges = [
        clip.start - 1,
        clip.start,
        clip.start + 1,
        clip.start + clip.duration - 1,
        clip.start + clip.duration,
      ];
      const sweep = Array.from({ length: 31 }, (_, step) => step * 100_800_000);
      for (const at of [...edges, ...sweep]) {
        expect(readableSourceTimeAt(clip, at)).toBe(doc.sourceTimesAt(at).get(clip.id));
      }
    });
  }
});

describe("nesting through the real WASM backend", () => {
  it("leaves every source time where it was", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 3 * SECOND, 2 * SECOND));
    const before: ReadonlyMap<string, number>[] = [];
    for (let at = 0; at < 6 * SECOND; at += SECOND / 8) before.push(doc.sourceTimesAt(at));

    doc.dispatch(cmd.clipNest(doc.state.timeline.tracks[0]!.clips.map((entry) => entry.id)));

    let index = 0;
    for (let at = 0; at < 6 * SECOND; at += SECOND / 8) {
      expect(doc.sourceTimesAt(at)).toEqual(before[index]!);
      index += 1;
    }
  });

  // The cap the walk uses is the loader's, so what the core accepts is what the renderer can
  // reach. Nesting one level past it is refused rather than stored and then silently not drawn.
  it("refuses to nest past the depth the loader accepts", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, SECOND));
    for (let level = 0; level < MAX_COMPOUND_DEPTH; level += 1) {
      doc.dispatch(cmd.clipNest([clipOn(doc, 0).id]));
    }

    expect(() => doc.dispatch(cmd.clipNest([clipOn(doc, 0).id]))).toThrow();
  });
});

// The other half of the autosave: a project state with no media around it, taken back over as an
// ordinary document. It goes through `Project::normalize` like a `.videola` does, which is what
// makes a snapshot that survived a crash mid-write a refusal rather than a corrupt editor.
describe("a project state through the real WASM backend", () => {
  it("comes back as a document that can be edited and undone like any other", async () => {
    const built = await timeline();
    built.dispatch(cmd.clipAdd(trackId(built, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));

    const restored = new VideolaDocument(await createProjectBackend(built.state));

    expect(restored.state).toEqual(built.state);
    // A fresh history, not the old one: the snapshot is a state, and there is nothing behind it
    // to step back into.
    expect(restored.canUndo).toBe(false);
    restored.dispatch(cmd.trackAdd("audio", "A1"));
    expect(restored.canUndo).toBe(true);
  });

  it("refuses a project the loader would refuse", async () => {
    const built = await timeline();
    built.dispatch(cmd.clipAdd(trackId(built, 0), { kind: "media", media: MEDIA }, 0, SECOND));
    const broken = JSON.parse(JSON.stringify(built.state)) as Project;
    broken.timeline.tracks[0]!.clips[0]!.start = Number.MAX_SAFE_INTEGER;

    await expect(createProjectBackend(broken)).rejects.toThrow();
  });

  it("keeps a nested timeline across the snapshot", async () => {
    const built = await timeline();
    built.dispatch(cmd.clipAdd(trackId(built, 0), { kind: "media", media: MEDIA }, 0, SECOND));
    built.dispatch(cmd.clipNest([clipOn(built, 0).id]));

    const restored = new VideolaDocument(await createProjectBackend(built.state));

    expect(restored.state.timeline.tracks[0]!.clips[0]!.source.kind).toBe("compound");
    expect(restored.sourceTimesAt(SECOND / 2)).toEqual(built.sourceTimesAt(SECOND / 2));
  });
});
