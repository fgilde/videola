import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cmd, timeToSeconds } from "@videola/core";
import { VideolaDocument } from "@videola/core/src/document";
import { initSync } from "@videola/core/src/wasm/videola_core.js";
import { createWasmBackend } from "@videola/core/src/wasm-backend";
import { OfflineAudioContext } from "node-web-audio-api";
import { beforeAll, describe, expect, it } from "vitest";

import type { MediaAsset, Project, Time, Track } from "@videola/core";

import { cutSilence, silentSpans } from "./silence";
import { AudioGraph } from "./graph";
import type { AudioBufferSource } from "./graph";

const SAMPLE_RATE = 48_000;
const SECOND = 705_600_000;
const MEDIA = `med_${"a".repeat(64)}`;

// The real Rust core, not a stand-in that splits clips by its own arithmetic. A split mints an id
// this code has to find again, and the whole of `cutSilence` is that lookup -- against a fake it
// would be checking its own assumption about which half keeps the id.
//
// Loaded the way packages/core/src/roundtrip.test.ts loads it: `initSync` from disk first, so the
// glue module's later fetch of a file:// URL short-circuits on its own guard.
beforeAll(() => {
  const wasm = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../core/src/wasm/videola_core_bg.wasm",
  );
  initSync({ module: readFileSync(wasm) });
});

const asset: MediaAsset = {
  id: MEDIA,
  originalName: "voice.wav",
  mime: "audio/wav",
  kind: "audio",
  sizeBytes: 1n,
  duration: 60 * SECOND,
  width: null,
  height: null,
  fps: null,
  sampleRate: SAMPLE_RATE,
  channels: 2,
} as MediaAsset;

async function timeline(): Promise<VideolaDocument> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("audio", "A1"));
  doc.dispatch(cmd.mediaImport(asset));
  return doc;
}

const trackId = (doc: VideolaDocument): string => doc.state.timeline.tracks[0]!.id;
const clips = (doc: VideolaDocument): readonly { start: Time; duration: Time }[] =>
  doc.state.timeline.tracks[0]!.clips;
const spans = (doc: VideolaDocument): [number, number][] =>
  clips(doc).map((clip) => [
    Math.round(timeToSeconds(clip.start) * 100) / 100,
    Math.round(timeToSeconds(clip.start + clip.duration) * 100) / 100,
  ]);

async function withClip(from = 0, seconds = 10): Promise<VideolaDocument> {
  const doc = await timeline();
  doc.dispatch(
    cmd.clipAdd(trackId(doc), { kind: "media", media: MEDIA }, from * SECOND, seconds * SECOND),
  );
  return doc;
}

const quiet = (from: number, to: number): { from: Time; to: Time } => ({
  from: from * SECOND,
  to: to * SECOND,
});

