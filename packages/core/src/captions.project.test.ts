import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canMergeCaptions,
  captionClips,
  CAPTION_STYLE,
  captionCues,
  mergeCaptions,
  parseCaptions,
  toSrt,
  toVtt,
} from "./captions";
import { cmd, FLICKS_PER_MILLISECOND } from "./commands";
import { VideolaDocument } from "./document";
import { createWasmBackend } from "./wasm-backend";
import { initSync } from "./wasm/videola_core.js";

import type { Clip } from "./generated";

// Against the real core, like the presets are: an import that produced a command the core refuses
// would be a button that does nothing, and only the real command layer can say which those are.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

// Three cues whose milliseconds are none of them a whole second, a whole tenth, or a whole frame at
// any rate the project offers. A conversion that went through seconds, or one that snapped to the
// ruler, lands somewhere else for every one of them.
const SRT = `1
00:00:01,001 --> 00:00:02,500
Hello there

2
00:00:02,500 --> 00:00:04,733
Two lines
of subtitle

3
01:02:03,004 --> 01:02:04,999
Late in the film
`;

async function withCaptions(source = SRT): Promise<{ doc: VideolaDocument; track: string }> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("caption", "C1"));
  const track = doc.state.timeline.tracks[0]!.id;
  for (const command of captionClips(track, parseCaptions(source))) doc.dispatch(command);
  return { doc, track };
}

function clipsOf(doc: VideolaDocument): Clip[] {
  return doc.state.timeline.tracks[0]!.clips;
}

describe("a caption track", () => {
  it("is a track kind the core accepts and keeps", async () => {
    const { doc } = await withCaptions();
    expect(doc.state.timeline.tracks[0]?.kind).toBe("caption");
  });

  it("takes one clip per cue, at the cue's own instants", async () => {
    const { doc } = await withCaptions();
    const clips = clipsOf(doc);
    expect(clips).toHaveLength(3);
    expect(clips[0]?.start).toBe(1001 * FLICKS_PER_MILLISECOND);
    expect(clips[0]?.duration).toBe(1499 * FLICKS_PER_MILLISECOND);
    expect(clips[2]?.start).toBe(3_723_004 * FLICKS_PER_MILLISECOND);
  });

  it("puts the words into the text generator that draws them", async () => {
    const { doc } = await withCaptions();
    const source = clipsOf(doc)[1]?.source;
    expect(source?.kind).toBe("generator");
    if (source?.kind !== "generator" || source.generator.type !== "text") {
      throw new Error("not a text generator");
    }
    // A hard line break has to survive all the way to the generator: a two-line subtitle that
    // arrives as one line is the failure a text input rather than a textarea produces.
    expect(source.generator.content).toBe("Two lines\nof subtitle");
    expect(source.generator.style.y).toBe(CAPTION_STYLE.y);
  });

  // Every key has to be one `textStyle` in text.ts actually reads, or the default is a promise with
  // nothing behind it -- and every value inside the range that file clamps to, or what is authored
  // is not what is drawn.
  it("uses only style keys the generator reads, at values it does not clamp away", async () => {
    const { doc } = await withCaptions();
    const source = clipsOf(doc)[0]?.source;
    if (source?.kind !== "generator" || source.generator.type !== "text") {
      throw new Error("not a text generator");
    }
    const bounds: Record<string, [number, number]> = {
      fontSize: [0.005, 1],
      fontWeight: [100, 900],
      lineHeight: [0.5, 4],
      x: [-2, 3],
      y: [-2, 3],
      maxWidth: [0.05, 4],
      strokeWidth: [0, 1],
      padding: [0, 4],
    };
    for (const [key, value] of Object.entries(source.generator.style)) {
      const range = bounds[key];
      if (range === undefined) {
        expect(["align", "color", "background", "strokeColor"]).toContain(key);
        continue;
      }
      expect(typeof value).toBe("number");
      expect(value as number).toBeGreaterThanOrEqual(range[0]);
      expect(value as number).toBeLessThanOrEqual(range[1]);
    }
  });

  it("is one clip the timeline can move and trim like any other", async () => {
    const { doc, track } = await withCaptions();
    const clip = clipsOf(doc)[0]!;
    doc.dispatch(cmd.clipMove(clip.id, track, 5000 * FLICKS_PER_MILLISECOND));
    doc.dispatch(cmd.clipTrim(clip.id, "end", 500 * FLICKS_PER_MILLISECOND));
    const moved = clipsOf(doc).find((candidate) => candidate.id === clip.id);
    expect(moved?.start).toBe(5000 * FLICKS_PER_MILLISECOND);
    expect(moved?.duration).toBe(1999 * FLICKS_PER_MILLISECOND);
  });

  it("splits into two captions that both carry the words, ready for one to be retyped", async () => {
    const { doc } = await withCaptions();
    const clip = clipsOf(doc)[1]!;
    doc.dispatch(cmd.clipSplit(clip.id, 3000 * FLICKS_PER_MILLISECOND));
    const halves = captionCues(doc.state).filter((cue) => cue.text.startsWith("Two lines"));
    expect(halves).toHaveLength(2);
    expect(halves[0]?.end).toBe(3000 * FLICKS_PER_MILLISECOND);
    expect(halves[1]?.start).toBe(3000 * FLICKS_PER_MILLISECOND);
  });

  it("retypes a caption without moving it", async () => {
    const { doc } = await withCaptions();
    const clip = clipsOf(doc)[0]!;
    const generator = clip.source.kind === "generator" ? clip.source.generator : undefined;
    if (generator?.type !== "text") throw new Error("not a text generator");
    doc.dispatch(cmd.clipSetGenerator(clip.id, { ...generator, content: "Corrected\nwords" }));
    expect(captionCues(doc.state)[0]).toEqual({
      start: 1001 * FLICKS_PER_MILLISECOND,
      end: 2500 * FLICKS_PER_MILLISECOND,
      text: "Corrected\nwords",
    });
  });
});

