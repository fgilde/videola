import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cmd, FLICKS_PER_SECOND, readableSourceTimeAt } from "./commands";
import { VideolaDocument } from "./document";
import {
  frameHold,
  insert,
  INSERT_KINDS,
  kenBurns,
  pictureInPicture,
  speedRamp,
  splitScreen,
  stageFor,
  title,
} from "./presets";
import { createWasmBackend } from "./wasm-backend";
import { initSync } from "./wasm/videola_core.js";

import type { Clip, Command } from "./generated";

// Against the real core, not a stand-in. A preset that produces a command the core refuses is a
// menu entry that does nothing, which is precisely the failure these exist to rule out -- and only
// the real command layer can say whether a command is accepted.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

const SECOND = FLICKS_PER_SECOND;
const MEDIA = `med_${"a".repeat(64)}`;

async function timeline(): Promise<VideolaDocument> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("video", "V1"));
  doc.dispatch(cmd.trackAdd("video", "V2"));
  doc.dispatch(
    cmd.mediaImport({
      id: MEDIA,
      originalName: "shot.mp4",
      mime: "video/mp4",
      kind: "video",
      sizeBytes: 1n,
      duration: 60 * SECOND,
      width: 1280,
      height: 720,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: null,
      channels: null,
    }),
  );
  return doc;
}

function track(doc: VideolaDocument, index: number): string {
  return doc.state.timeline.tracks[index]!.id;
}

function clipOn(doc: VideolaDocument, index: number): Clip {
  return doc.state.timeline.tracks[index]!.clips[0]!;
}

async function withClip(start = 0, duration = 4 * SECOND): Promise<VideolaDocument> {
  const doc = await timeline();
  doc.dispatch(cmd.clipAdd(track(doc, 0), { kind: "media", media: MEDIA }, start, duration));
  return doc;
}

// One key, so the whole preset is one press of undo. Every run below goes through this rather than
// dispatching bare, because "does it undo in one step" is half of what makes a command sequence the
// right shape for a preset at all.
function apply(doc: VideolaDocument, commands: readonly Command[], key = "preset"): void {
  for (const command of commands) doc.dispatch(command, key);
}

