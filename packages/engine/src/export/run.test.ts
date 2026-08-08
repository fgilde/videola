import { frameDuration, timeToSeconds } from "@videola/core";
import { AudioBuffer, OfflineAudioContext } from "node-web-audio-api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EXPORT_FORMATS } from "./format";
import { EXPORT_CANCELLED, exportFrames, frameTimes, startExport } from "./run";

import type { Project, Time } from "@videola/core";
import type { ExportRequest } from "./encode";
import type { ExportInput, ExportMessage } from "./run";

const NTSC = { numerator: 30000, denominator: 1001 };
const FLAT = { numerator: 30, denominator: 1 };
const SECOND = 705_600_000;

describe("frameTimes", () => {
  it("lands one frame duration apart, starting at the range", () => {
    const times = frameTimes({ from: 100, to: 100 + 3 * frameDuration(FLAT) }, FLAT);
    expect(times).toEqual([
      100,
      100 + frameDuration(FLAT),
      100 + 2 * frameDuration(FLAT),
    ]);
  });

  it("covers a second of NTSC with thirty frames, none of them off the ruler", () => {
    const times = frameTimes({ from: 0, to: SECOND }, NTSC);
    expect(times).toHaveLength(30);
    expect(times.every((at) => Number.isInteger(at))).toBe(true);
    expect(times[10]).toBe(10 * frameDuration(NTSC));
  });

  it("covers a range that ends inside a frame rather than dropping it", () => {
    const times = frameTimes({ from: 0, to: frameDuration(FLAT) + 1 }, FLAT);
    expect(times).toHaveLength(2);
  });

  it("has nothing to render for an empty or backwards range", () => {
    expect(frameTimes({ from: 500, to: 500 }, FLAT)).toEqual([]);
    expect(frameTimes({ from: 500, to: 100 }, FLAT)).toEqual([]);
  });
});

const PROJECT = {
  settings: { sampleRate: 48000 },
  library: [],
  timeline: { tracks: [] },
} as unknown as Project;

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    project: PROJECT,
    sourceTimes: (at: Time) => new Map([["clp_0", at * 2]]),
    options: {
      format: EXPORT_FORMATS[0]!,
      width: 320,
      height: 240,
      fps: FLAT,
      videoBitrate: 1_000_000,
      audioBitrate: 128_000,
      range: { from: 0, to: 3 * frameDuration(FLAT) },
    },
    ...overrides,
  };
}

describe("exportFrames", () => {
  it("asks the core where every clip reads from, once per output frame", () => {
    const asked: Time[] = [];
    const frames = exportFrames(
      input({
        sourceTimes: (at) => {
          asked.push(at);
          return new Map([["clp_0", at * 2]]);
        },
      }),
    );
    expect(asked).toEqual(frames.map((frame) => frame.at));
    expect(frames.map((frame) => frame.sources.get("clp_0"))).toEqual(
      frames.map((frame) => frame.at * 2),
    );
  });
});

// A worker that records what it was handed and answers on demand. Nothing here pretends to
// encode: the file this produces is proven in the browser harness, and what is proven here is the
// conversation around it.
class FakeWorker {
  posted: ExportRequest[] = [];
  transfers: Transferable[][] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<ExportMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: ExportRequest, transfer: Transferable[] = []): void {
    this.posted.push(request);
    this.transfers.push(transfer);
  }

  terminate(): void {
    this.terminated += 1;
  }

  send(message: ExportMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<ExportMessage>);
  }
}

function withWorker(overrides: Partial<ExportInput> = {}): {
  worker: FakeWorker;
  handle: ReturnType<typeof startExport>;
} {
  const worker = new FakeWorker();
  const handle = startExport(
    input({ createWorker: () => worker as unknown as Worker, ...overrides }),
  );
  return { worker, handle };
}

async function untilPosted(worker: FakeWorker): Promise<ExportRequest> {
  for (let attempt = 0; attempt < 400 && worker.posted.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const request = worker.posted[0];
  if (request === undefined) throw new Error("the export never reached the worker");
  return request;
}

describe("startExport", () => {
  it("hands the worker the frames and the options it was asked for", async () => {
    const { worker, handle } = withWorker();
    const request = await untilPosted(worker);
    expect(request.frames).toHaveLength(3);
    expect(request.width).toBe(320);
    expect(request.format.id).toBe("mp4");
    handle.cancel();
    await expect(handle.result).rejects.toThrow(EXPORT_CANCELLED);
  });

  it("reports progress as it arrives and resolves with the file", async () => {
    const onProgress = vi.fn();
    const { worker, handle } = withWorker({ onProgress });
    await untilPosted(worker);
    worker.send({ type: "progress", done: 1, total: 3 });
    worker.send({ type: "progress", done: 3, total: 3 });
    const result = { bytes: new Uint8Array([1, 2]), mimeType: "video/mp4", extension: "mp4" };
    worker.send({ type: "done", result });
    await expect(handle.result).resolves.toBe(result);
    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [3, 3],
    ]);
  });

  it("ends the worker once the file is there", async () => {
    const { worker, handle } = withWorker();
    await untilPosted(worker);
    worker.send({
      type: "done",
      result: { bytes: new Uint8Array(), mimeType: "video/mp4", extension: "mp4" },
    });
    await handle.result;
    expect(worker.terminated).toBe(1);
  });

  it("ends the worker on cancel and leaves nothing to resolve with", async () => {
    const { worker, handle } = withWorker();
    await untilPosted(worker);
    handle.cancel();
    expect(worker.terminated).toBeGreaterThan(0);
    await expect(handle.result).rejects.toThrow(EXPORT_CANCELLED);
    // A message that was already in flight when the worker was told to stop must not revive it.
    worker.send({
      type: "done",
      result: { bytes: new Uint8Array([9]), mimeType: "video/mp4", extension: "mp4" },
    });
    await expect(handle.result).rejects.toThrow(EXPORT_CANCELLED);
  });

  it("cancelling after the file arrived changes nothing", async () => {
    const { worker, handle } = withWorker();
    await untilPosted(worker);
    worker.send({
      type: "done",
      result: { bytes: new Uint8Array(), mimeType: "video/mp4", extension: "mp4" },
    });
    await handle.result;
    handle.cancel();
    expect(worker.terminated).toBe(1);
  });

  it("passes a failure on as the key the worker sent", async () => {
    const { worker, handle } = withWorker();
    await untilPosted(worker);
    worker.send({ type: "failed", reason: "error.exportFailed" });
    await expect(handle.result).rejects.toThrow("error.exportFailed");
  });

  it("does not wait for ever on a worker that died without a message", async () => {
    const { worker, handle } = withWorker();
    await untilPosted(worker);
    worker.onerror?.({ message: "boom" } as ErrorEvent);
    await expect(handle.result).rejects.toThrow("boom");
  });

  it("leaves out the audio for a project with nothing audible in it", async () => {
    const { worker, handle } = withWorker();
    const request = await untilPosted(worker);
    expect(request.audio).toBeUndefined();
    handle.cancel();
    await expect(handle.result).rejects.toThrow(EXPORT_CANCELLED);
  });
});

