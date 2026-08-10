import { captionCues, frameDuration, timeToSeconds, toVtt } from "@videola/core";

import type { EffectParams, Project, Rate, SourceTimes, Time, Transforms } from "@videola/core";

import { AudioGraph, hasAudibleClips } from "../audio/graph";
import { blurAmounts, exposure } from "../render/motion-blur";
import { AudioSource } from "../decode/audio-source";
import type { AudioBufferSource } from "../audio/graph";
import type { ExportAudio, ExportFrame, ExportInstant, ExportRequest } from "./encode";
import { formatSupport } from "./format";
import type { EncodeProbe, ExportFormat } from "./format";

export interface ExportRange {
  from: Time;
  to: Time;
}

/**
 * What becomes of the project's captions in the file.
 *
 * `burned` draws them into the picture, which every player shows and none can switch off. It is the
 * default because it is the one that needs nothing of the player, and because it is what every
 * export did before there was a choice.
 *
 * `separate` writes them as a subtitle track the viewer turns on and off, and leaves the picture
 * without them; whether the chosen container can carry one is `carriesSubtitles`, asked of the
 * writer rather than assumed. `none` writes neither.
 */
export type CaptionMode = "burned" | "separate" | "none";

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  fps: Rate;
  videoBitrate: number;
  audioBitrate: number;
  range: ExportRange;
  /** Defaults to `burned`, which is what every export did before there was a choice. */
  captions?: CaptionMode;
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
  transforms: Transforms;
  options: ExportOptions;
  onProgress?: (done: number, total: number) => void;
  createWorker?: () => Worker;
  audioSource?: AudioBufferSource;
  /** Injectable so a test, or a harness, can ask something other than the live browser. */
  encodeProbe?: EncodeProbe;
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
  // Asked once for the whole run: a project either carries a shutter somewhere or it does not, and
  // walking every clip per frame to find out would be the one part of this that scales with length.
  const smeared = blurAmounts(input.project);
  const widest = Math.max(0, ...smeared.values());
  const frameFlicks = frameDuration(input.options.fps);
  return frameTimes(input.options.range, input.options.fps).map((at) => {
    const instant = (moment: Time): ExportInstant => ({
      at: moment,
      sources: input.sourceTimes(moment),
      params: input.effectParams(moment),
      transforms: input.transforms(moment),
    });
    const base = instant(at);
    if (widest <= 0) return base;
    // The widest shutter in the project decides the instants, and a clip with a narrower one uses the
    // subset inside its own window -- resolved in the worker, where the smear is assembled. Asking
    // the core once per instant rather than once per instant per clip is what keeps an export of a
    // hundred smeared clips the same number of crossings as an export of one.
    return { ...base, exposure: exposure(at, widest, frameFlicks).map(instant) };
  });
}

async function canEncodeAudio(input: ExportInput, channels: number): Promise<boolean> {
  const support = await formatSupport(
    {
      width: input.options.width,
      height: input.options.height,
      sampleRate: input.project.settings.sampleRate,
      channels,
    },
    input.encodeProbe ?? undefined,
  );
  return support.find((entry) => entry.format.id === input.options.format.id)?.audio === true;
}

/**
 * How many channels this run can actually write: what the project asks for, or stereo, or nothing.
 *
 * A 5.1 mix the machine cannot encode is delivered in stereo rather than in silence, and the placement
 * is not thrown away doing it -- the graph still puts every track where the mix says, and the
 * two-channel render folds six down by the standard rules. What is lost is the delivery format, not
 * the mix, and the file that comes out is one somebody can use.
 */
async function encodableChannels(input: ExportInput): Promise<number | undefined> {
  const wanted = input.project.settings.audioChannels ?? 2;
  if (await canEncodeAudio(input, wanted)) return wanted;
  if (wanted !== 2 && (await canEncodeAudio(input, 2))) return 2;
  return undefined;
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
  const mode = input.options.captions ?? "burned";
  // Read before the tracks are hidden, because hiding one is exactly what takes its cues out of
  // `captionCues` -- the same rule that keeps a track nobody was shown out of a sidecar file.
  const cues = mode === "separate" ? captionCues(input.project) : [];
  const request: ExportRequest = {
    project: mode === "burned" ? input.project : withoutCaptions(input.project),
    format: input.options.format,
    width: input.options.width,
    height: input.options.height,
    fps: input.options.fps,
    videoBitrate: input.options.videoBitrate,
    audioBitrate: input.options.audioBitrate,
    // Unchanged by the mode: it resolves times and parameters per instant and never asks which
    // clips are on screen. A snapshot carrying a caption the draw list then skips costs nothing.
    frames: exportFrames(input),
    audio: await renderAudio(input),
    subtitles: cues.length > 0 ? toVtt(cues) : undefined,
  };
  return exchange(worker, request, input.onProgress);
}

// Captions out of the picture, by the one switch the renderer already reads. Nothing in the draw
// list needed a second way to say "not this track": `paints` has skipped a hidden track since it
// was written, and an export that reached into the renderer instead would be a second answer to
// which clips are on screen.
//
// A clone rather than a spread: `Project` carries the open index signature that lets a file from a
// later version keep its unknown fields, so no object literal satisfies the type, and a shallow
// copy would hand the worker track objects the editor is still holding.
function withoutCaptions(project: Project): Project {
  const copy = structuredClone(project);
  for (const track of copy.timeline.tracks) {
    if (track.kind === "caption") track.hidden = true;
  }
  return copy;
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
  // A browser can carry a format's picture and not its sound -- Chrome on Linux encodes H.264 and
  // refuses AAC. The interface already says what happens then ("the export will be silent"), and
  // this is where that becomes true instead of an exception halfway through the encode.
  const channels = await encodableChannels(input);
  if (channels === undefined) return undefined;
  const sampleRate = project.settings.sampleRate;
  const length = Math.max(
    1,
    Math.round(timeToSeconds(options.range.to - options.range.from) * sampleRate),
  );
  const context = new OfflineAudioContext(channels, length, sampleRate);
  // The same resolver the frames are drawn from. An export that resolved its own keyframes would be
  // exactly the divergence between what was heard and what was written that this graph exists to
  // rule out.
  const graph = new AudioGraph(
    context,
    input.audioSource ?? new AudioSource(),
    input.effectParams,
  );
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
