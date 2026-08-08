import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cmd, createWasmBackend, FLICKS_PER_SECOND, VideolaDocument } from "@videola/core";
import { OfflineAudioContext } from "node-web-audio-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Clip, MediaAsset, Project, SourceTimes, Time, Track } from "@videola/core";

import { initSync } from "../../core/src/wasm/videola_core.js";
import { AudioGraph } from "./audio/graph";
import { Playback } from "./playback";
import type { AudioTransport, FrameSource } from "./playback";
import { Compositor } from "./render/compositor";
import { recordingGl } from "./render/recording-gl";
import type { Recording } from "./render/recording-gl";

const SECOND = FLICKS_PER_SECOND;
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const MEDIA = `med_${HASH}`;
const OTHER_MEDIA = `med_${OTHER_HASH}`;
const SAMPLE_RATE = 48_000;
const NTSC_FRAME = Math.round((FLICKS_PER_SECOND * 1001) / 30000);

// The same trick roundtrip.test.ts uses: the glue loads its module over fetch(file://), which
// Node does not implement, so the bytes go in from disk first and init() finds itself done.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "core", "src", "wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

// Frames belong to the FrameCache. Playback may hand one on and read nothing off it; the
// compositor reads exactly three properties before the upload. Everything else throws rather than
// answering helpfully -- a frame that still answers after close() is what hid an unbounded cache
// from its own budget test in group B.
function frame(): VideoFrame {
  const readable: Record<string, unknown> = { format: "RGBA", codedWidth: 8, codedHeight: 8 };
  return new Proxy(readable, {
    get(target, key) {
      if (key in target) return target[key as string];
      // A frame travels through a promise on its way here, and resolving one asks for `then`.
      // A real VideoFrame answers undefined, so this one has to as well.
      if (key === "then") return undefined;
      throw new Error(`playback read ${String(key)} off a frame it does not own`);
    },
  }) as unknown as VideoFrame;
}

function asset(id: string): MediaAsset {
  return {
    id,
    originalName: "clip.mp4",
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 1n,
    duration: 10 * SECOND,
    width: 1920,
    height: 1080,
    fps: { numerator: 30000, denominator: 1001 },
    sampleRate: SAMPLE_RATE,
    channels: 2,
  } as MediaAsset;
}

function clip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id,
    source: { kind: "media", media: MEDIA },
    start: 0,
    duration: 4 * SECOND,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
    ...over,
  } as Clip;
}

function project(clips: Clip[], library: MediaAsset[] = [asset(MEDIA)]): Project {
  return {
    settings: {
      width: 1920,
      height: 1080,
      fps: { numerator: 30000, denominator: 1001 },
      sampleRate: SAMPLE_RATE,
      background: "#000000",
    },
    library,
    timeline: {
      tracks: [
        {
          id: "trk_0",
          kind: "video",
          hidden: false,
          muted: false,
          solo: false,
          volume: 1,
          pan: 0,
          clips,
        } as Track,
      ],
    },
    master: { volume: 1, effects: [] },
  } as unknown as Project;
}

// currentTime only ever moves forward, and only when a test moves it -- the discipline the
// clock's own tests keep. `state` and `resume` are what playback steers, and suspended is the
// state a freshly built context is really in.
class FakeTransport implements AudioTransport {
  #now = 0;
  #release?: () => void;
  state: AudioContextState = "running";
  resumed = 0;

  get currentTime(): number {
    return this.#now;
  }

  advance(seconds: number): void {
    this.#now += seconds;
  }

  resume(): Promise<void> {
    this.resumed += 1;
    return new Promise((resolve) => {
      this.#release = () => {
        this.state = "running";
        resolve();
      };
    });
  }

  async wakeUp(): Promise<void> {
    this.#release?.();
    this.#release = undefined;
    await settle();
  }
}

interface Ask {
  hash: string;
  at: Time;
}

// A recorder for VideoSource, not a simulator: everything below `frameAt` needs WebCodecs and is
// proven in the browser instead.
class FakeSources {
  asks: Ask[] = [];
  opened: string[] = [];
  closed: string[] = [];
  missing = new Set<string>();
  answer: (ask: Ask) => VideoFrame | undefined = () => frame();
  #waiting: ((frame: VideoFrame | undefined) => void)[] = [];
  #holding = false;

  hold(): void {
    this.#holding = true;
  }

  release(): void {
    const waiting = this.#waiting;
    this.#waiting = [];
    this.#holding = false;
    for (const resolve of waiting) resolve(frame());
  }