// The renderer is the real one from node-web-audio-api, installed where the browser would put it.
// Every sample below came out of the graph the export scheduled, so an offset that is off by a
// second or a plane that is never filled cannot pass.
const SAMPLE_RATE = 48_000;
const MEDIA = `med_${"a".repeat(64)}`;

const WEB_AUDIO = { OfflineAudioContext, AudioBuffer };
const original = Object.fromEntries(
  Object.keys(WEB_AUDIO).map((name) => [name, Reflect.get(globalThis, name) as unknown]),
);

afterEach(() => {
  for (const [name, value] of Object.entries(original)) Reflect.set(globalThis, name, value);
});

function installRenderer(): void {
  for (const [name, value] of Object.entries(WEB_AUDIO)) Reflect.set(globalThis, name, value);
}

function audibleProject(): Project {
  return {
    settings: { sampleRate: SAMPLE_RATE },
    library: [{ id: MEDIA, channels: 2, sampleRate: SAMPLE_RATE }],
    timeline: {
      tracks: [
        {
          id: "trk_0",
          kind: "audio",
          hidden: false,
          muted: false,
          solo: false,
          volume: 1,
          pan: 0,
          clips: [
            {
              id: "clp_0",
              source: { kind: "media", media: MEDIA },
              start: 0,
              duration: 2 * SECOND,
              inPoint: 0,
              speed: { rate: 1, reverse: false, preservePitch: true },
              volume: 1,
              pan: 0,
              fades: { inDuration: SECOND, outDuration: 0 },
            },
          ],
        },
      ],
    },
    master: { volume: 1, effects: [] },
  } as unknown as Project;
}

// A steady one on both channels, so anything other than one in the output is the graph's doing.
const steady = {
  async bufferFor(_hash: string, from: Time, to: Time): Promise<AudioBuffer> {
    const frames = Math.round(timeToSeconds(to - from) * SAMPLE_RATE);
    const buffer = new AudioBuffer({ length: frames, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    const data = new Float32Array(frames).fill(1);
    buffer.copyToChannel(data, 0);
    buffer.copyToChannel(data, 1);
    return buffer;
  },
};

describe("startExport, the sound", () => {
  it("renders the range offline and hands the planes over", async () => {
    installRenderer();
    const { worker, handle } = withWorker({
      project: audibleProject(),
      audioSource: steady,
      options: {
        ...input().options,
        range: { from: 0, to: SECOND },
      },
    });
    const request = await untilPosted(worker);
    expect(request.audio?.sampleRate).toBe(SAMPLE_RATE);
    expect(request.audio?.channels).toHaveLength(2);
    expect(request.audio?.channels[0]).toHaveLength(SAMPLE_RATE);
    // A one second fade-in over a one second range: silence at the start, full level at the end.
    expect(request.audio!.channels[0]![0]).toBeCloseTo(0, 3);
    expect(request.audio!.channels[0]![SAMPLE_RATE - 1]).toBeCloseTo(1, 2);
    handle.cancel();
    await expect(handle.result).rejects.toThrow(EXPORT_CANCELLED);
  });

  it("starts the sound where the range starts, not where the project does", async () => {
    installRenderer();
    const { worker, handle } = withWorker({
      project: audibleProject(),
      audioSource: steady,
      options: {
        ...input().options,
        range: { from: SECOND, to: SECOND + SECOND / 10 },
      },
    });
    const request = await untilPosted(worker);
    // A second into a one second fade-in, so the range opens at full level rather than at zero.
    expect(request.audio!.channels[0]![0]).toBeCloseTo(1, 2);
    handle.cancel();
    await expect(handle.result).rejects.toThrow(EXPORT_CANCELLED);
  });

  it("moves the planes rather than copying them", async () => {
    installRenderer();
    const { worker, handle } = withWorker({
      project: audibleProject(),
      audioSource: steady,
      options: { ...input().options, range: { from: 0, to: SECOND } },
    });
    await untilPosted(worker);
    expect(worker.transfers[0]).toHaveLength(2);
    handle.cancel();
    await expect(handle.result).rejects.toThrow(EXPORT_CANCELLED);
  });
});