describe("merging two captions", () => {
  it("joins the words and reaches from the first head to the second tail", async () => {
    const { doc } = await withCaptions();
    const first = clipsOf(doc)[0]!;
    const key = "merge";
    for (const command of mergeCaptions(doc.state, first.id)) doc.dispatch(command, key);

    const cues = captionCues(doc.state);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({
      start: 1001 * FLICKS_PER_MILLISECOND,
      end: 4733 * FLICKS_PER_MILLISECOND,
      text: "Hello there\nTwo lines\nof subtitle",
    });
  });

  it("is one undo step, because a half-merged pair is not a state anyone asked for", async () => {
    const { doc } = await withCaptions();
    const before = captionCues(doc.state);
    const first = clipsOf(doc)[0]!;
    for (const command of mergeCaptions(doc.state, first.id)) doc.dispatch(command, "merge");
    doc.undo();
    expect(captionCues(doc.state)).toEqual(before);
  });

  it("has nothing to merge the last caption with, and says so instead of dropping it", async () => {
    const { doc } = await withCaptions();
    const last = clipsOf(doc)[2]!;
    expect(canMergeCaptions(doc.state, last.id)).toBe(false);
    expect(mergeCaptions(doc.state, last.id)).toEqual([]);
    expect(captionCues(doc.state)).toHaveLength(3);
  });

  // Array position is not time order: a track's clips are stored in the order they were added, and
  // merging with the next entry in the array would join two captions minutes apart.
  it("merges with the caption that comes next in time, not next in the array", async () => {
    const { doc, track } = await withCaptions();
    for (const command of captionClips(track, [
      { start: 1200 * FLICKS_PER_MILLISECOND, end: 1400 * FLICKS_PER_MILLISECOND, text: "Wedged in" },
    ])) {
      doc.dispatch(command);
    }
    const first = clipsOf(doc)[0]!;
    for (const command of mergeCaptions(doc.state, first.id)) doc.dispatch(command, "merge");
    expect(captionCues(doc.state)[0]?.text).toBe("Hello there\nWedged in");
  });
});

describe("writing a project's captions back out", () => {
  // The claim the whole feature rests on: the same file in and out, character for character,
  // through a real project and a real command layer rather than through the parser alone.
  it("gives back the very file that was imported, character for character", async () => {
    const { doc } = await withCaptions();
    expect(toSrt(captionCues(doc.state))).toBe(SRT);
  });

  it("gives back the same cues as a WebVTT that reads back identically", async () => {
    const { doc } = await withCaptions();
    const vtt = toVtt(captionCues(doc.state));
    expect(parseCaptions(vtt)).toEqual(parseCaptions(SRT));
  });

  it("survives a save and a reopen with every instant intact", async () => {
    const { doc } = await withCaptions();
    const bytes = doc.save(
      { appVersion: "test", created: "now", modified: "now", locale: "en" },
      new Map(),
    );
    const reopened = new VideolaDocument(await createWasmBackend(bytes));
    expect(toSrt(captionCues(reopened.state))).toBe(SRT);
  });

  it("leaves the titles on a text track out, because they are not subtitles", async () => {
    const { doc } = await withCaptions();
    doc.dispatch(cmd.trackAdd("text", "T1"));
    const text = doc.state.timeline.tracks[1]!.id;
    doc.dispatch(
      cmd.clipAdd(
        text,
        { kind: "generator", generator: { type: "text", content: "A lower third", style: {} } },
        0,
        FLICKS_PER_MILLISECOND * 1000,
      ),
    );
    expect(captionCues(doc.state).map((cue) => cue.text)).not.toContain("A lower third");
  });

  it("leaves a hidden caption track out, because nothing on it was shown", async () => {
    const { doc, track } = await withCaptions();
    doc.dispatch(cmd.trackSetFlags(track, null, null, null, true));
    expect(captionCues(doc.state)).toEqual([]);
  });

  it("writes the caption a drag left between two milliseconds to the nearer one", async () => {
    const { doc, track } = await withCaptions();
    const clip = clipsOf(doc)[0]!;
    doc.dispatch(cmd.clipMove(clip.id, track, 1001 * FLICKS_PER_MILLISECOND + 400_000));
    expect(toSrt(captionCues(doc.state))).toContain("00:00:01,002 -->");
  });
});