describe("cutSilence against the real core", () => {
  it("takes a stretch out of the middle and leaves the two halves where they were", async () => {
    const doc = await withClip();

    const cut = cutSilence(doc, trackId(doc), [quiet(4, 6)]);

    expect(cut).toBe(1);
    expect(spans(doc)).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it("takes a stretch off the front", async () => {
    const doc = await withClip();

    cutSilence(doc, trackId(doc), [quiet(0, 3)]);

    expect(spans(doc)).toEqual([[3, 10]]);
  });

  it("takes a stretch off the back", async () => {
    const doc = await withClip();

    cutSilence(doc, trackId(doc), [quiet(7, 10)]);

    expect(spans(doc)).toEqual([[0, 7]]);
  });

  it("removes a clip that is quiet from end to end", async () => {
    const doc = await withClip();

    cutSilence(doc, trackId(doc), [quiet(0, 10)]);

    expect(clips(doc)).toHaveLength(0);
  });

  // Several cuts in one pass is where the ids move under the caller: each split leaves the later
  // half under a new one. Taken from the back forwards, every span still finds the clip it meant.
  it("takes three stretches out in one pass", async () => {
    const doc = await withClip();

    const cut = cutSilence(doc, trackId(doc), [quiet(1, 2), quiet(4, 5), quiet(7, 8)]);

    expect(cut).toBe(3);
    expect(spans(doc)).toEqual([
      [0, 1],
      [2, 4],
      [5, 7],
      [8, 10],
    ]);
  });

  it("takes them out in the same places whatever order they arrive in", async () => {
    const doc = await withClip();

    cutSilence(doc, trackId(doc), [quiet(7, 8), quiet(1, 2), quiet(4, 5)]);

    expect(spans(doc)).toEqual([
      [0, 1],
      [2, 4],
      [5, 7],
      [8, 10],
    ]);
  });

  // A gap and not a ripple: everything after the cut stays where it was, because the picture the
  // voice belongs to is on another track and does not move with it.
  it("leaves what follows the cut where it stands", async () => {
    const doc = await timeline();
    const track = trackId(doc);
    doc.dispatch(cmd.clipAdd(track, { kind: "media", media: MEDIA }, 0, 5 * SECOND));
    doc.dispatch(cmd.clipAdd(track, { kind: "media", media: MEDIA }, 6 * SECOND, 4 * SECOND));

    cutSilence(doc, track, [quiet(1, 2)]);

    expect(spans(doc)).toEqual([
      [0, 1],
      [2, 5],
      [6, 10],
    ]);
  });

  it("clamps a stretch that runs off the end of the clip", async () => {
    const doc = await withClip(0, 5);

    cutSilence(doc, trackId(doc), [quiet(3, 20)]);

    expect(spans(doc)).toEqual([[0, 3]]);
  });

  it("does nothing for a stretch with no clip under it", async () => {
    const doc = await withClip(0, 5);

    expect(cutSilence(doc, trackId(doc), [quiet(8, 9)])).toBe(0);
    expect(spans(doc)).toEqual([[0, 5]]);
  });

  it("does nothing for a track that is not there", async () => {
    const doc = await withClip();

    expect(cutSilence(doc, "trk_missing", [quiet(4, 6)])).toBe(0);
  });

  // One coalesce key, one entry on the undo stack: a cut that took nine steps to apply has to come
  // back in one.
  it("comes back in a single undo", async () => {
    const doc = await withClip();

    cutSilence(doc, trackId(doc), [quiet(1, 2), quiet(4, 5)], "cut-silence-1");
    doc.undo();

    expect(spans(doc)).toEqual([[0, 10]]);
  });
});

// End to end: real samples, decoded by the real graph, peaked by the real peak reader, detected,
// and then cut by the real core. Nothing between the signal and the timeline is stood in for.
describe("silence detection and cutting, end to end", () => {
  function bursts(...windows: readonly [number, number][]): AudioBufferSource {
    return {
      async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
        const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
        const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
        const buffer = ctx.createBuffer(2, frames, SAMPLE_RATE);
        const data = new Float32Array(frames);
        for (let i = 0; i < frames; i += 1) {
          const seconds = i / SAMPLE_RATE;
          data[i] = windows.some(([a, b]) => seconds >= a && seconds < b)
            ? Math.sin(2 * Math.PI * 1000 * seconds)
            : 0;
        }
        buffer.copyToChannel(data, 0);
        buffer.copyToChannel(data, 1);
        return buffer as unknown as AudioBuffer;
      },
    };
  }

  it("cuts a clip down to the two stretches that actually sound", async () => {
    const doc = await withClip(0, 10);
    const graph = new AudioGraph(
      new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE) as unknown as BaseAudioContext,
      bursts([1, 3], [6, 8]),
    );
    await graph.prepare(doc.state as Project);
    const track = doc.state.timeline.tracks[0] as Track;

    const found = silentSpans(track, graph.waveforms(400));
    cutSilence(doc, trackId(doc), found);

    // The detector pads each phrase by a tenth of a second at both ends, so the cuts fall there and
    // not on the first syllable.
    expect(spans(doc)).toEqual([
      [0.9, 3.1],
      [5.9, 8.1],
    ]);
  });

  // The two axes crossing: silence *and* a clip that runs backwards. The signal is at the head of
  // the medium and therefore at the tail of what is heard, so a detector working in source time
  // would cut away the only part that sounds.
  it("cuts a reversed clip where it is heard, not where it was recorded", async () => {
    const doc = await withClip(0, 10);
    doc.dispatch(cmd.clipSetSpeed(doc.state.timeline.tracks[0]!.clips[0]!.id, 1, true));
    const graph = new AudioGraph(
      new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE) as unknown as BaseAudioContext,
      bursts([0, 2]),
    );
    await graph.prepare(doc.state as Project);
    const track = doc.state.timeline.tracks[0] as Track;

    const found = silentSpans(track, graph.waveforms(400));
    cutSilence(doc, trackId(doc), found);

    expect(spans(doc)).toEqual([[7.9, 10]]);
  });
});