describe("a preset is a command sequence", () => {
  it("collapses into one undo step and leaves nothing behind when undone", async () => {
    const doc = await withClip();
    const before = structuredClone(doc.state);
    const steps = doc.canUndo ? 1 : 0;

    apply(doc, kenBurns(clipOn(doc, 0), stageFor(doc.state, clipOn(doc, 0))));
    expect(clipOn(doc, 0).keyframes.scaleX).toHaveLength(2);

    doc.undo();
    expect(doc.state).toEqual(before);
    expect(steps).toBe(1);
  });

  // The inverse was never written by hand: it is `json_patch::diff` run the other way, which is why
  // a preset gets undo for free and a `Preset` in the model would have had to earn it.
  it("puts a two-clip preset back the way it was in one step as well", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(track(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    doc.dispatch(cmd.clipAdd(track(doc, 0), { kind: "media", media: MEDIA }, 2 * SECOND, 2 * SECOND));
    const before = structuredClone(doc.state);
    const clips = doc.state.timeline.tracks[0]!.clips;
    const pair = [clips[0]!, clips[1]!] as const;

    apply(doc, splitScreen(pair, [stageFor(doc.state, pair[0]), stageFor(doc.state, pair[1])]));
    doc.undo();

    expect(doc.state).toEqual(before);
  });
});

describe("frame hold", () => {
  // The claim behind the menu entry: the picture stops on the frame the playhead was showing, and
  // stays there. A rate of zero and nothing else.
  it("freezes the frame the playhead stands on and holds it to the end", async () => {
    const doc = await withClip();
    const at = 1.5 * SECOND;
    const running = doc.sourceTimesAt(at).get(clipOn(doc, 0).id);

    apply(doc, frameHold(clipOn(doc, 0), at));

    // Within a flick, because the frozen tail sits on the exclusive end of the range the clip now
    // consumes and `readableSourceTimeAt` keeps a read inside it -- 1.4 nanoseconds inside the same
    // video frame. What matters is that it does not move afterwards.
    const held = doc.sourceTimesAt(at).get(clipOn(doc, 0).id)!;
    expect(Math.abs(held - running!)).toBeLessThanOrEqual(1);
    for (const later of [2 * SECOND, 3 * SECOND, 3.9 * SECOND]) {
      expect(doc.sourceTimesAt(later).get(clipOn(doc, 0).id)).toBe(held);
    }
    // And the part before the hold is untouched -- a freeze that also retimed the run-up would be a
    // different edit wearing the same name.
    expect(doc.sourceTimesAt(0.5 * SECOND).get(clipOn(doc, 0).id)).toBe(0.5 * SECOND);
  });

  it("holds the frame of a clip that was already retimed, at that clip's own rate", async () => {
    const doc = await withClip();
    doc.dispatch(cmd.clipSetSpeed(clipOn(doc, 0).id, 2, false));
    const at = SECOND;
    const running = doc.sourceTimesAt(at).get(clipOn(doc, 0).id);
    expect(running).toBe(2 * SECOND);

    apply(doc, frameHold(clipOn(doc, 0), at));

    const held = doc.sourceTimesAt(3 * SECOND).get(clipOn(doc, 0).id)!;
    expect(Math.abs(held - running!)).toBeLessThanOrEqual(1);
    expect(doc.sourceTimesAt(2 * SECOND).get(clipOn(doc, 0).id)).toBe(held);
  });

  // The two axes crossing: a hold *and* a reversed clip. A rate of zero shortens the range a
  // reversed clip is anchored to, so the hold would land on `in_point` rather than on the frame the
  // playhead was showing -- and it would do it silently. Refused instead, which is what keeps the
  // menu entry from being a promise with nothing behind it. This run exists to keep it refused.
  it("refuses to hold a reversed clip rather than freezing the wrong frame", async () => {
    const doc = await withClip();
    doc.dispatch(cmd.clipSetSpeed(clipOn(doc, 0).id, 1, true));
    const at = SECOND;
    const running = doc.sourceTimesAt(at).get(clipOn(doc, 0).id);

    expect(frameHold(clipOn(doc, 0), at)).toEqual([]);
    expect(doc.sourceTimesAt(at).get(clipOn(doc, 0).id)).toBe(running);
    expect(clipOn(doc, 0).keyframes.speed).toBeUndefined();
  });

  it("refuses a playhead that is not inside the clip rather than writing a key nobody asked for", async () => {
    const doc = await withClip(SECOND, SECOND);
    expect(frameHold(clipOn(doc, 0), 0)).toEqual([]);
    expect(frameHold(clipOn(doc, 0), 5 * SECOND)).toEqual([]);
  });
});

describe("speed ramps as presets", () => {
  it("opens slow and reaches the clip's own rate by the end", async () => {
    const doc = await withClip();
    apply(doc, speedRamp(clipOn(doc, 0), "slowIn"));
    const clip = clipOn(doc, 0);

    // Slow at the head means less source spent than plain playback by the same moment.
    expect(readableSourceTimeAt(clip, SECOND)!).toBeLessThan(SECOND);
    // And it has caught up by the end rather than running past it.
    expect(clip.duration).toBe(4 * SECOND);
    expect(readableSourceTimeAt(clip, 3.999 * SECOND)!).toBeLessThan(4 * SECOND);
  });

  it("dips in the middle and comes back for the slow-middle shape", async () => {
    const doc = await withClip();
    apply(doc, speedRamp(clipOn(doc, 0), "slowMiddle"));
    const clip = clipOn(doc, 0);

    const spent = (from: number, to: number): number =>
      readableSourceTimeAt(clip, to)! - readableSourceTimeAt(clip, from)!;
    expect(spent(1.75 * SECOND, 2.25 * SECOND)).toBeLessThan(spent(0, 0.5 * SECOND));
    expect(spent(1.75 * SECOND, 2.25 * SECOND)).toBeLessThan(spent(3.5 * SECOND, 4 * SECOND - 1));
  });
});

describe("Ken Burns", () => {
  it("pushes in over the clip and never lets the frame open onto the background", async () => {
    const doc = await withClip();
    const clip = clipOn(doc, 0);
    const stage = stageFor(doc.state, clip);
    apply(doc, kenBurns(clip, stage, "in"));

    const scaleAt = (at: number): number => doc.transformsAt(at).get(clip.id)!.scaleX;
    const cover = stage.frame.width / stage.source.width;
    expect(scaleAt(0)).toBeCloseTo(cover, 5);
    expect(scaleAt(4 * SECOND - 1)).toBeGreaterThan(scaleAt(0));
    for (const at of [0, SECOND, 2 * SECOND, 3 * SECOND, 4 * SECOND - 1]) {
      expect(scaleAt(at)).toBeGreaterThanOrEqual(cover - 1e-6);
    }
  });

  it("runs the same move the other way round", async () => {
    const doc = await withClip();
    const clip = clipOn(doc, 0);
    apply(doc, kenBurns(clip, stageFor(doc.state, clip), "out"));

    const scaleAt = (at: number): number => doc.transformsAt(at).get(clip.id)!.scaleX;
    expect(scaleAt(0)).toBeGreaterThan(scaleAt(4 * SECOND - 1));
  });

  // The drift is the half that makes it a Ken Burns rather than a zoom, and it has to actually move
  // the clip -- a `position` track the picture never read would be exactly the failure mode the
  // motion path work was for.
  it("drifts across as well as pushing in", async () => {
    const doc = await withClip();
    const clip = clipOn(doc, 0);
    apply(doc, kenBurns(clip, stageFor(doc.state, clip)));

    const start = doc.transformsAt(0).get(clip.id)!;
    const end = doc.transformsAt(4 * SECOND - 1).get(clip.id)!;
    expect(start.x).toBeLessThan(end.x);
    expect(start.y).toBeGreaterThan(end.y);
  });
});

describe("picture in picture and split screen", () => {
  it("fits the picture inside the frame in the corner it was asked for", async () => {
    const doc = await withClip();
    const clip = clipOn(doc, 0);
    const stage = stageFor(doc.state, clip);
    apply(doc, pictureInPicture(clip, stage, "bottomRight"));

    const placed = doc.transformsAt(SECOND).get(clip.id)!;
    const halfWidth = (stage.source.width * placed.scaleX) / 2;
    const halfHeight = (stage.source.height * placed.scaleY) / 2;
    expect(placed.x + halfWidth).toBeLessThanOrEqual(stage.frame.width / 2);
    expect(placed.y + halfHeight).toBeLessThanOrEqual(stage.frame.height / 2);
    expect(placed.x).toBeGreaterThan(0);
    expect(placed.y).toBeGreaterThan(0);
    // A quarter of each side, so a sixteenth of the frame.
    expect((stage.source.width * placed.scaleX) / stage.frame.width).toBeCloseTo(0.25, 5);
  });

  it("puts every corner inside the frame and on the side it names", async () => {
    const doc = await withClip();
    const clip = clipOn(doc, 0);
    const stage = stageFor(doc.state, clip);
    for (const [corner, right, bottom] of [
      ["topLeft", false, false],
      ["topRight", true, false],
      ["bottomLeft", false, true],
      ["bottomRight", true, true],
    ] as const) {
      apply(doc, pictureInPicture(clip, stage, corner), `pip-${corner}`);
      const placed = doc.transformsAt(SECOND).get(clip.id)!;
      expect(placed.x > 0).toBe(right);
      expect(placed.y > 0).toBe(bottom);
    }
  });

  it("moves the picture onto the track it was given and leaves it where it started in time", async () => {
    const doc = await withClip(SECOND, SECOND);
    const clip = clipOn(doc, 0);
    apply(doc, pictureInPicture(clip, stageFor(doc.state, clip), "topRight", track(doc, 1)));

    expect(doc.state.timeline.tracks[0]!.clips).toHaveLength(0);
    expect(clipOn(doc, 1).id).toBe(clip.id);
    expect(clipOn(doc, 1).start).toBe(SECOND);
  });

  it("gives each half of a split screen its own half and cuts away the rest", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(track(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    doc.dispatch(cmd.clipAdd(track(doc, 0), { kind: "media", media: MEDIA }, 2 * SECOND, 2 * SECOND));
    const clips = doc.state.timeline.tracks[0]!.clips;
    const pair = [clips[0]!, clips[1]!] as const;
    const stages = [stageFor(doc.state, pair[0]), stageFor(doc.state, pair[1])] as const;

    apply(doc, splitScreen(pair, stages, "sideBySide", track(doc, 1)));

    const left = doc.state.timeline.tracks[0]!.clips[0]!;
    const right = doc.state.timeline.tracks[1]!.clips[0]!;
    expect(left.transform.x).toBeLessThan(0);
    expect(right.transform.x).toBeGreaterThan(0);
    expect(left.transform.crop.right).toBe(0.5);
    expect(right.transform.crop.left).toBe(0.5);
    expect(left.transform.crop.left).toBe(0);
  });

  it("stacks a split screen the other way when asked", async () => {
    const doc = await timeline();
    doc.dispatch(cmd.clipAdd(track(doc, 0), { kind: "media", media: MEDIA }, 0, 2 * SECOND));
    doc.dispatch(cmd.clipAdd(track(doc, 0), { kind: "media", media: MEDIA }, 2 * SECOND, 2 * SECOND));
    const clips = doc.state.timeline.tracks[0]!.clips;
    const pair = [clips[0]!, clips[1]!] as const;
    const stages = [stageFor(doc.state, pair[0]), stageFor(doc.state, pair[1])] as const;

    apply(doc, splitScreen(pair, stages, "stacked"));

    const [top, bottom] = doc.state.timeline.tracks[0]!.clips;
    expect(top!.transform.y).toBeLessThan(0);
    expect(bottom!.transform.y).toBeGreaterThan(0);
    expect(top!.transform.crop.bottom).toBe(0.5);
    expect(bottom!.transform.crop.top).toBe(0.5);
  });
});

describe("titles", () => {
  it("puts a styled text clip on the track, with the words it was given", async () => {
    const doc = await timeline();
    apply(doc, title(track(doc, 1), "lowerThird", "Ada Lovelace", SECOND, 3 * SECOND));

    const clip = clipOn(doc, 1);
    expect(clip.source.kind).toBe("generator");
    const generator = (clip.source as { generator: { type: string; content: string } }).generator;
    expect(generator.type).toBe("text");
    expect(generator.content).toBe("Ada Lovelace");
    expect(clip.start).toBe(SECOND);
    expect(clip.duration).toBe(3 * SECOND);
  });

  // Every style key has to be one the text generator reads, or the preset is a promise with nothing
  // behind it: an unknown key is silently dropped there and the title comes out plain.
  it("uses only style keys the generator reads, and they survive a save and reopen", async () => {
    const known = new Set([
      "fontFamily",
      "fontSize",
      "fontWeight",
      "italic",
      "color",
      "align",
      "lineHeight",
      "letterSpacing",
      "x",
      "y",
      "maxWidth",
      "strokeWidth",
      "strokeColor",
      "shadowBlur",
      "shadowX",
      "shadowY",
      "shadowColor",
      "background",
      "padding",
      "animateIn",
      "animateInSeconds",
      "animateOut",
      "animateOutSeconds",
      "loop",
      "loopSeconds",
    ]);
    for (const kind of ["lowerThird", "banner", "credits"] as const) {
      const doc = await timeline();
      apply(doc, title(track(doc, 1), kind, "Title", 0, 2 * SECOND));
      const generator = (clipOn(doc, 1).source as { generator: { style: Record<string, unknown> } })
        .generator;
      const keys = Object.keys(generator.style);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(known.has(key), `${kind}.${key}`).toBe(true);
    }
  });

  it("gives the three kinds three different looks rather than one look under three names", async () => {
    const looks = new Set<string>();
    for (const kind of ["lowerThird", "banner", "credits"] as const) {
      const doc = await timeline();
      apply(doc, title(track(doc, 1), kind, "Title", 0, 2 * SECOND));
      const generator = (clipOn(doc, 1).source as { generator: { style: unknown } }).generator;
      looks.add(JSON.stringify(generator.style));
    }
    expect(looks.size).toBe(3);
  });
});

// What an insert lays down has to be something the renderer draws, on a track that accepts it. Both
// halves are checked against the real command layer: a shape the engine has no path for, or a clip on
// the wrong kind of track, would be a menu entry that produces an empty rectangle.
describe("inserting something that is not a medium", () => {
  it("offers only kinds it can lay down, and each on a track that takes it", () => {
    for (const kind of INSERT_KINDS) {
      const laid = insert(kind, "Words");
      expect(laid.duration).toBeGreaterThan(0);
      expect(laid.source.kind).toBe("generator");
      const type = (laid.source as { generator: { type: string } }).generator.type;
      expect(laid.track).toBe(type === "text" ? "text" : "overlay");
    }
  });

  it("counts for exactly as long as the clip stands", () => {
    const laid = insert("countdown", "");
    const generator = (laid.source as { generator: { fromSeconds: number } }).generator;
    expect(laid.duration).toBe(generator.fromSeconds * SECOND);
  });

  it("goes onto a text track through the ordinary command", async () => {
    const doc = await timeline();
    const laid = insert("lowerThird", "Ada Lovelace");
    doc.dispatch(cmd.trackAdd("text", "T1"));
    const added = doc.state.timeline.tracks.at(-1)!;
    doc.dispatch(cmd.clipAdd(added.id, laid.source, SECOND, laid.duration));

    const clip = doc.state.timeline.tracks.at(-1)!.clips[0]!;
    expect((clip.source as { generator: { content: string } }).generator.content).toBe(
      "Ada Lovelace",
    );
    expect(clip.duration).toBe(laid.duration);
  });
});
