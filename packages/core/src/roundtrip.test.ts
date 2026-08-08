import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cmd, FLICKS_PER_SECOND } from "./commands";
import { VideolaDocument } from "./document";
import type { Clip } from "./generated";
import { createWasmBackend } from "./wasm-backend";
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
    doc.dispatch(cmd.effectAdd(clip.id, "brightness"));
    doc.dispatch(cmd.effectSetParam(clip.id, "brightness", "amount", { kind: "float", value: 1.5 }));
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
    doc.dispatch(cmd.effectAdd(clip.id, "brightness"));
    doc.dispatch(cmd.effectSetParam(clip.id, "brightness", "amount", { kind: "float", value: 9 }));
    doc.dispatch(cmd.keyframeAdd(clip.id, "brightness", "amount", 0, { kind: "float", value: 0 }));
    doc.dispatch(
      cmd.keyframeAdd(clip.id, "brightness", "amount", 2 * SECOND, { kind: "float", value: 1 }),
    );
    const effect = clipOn(doc, 0).effects[0]!;
    const amountAt = (at: number): unknown => doc.effectParamsAt(at).get(effect.id)?.get("amount");

    expect(amountAt(0)).toEqual({ kind: "float", value: 0 });
    expect(amountAt(SECOND)).toEqual({ kind: "float", value: 0.5 });
    expect(amountAt(3 * SECOND)).toEqual({ kind: "float", value: 1 });

    doc.dispatch(cmd.keyframeSetInterp(clip.id, "brightness", "amount", 0, "hold"));
    expect(amountAt(SECOND)).toEqual({ kind: "float", value: 0 });

    // Off the clock again the static value takes over -- and it was there the whole time.
    doc.dispatch(cmd.keyframeRemove(clip.id, "brightness", "amount", 0));
    doc.dispatch(cmd.keyframeRemove(clip.id, "brightness", "amount", 2 * SECOND));
    expect(amountAt(SECOND)).toEqual({ kind: "float", value: 9 });
  });

  // The Inspector's own drag: two hundred dispatches under one key, one step back.
  it("collapses a drag over a keyframed parameter into one undo step", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(trackId(doc, 0), { kind: "media", media: MEDIA }, 0, 4 * SECOND));
    const clip = clipOn(doc, 0);
    doc.dispatch(cmd.effectAdd(clip.id, "brightness"));
    const before = doc.state.timeline.tracks[0]!.clips[0]!.effects[0]!.keyframes;

    for (let step = 0; step < 200; step += 1) {
      doc.dispatch(
        cmd.keyframeAdd(clip.id, "brightness", "amount", SECOND, {
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
