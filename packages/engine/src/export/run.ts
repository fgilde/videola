import { frameDuration, timeToSeconds } from "@videola/core";

import type { EffectParams, Project, Rate, SourceTimes, Time } from "@videola/core";

import { AudioGraph, hasAudibleClips } from "../audio/graph";
import { AudioSource } from "../decode/audio-source";
import type { AudioBufferSource } from "../audio/graph";
import type { ExportAudio, ExportFrame, ExportRequest } from "./encode";
import type { ExportFormat } from "./format";

export interface ExportRange {
  from: Time;
  to: Time;
}

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  fps: Rate;
  videoBitrate: number;
  audioBitrate: number;
  range: ExportRange;
}

export interface ExportResult {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
  extension: string;
}

export type ExportMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "done"; result: ExportResult }
  | { type: "failed"; reason: string; detail?: string };

export interface ExportInput {
  project: Project;
  sourceTimes: SourceTimes;
  effectParams: EffectParams;
  options: ExportOptions;
  onProgress?: (done: number, total: number) => void;
  createWorker?: () => Worker;
  audioSource?: AudioBufferSource;
}

export interface ExportHandle {
  readonly result: Promise<ExportResult>;
  cancel(): void;
}

export const EXPORT_CANCELLED = "export.cancelled";

// Every output frame sits on the project's own ruler: the range start plus whole frame durations
// in flicks, so a run at 30000/1001 lands on the same instants the timeline shows. The end is
// covered rather than truncated -- a range that stops mid-frame still gets that frame, because a
// file one frame shorter than the range asked for is a bug nobody notices until they compare.
export function frameTimes(range: ExportRange, fps: Rate): Time[] {
  const step = frameDuration(fps);
  const count = Math.max(0, Math.ceil((range.to - range.from) / step));
  return Array.from({ length: count }, (_, index) => range.from + index * step);
}

// The core is the only thing that knows where a clip reads from, and it lives on this thread --
// `WasmDocument` can be built from a `.videola` file and from nothing, never from a `Project`.
//
// ponytail: so the whole range is asked for up front. At 30 fps an hour is 108000 calls across the
// wasm boundary, about a second of work before the export starts. The way out is a document handle
// in the worker, which needs the core to accept a `Project`.
export function exportFrames(input: ExportInput): ExportFrame[] {
  return frameTimes(input.options.range, input.options.fps).map((at) => ({
    at,
    sources: input.sourceTimes(at),
    params: input.effectParams(at),
  }));
}

export function startExport(input: ExportInput): ExportHandle {
  const worker = (input.createWorker ?? spawnWorker)();
  let settled = false;
  let abort: (reason: Error) => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = reject;
  });
  const result = Promise.race([cancelled, run(worker, input)]).finally(() => {
    settled = true;
    worker.terminate();
  });
  // Nobody is listening between here and the caller's `await`, and an unobserved rejection in that
  // window is reported as a crash by every runtime.
  result.catch(() => undefined);

  return {
    result,
    cancel(): void {
      if (settled) return;
      // The half-written file only ever exists in the worker's heap, so ending the worker is the
      // whole of discarding it -- there is nothing on disk to clean up.
      worker.terminate();
      abort(new Error(EXPORT_CANCELLED));
    },
  };
}

async function run(worker: Worker, input: ExportInput): Promise<ExportResult> {
  const request: ExportRequest = {
    project: input.project,
    format: input.options.format,
    width: input.options.width,
    height: input.options.height,
    fps: input.options.fps,
    videoBitrate: input.options.videoBitrate,
    audioBitrate: input.options.audioBitrate,
    frames: exportFrames(input),
    audio: await renderAudio(input),
  };
  return exchange(worker, request, input.onProgress);
}

function exchange(
  worker: Worker,
  request: ExportRequest,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ExportMessage>): void => {
      const message = event.data;
      if (message.type === "progress") onProgress?.(message.done, message.total);
      else if (message.type === "done") resolve(message.result);
      else reject(new Error(message.reason, { cause: message.detail }));
    };
    // A worker that dies of a syntax error or an out-of-memory kill sends no message at all, and
    // without this the export would sit at whatever percentage it had reached for ever.
    worker.onerror = (event: ErrorEvent): void => {
      reject(new Error(event.message.length > 0 ? event.message : "error.exportFailed"));
    };
    worker.postMessage(request, transfers(request));
  });
}

function transfers(request: ExportRequest): Transferable[] {
  return (request.audio?.channels ?? []).map((plane) => plane.buffer as ArrayBuffer);
}

// Web Audio is a Window API: `OfflineAudioContext` is undefined in a worker -- measured in the
// browser, not assumed -- so the sound is rendered here and the samples travel as raw planes.
// This does not block the interface: `startRendering` hands the graph to the audio thread and
// resolves when it is finished, as fast as the machine manages rather than in real time.
async function renderAudio(input: ExportInput): Promise<ExportAudio | undefined> {
  const { project, options } = input;
  if (!hasAudibleClips(project)) return undefined;
  const sampleRate = project.settings.sampleRate;
  const length = Math.max(
    1,
    Math.round(timeToSeconds(options.range.to - options.range.from) * sampleRate),
  );
  const context = new OfflineAudioContext(2, length, sampleRate);
  const graph = new AudioGraph(context, input.audioSource ?? new AudioSource());
  await graph.prepare(project);
  // The offline context's clock stands at zero until it renders, so the range start is the whole
  // of the offset -- the same call playback makes, with wall time taken out of it.
  graph.startAt(0, options.range.from);
  const rendered = await context.startRendering();
  return {
    sampleRate,
    channels: Array.from({ length: rendered.numberOfChannels }, (_, channel) => {
      const plane = new Float32Array(rendered.length);
      rendered.copyFromChannel(plane, channel);
      return plane;
    }),
  };
}

function spawnWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}