  create = (): FrameSource => {
    let hash = "";
    return {
      open: async (opening: string): Promise<void> => {
        hash = opening;
        this.opened.push(opening);
        if (this.missing.has(opening)) throw new Error("error.mediaMissing");
      },
      frameAt: (at: Time): Promise<VideoFrame | undefined> => {
        const ask = { hash, at };
        this.asks.push(ask);
        if (!this.#holding) return Promise.resolve(this.answer(ask));
        return new Promise((resolve) => void this.#waiting.push(resolve));
      },
      close: (): void => void this.closed.push(hash),
    };
  };
}

function tone(ctx: BaseAudioContext): { bufferFor: () => Promise<AudioBuffer> } {
  return {
    bufferFor: async (): Promise<AudioBuffer> => {
      const buffer = ctx.createBuffer(2, SAMPLE_RATE, SAMPLE_RATE);
      const full = new Float32Array(SAMPLE_RATE).fill(1);
      buffer.copyToChannel(full, 0);
      buffer.copyToChannel(full, 1);
      return buffer;
    },
  };
}

interface Rig {
  playback: Playback;
  transport: FakeTransport;
  sources: FakeSources;
  graph: AudioGraph;
  ctx: OfflineAudioContext;
  recording: Recording;
  sourceTimes: SourceTimes;
}

function rig(times: SourceTimes = () => new Map()): Rig {
  const transport = new FakeTransport();
  const sources = new FakeSources();
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  const shared = ctx as unknown as BaseAudioContext;
  const graph = new AudioGraph(shared, tone(shared));
  const sourceTimes = vi.fn(times);
  const playback = new Playback({
    audio: transport,
    graph,
    sourceTimes,
    effectParams: () => new Map(),
    transforms: () => new Map(),
    createFrameSource: sources.create,
  });
  const recording = recordingGl(LOSE_CONTEXT);
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(recording.gl as never);
  playback.attach(canvas);
  return { playback, transport, sources, graph, ctx, recording, sourceTimes };
}

function times(entries: (at: Time) => [string, Time][]): SourceTimes {
  return (at) => new Map(entries(at));
}

// The recorder answers every call with a token, and disposing a context calls a method on one of
// them. Playback owns the context it built in attach(), so dispose() really does go there.
const LOSE_CONTEXT = { getExtension: (): unknown => ({ loseContext: (): void => undefined }) };

const uploads = (recording: Recording): unknown[] =>
  recording.named("texImage2D").map((call) => call.args[5]);

const renders = (recording: Recording): number => recording.named("clear").length;

let animationFrames = new Map<number, FrameRequestCallback>();
let nextHandle = 1;

function runFrame(): void {
  const due = [...animationFrames.values()];
  animationFrames.clear();
  for (const callback of due) callback(0);
}

// Gathering frames is asynchronous and the render lands on the far side of it, so anything the
// tick chain queued has to run before an assertion looks at the picture.
async function settle(): Promise<void> {
  for (let round = 0; round < 32; round += 1) await Promise.resolve();
}

beforeEach(() => {
  animationFrames = new Map();
  nextHandle = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    animationFrames.set(handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => void animationFrames.delete(handle));
});

afterEach(() => vi.unstubAllGlobals());

describe("Playback", () => {
  it("shows the moment the core answers for, at the source times it hands back", async () => {
    const { playback, sources, sourceTimes } = rig(times((at) => [["clp_1", at + SECOND]]));
    await playback.load(project([clip("clp_1")]));

    playback.seek(2 * SECOND);
    await settle();

    expect(sourceTimes).toHaveBeenCalledWith(2 * SECOND);
    expect(sources.asks).toEqual([{ hash: HASH, at: 3 * SECOND }]);
  });

  it("asks for both clips where they overlap and for neither outside them", async () => {
    const { playback, sources } = rig(
      times((at) => [
        ["clp_1", at],
        ["clp_2", at - 3 * SECOND],
      ]),
    );
    await playback.load(
      project([clip("clp_1"), clip("clp_2", { start: 3 * SECOND, duration: 4 * SECOND })]),
    );

    playback.seek(3.5 * SECOND);
    await settle();
    expect(sources.asks.map((ask) => ask.at)).toEqual([3.5 * SECOND, 0.5 * SECOND]);

    sources.asks = [];
    playback.seek(6 * SECOND);
    await settle();
    expect(sources.asks.map((ask) => ask.at)).toEqual([3 * SECOND]);

    sources.asks = [];
    playback.seek(8 * SECOND);
    await settle();
    expect(sources.asks).toEqual([]);
  });

  // The map itself is the subject, not what the compositor makes of it: an entry whose value is
  // undefined types as a VideoFrame and would reach the effect chain and the export worker as
  // one. Absent and present-but-empty are the same picture today and different bugs later.
  it("leaves a clip whose frame is missing out of the map instead of passing undefined", async () => {
    const handed = vi.spyOn(Compositor.prototype, "render");
    const { playback, sources, recording } = rig(
      times((at) => [
        ["clp_1", at],
        ["clp_2", at],
      ]),
    );
    await playback.load(project([clip("clp_1"), clip("clp_2")]));
    sources.answer = (ask): VideoFrame | undefined =>
      sources.asks.indexOf(ask) === 0 ? undefined : frame();

    playback.seek(SECOND);
    await settle();

    const frames = handed.mock.lastCall![2];
    expect([...frames.keys()]).toEqual(["clp_2"]);
    expect([...frames.values()].every((value) => value !== undefined)).toBe(true);
    expect(renders(recording)).toBe(1);
    expect(uploads(recording)).toHaveLength(1);
  });

  // A solid or a title has no medium behind it. The draw list already drops them for want of a
  // size, but the load walks every clip in the timeline and would trip over one first.
  it("walks past a clip that has no medium at all", async () => {
    const { playback, sources } = rig(times((at) => [["clp_1", at]]));

    await playback.load(
      project([clip("clp_1", { source: { kind: "generator", generator: { type: "solid", color: "#000" } } })]),
    );
    playback.seek(SECOND);
    await settle();

    expect(sources.opened).toEqual([]);
  });

  it("never asks a source for a clip the core did not answer for", async () => {
    const { playback, sources } = rig();
    await playback.load(project([clip("clp_1")]));

    playback.seek(SECOND);
    await settle();

    expect(sources.asks).toEqual([]);
  });

  it("opens one source per medium, however many clips share it", async () => {
    const { playback, sources } = rig(
      times((at) => [
        ["clp_1", at],
        ["clp_2", at],
      ]),
    );
    await playback.load(project([clip("clp_1"), clip("clp_2")]));

    playback.seek(SECOND);
    await settle();
    playback.seek(2 * SECOND);
    await settle();

    expect(sources.opened).toEqual([HASH]);
  });

  it("keeps one medium's failure from costing the others their picture", async () => {
    const { playback, sources, recording } = rig(
      times((at) => [
        ["clp_1", at],
        ["clp_2", at],
      ]),
    );
    sources.missing.add(HASH);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await playback.load(
      project(
        [clip("clp_1"), clip("clp_2", { source: { kind: "media", media: OTHER_MEDIA } })],
        [asset(MEDIA), asset(OTHER_MEDIA)],
      ),
    );

    playback.seek(SECOND);
    await settle();

    expect(sources.opened).toEqual([HASH, OTHER_HASH]);
    expect(uploads(recording)).toHaveLength(1);
  });

  it("drops the ticks a decode overtook and paints the newest position", async () => {
    const { playback, sources, recording } = rig(times((at) => [["clp_1", at]]));
    await playback.load(project([clip("clp_1")]));
    sources.hold();

    playback.seek(SECOND);
    playback.seek(2 * SECOND);
    playback.seek(3 * SECOND);
    sources.release();
    await settle();

    // Two decodes, not four: the one in flight, then the newest position. A picture nobody is
    // waiting for any more is worse than no picture.
    expect(sources.asks.map((ask) => ask.at)).toEqual([SECOND, 3 * SECOND]);
    expect(renders(recording)).toBe(2);
  });

  it("closes a medium the project stopped using and reopens it if it comes back", async () => {
    const { playback, sources } = rig(times((at) => [["clp_1", at]]));
    await playback.load(project([clip("clp_1")]));
    playback.seek(SECOND);
    await settle();

    await playback.load(project([]));
    expect(sources.closed).toEqual([HASH]);

    await playback.load(project([clip("clp_1")]));
    playback.seek(SECOND);
    await settle();
    expect(sources.opened).toEqual([HASH, HASH]);
  });

  // Relinking puts the bytes back without touching the project, so nothing else in here would
  // ever ask again -- the failure is remembered on purpose, and this is the one way out of it.
  it("tries a medium again once it has been told to forget the failure", async () => {
    const { playback, sources, recording } = rig(times((at) => [["clp_1", at]]));
    sources.missing.add(HASH);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await playback.load(project([clip("clp_1")]));
    playback.seek(SECOND);
    await settle();

    playback.refresh();
    await settle();
    expect(sources.opened).toEqual([HASH]);
    expect(uploads(recording)).toHaveLength(0);

    sources.missing.delete(HASH);
    playback.forget(HASH);
    playback.refresh();
    await settle();

    expect(sources.opened).toEqual([HASH, HASH]);
    expect(uploads(recording)).toHaveLength(1);
  });

  it("closes every source on dispose and stops painting afterwards", async () => {
    const { playback, sources, recording } = rig(times((at) => [["clp_1", at]]));
    await playback.load(project([clip("clp_1")]));
    playback.seek(SECOND);
    await settle();
    const painted = renders(recording);

    playback.dispose();
    playback.seek(2 * SECOND);
    await settle();

    expect(sources.closed).toEqual([HASH]);
    expect(renders(recording)).toBe(painted);
  });

  // An edit and a canvas resize both need the picture back where it already is. Sending them
  // through seek would rebuild the whole audio graph, once per keystroke.
  it("repaints where it stands without rescheduling the sound", async () => {
    const { playback, graph, recording, sourceTimes } = rig(times((at) => [["clp_1", at]]));
    await playback.load(project([clip("clp_1")]));
    playback.seek(2 * SECOND);
    playback.play();
    await settle();
    const painted = renders(recording);
    const startAt = vi.spyOn(graph, "startAt");

    playback.refresh();
    await settle();

    expect(renders(recording)).toBe(painted + 1);
    expect(sourceTimes).toHaveBeenLastCalledWith(2 * SECOND);
    expect(startAt).not.toHaveBeenCalled();
  });

  it("paints nothing on a refresh after dispose", async () => {
    const { playback, recording } = rig(times((at) => [["clp_1", at]]));
    await playback.load(project([clip("clp_1")]));
    playback.seek(SECOND);
    await settle();
    const painted = renders(recording);

    playback.dispose();
    playback.refresh();
    await settle();

    expect(renders(recording)).toBe(painted);
  });

  it("keeps time before a canvas is attached instead of throwing on every tick", async () => {
    const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE) as unknown as BaseAudioContext;
    const sources = new FakeSources();
    const playback = new Playback({
      audio: new FakeTransport(),
      graph: new AudioGraph(ctx, tone(ctx)),
      sourceTimes: times((at) => [["clp_1", at]]),
      effectParams: () => new Map(),
    transforms: () => new Map(),
      createFrameSource: sources.create,
    });
    await playback.load(project([clip("clp_1")]));

    playback.seek(SECOND);
    await settle();

    expect(playback.now()).toBe(SECOND);
    expect(sources.opened).toEqual([]);
  });
});

describe("Playback transport", () => {
  it("does not call itself playing while the context is still suspended", async () => {
    const { playback, transport, graph } = rig();
    const startAt = vi.spyOn(graph, "startAt");
    transport.state = "suspended";
    await playback.load(project([]));

    playback.play();

    // The trap: currentTime stands still on a suspended context, so a clock started here would
    // report a frozen position while every consumer believed playback had begun.
    expect(playback.isPlaying).toBe(false);
    expect(startAt).not.toHaveBeenCalled();

    await transport.wakeUp();

    expect(transport.resumed).toBe(1);
    expect(playback.isPlaying).toBe(true);
    expect(startAt).toHaveBeenCalledOnce();
  });

  it("starts in the same turn when the context is already awake", async () => {
    const { playback, transport } = rig();
    await playback.load(project([]));

    playback.play();

    expect(playback.isPlaying).toBe(true);
    expect(transport.resumed).toBe(0);
  });

  it("does not start after a pause that landed while the context was waking up", async () => {
    const { playback, transport, graph } = rig();
    const startAt = vi.spyOn(graph, "startAt");
    transport.state = "suspended";
    await playback.load(project([]));

    playback.play();
    playback.pause();
    await transport.wakeUp();

    expect(playback.isPlaying).toBe(false);
    expect(startAt).not.toHaveBeenCalled();
  });

  it("resumes once for a run of play calls", async () => {
    const { playback, transport } = rig();
    transport.state = "suspended";
    await playback.load(project([]));

    playback.play();
    playback.play();
    playback.play();
    await transport.wakeUp();

    expect(transport.resumed).toBe(1);
  });

  it("advances with the audio clock and paints every tick", async () => {
    const { playback, transport, recording } = rig(times((at) => [["clp_1", at]]));
    await playback.load(project([clip("clp_1")]));
    const seen: Time[] = [];
    playback.onTime((at) => void seen.push(at));

    playback.play();
    await settle();
    transport.advance(0.5);
    runFrame();
    await settle();
    transport.advance(0.5);
    runFrame();
    await settle();

    expect(seen).toEqual([0, 0.5 * SECOND, SECOND]);
    expect(renders(recording)).toBe(3);
  });

  it("rebuilds the sound at the new position when a seek lands mid-playback", async () => {
    const { playback, transport, graph } = rig();
    await playback.load(project([]));
    const startAt = vi.spyOn(graph, "startAt");

    playback.play();
    transport.advance(1);
    playback.seek(10 * SECOND);

    expect(startAt).toHaveBeenLastCalledWith(1, 10 * SECOND);
  });

  it("leaves the sound alone when a seek lands while paused", async () => {
    const { playback, graph } = rig();
    await playback.load(project([]));
    const startAt = vi.spyOn(graph, "startAt");

    playback.seek(10 * SECOND);

    expect(startAt).not.toHaveBeenCalled();
  });

  it("stops the sound on pause", async () => {
    const { playback, graph } = rig();
    await playback.load(project([]));
    const stop = vi.spyOn(graph, "stop");

    playback.play();
    playback.pause();

    expect(stop).toHaveBeenCalled();
  });

  it("steps by a whole NTSC frame, not by a thirtieth of a second", async () => {
    const { playback } = rig();
    await playback.load(project([]));

    playback.seek(10 * NTSC_FRAME);
    playback.stepFrame(1);
    expect(playback.now()).toBe(11 * NTSC_FRAME);

    playback.stepFrame(-1);
    expect(playback.now()).toBe(10 * NTSC_FRAME);
    expect(NTSC_FRAME).not.toBe(Math.round(FLICKS_PER_SECOND / 30));
  });

  it("stops rolling when a frame step lands mid-playback", async () => {
    const { playback } = rig();
    await playback.load(project([]));

    playback.play();
    playback.stepFrame(1);

    expect(playback.isPlaying).toBe(false);
  });

  it("never steps below zero", async () => {
    const { playback } = rig();
    await playback.load(project([]));

    playback.stepFrame(-1);

    expect(playback.now()).toBe(0);
  });
});

// Sound and picture cross here: the same seek that moves the playhead has to move the audio, and
// these samples come out of a real renderer rather than out of a spy.
describe("Playback sound", () => {
  async function rendered(playhead: Time): Promise<Float32Array> {
    const { playback, ctx } = rig();
    await playback.load(project([clip("clp_1", { start: SECOND, duration: SECOND })]));
    playback.seek(playhead);
    playback.play();
    const buffer = await ctx.startRendering();
    return buffer.getChannelData(0) as unknown as Float32Array;
  }

  it("starts a clip where the playhead stands, not where the timeline does", async () => {
    const samples = await rendered(SECOND);

    expect(samples[0]).toBeCloseTo(1, 3);
    expect(samples[SAMPLE_RATE / 2]).toBeCloseTo(1, 3);
  });

  it("stays silent for a clip the playhead has not reached", async () => {
    const samples = await rendered(0);

    expect(samples[0]).toBe(0);
    expect(samples[SAMPLE_RATE - 1]).toBe(0);
  });
});

// The crossing the ledger asks for: the clamp is in Rust, the decoder call in TypeScript, and
// nothing between them is faked. A reversed clip's first frame is where the two meet.
describe("Playback against the real core", () => {
  it("asks for a source time a decoder can read at the head of a reversed clip", async () => {
    const doc = new VideolaDocument(await createWasmBackend());
    doc.dispatch(cmd.mediaImport(asset(MEDIA)));
    doc.dispatch(cmd.trackAdd("video", "V1"));
    doc.dispatch(
      cmd.clipAdd(
        doc.state.timeline.tracks[0]!.id,
        { kind: "media", media: MEDIA },
        0,
        4 * SECOND,
      ),
    );
    doc.dispatch(cmd.clipSetSpeed(doc.state.timeline.tracks[0]!.clips[0]!.id, 2, true));
    const reversed = doc.state.timeline.tracks[0]!.clips[0]!;

    const sources = new FakeSources();
    const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE) as unknown as BaseAudioContext;
    const playback = new Playback({
      audio: new FakeTransport(),
      graph: new AudioGraph(ctx, tone(ctx)),
      sourceTimes: doc.sourceTimesAt,
      effectParams: doc.effectParamsAt,
      transforms: doc.transformsAt,
      createFrameSource: sources.create,
    });
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(recordingGl(LOSE_CONTEXT).gl as never);
    playback.attach(canvas);
    await playback.load(doc.state);

    playback.seek(0);
    await settle();

    const consumed = reversed.duration * reversed.speed.rate;
    expect(consumed).toBe(8 * SECOND);
    expect(sources.asks).toEqual([{ hash: HASH, at: reversed.inPoint + consumed - 1 }]);
  });
});
