import { frameDuration, timeToSeconds } from "@videola/core";
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
} from "mediabunny";

import type {
  EffectParamSnapshot,
  Project,
  Rate,
  Time,
  TransformSnapshot,
} from "@videola/core";
import type { AudioEncodingConfig, OutputFormat, VideoEncodingConfig } from "mediabunny";

import { VideoSource } from "../decode/video-source";
import { GeneratorFrames } from "../generate/generator";
import { clipHashes } from "../playback";
import { Compositor } from "../render/compositor";
import { createContext } from "../render/context";
import { drawList } from "../render/draw-list";
import type { FrameSource } from "../playback";
import type { ExportFormat } from "./format";

// One output frame: where it sits on the project's ruler, and where every visible clip reads from
// for it. Both come from the core -- nothing in this file derives a project time, least of all
// from a decoder. A packet's microsecond stamp is truncated, and a file whose frames were placed
// from those stamps drifts by a frame every thirty-three seconds at 30000/1001.
export interface ExportFrame {
  at: Time;
  sources: ReadonlyMap<string, Time>;
  params: EffectParamSnapshot;
  transforms: TransformSnapshot;
}

export interface ExportAudio {
  sampleRate: number;
  channels: readonly Float32Array[];
}

export interface ExportRequest {
  project: Project;
  format: ExportFormat;
  width: number;
  height: number;
  fps: Rate;
  videoBitrate: number;
  audioBitrate: number;
  frames: readonly ExportFrame[];
  audio?: ExportAudio;
}

export interface ExportHooks {
  onProgress?: (done: number, total: number) => void;
  createFrameSource?: () => FrameSource;
}

// Long enough that the per-sample overhead disappears, short enough that a chunk of an hour-long
// export is megabytes rather than gigabytes.
const AUDIO_CHUNK_SECONDS = 1;

// Renders the range offline and writes it as a file. There is no clock here on purpose: an export
// runs as fast as the decoder and the encoder allow, and `Clock` measures `AudioContext.currentTime`,
// which is wall time. Tying the two would make a ten-second export take ten seconds and a frame the
// decoder was late with vanish from the file.
export async function runExport(
  request: ExportRequest,
  hooks: ExportHooks = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (request.frames.length === 0) throw new Error("error.exportEmptyRange");
  const target = new BufferTarget();
  const output = new Output({ format: container(request.format), target });
  const canvas = new OffscreenCanvas(request.width, request.height);
  const context = createContext(canvas);
  const compositor = new Compositor(context);
  const sources = new SourcePool(hooks.createFrameSource ?? ((): FrameSource => new VideoSource()));
  const generated = new GeneratorFrames();
  const video = new CanvasSource(canvas, videoEncoding(request));
  output.addVideoTrack(video, { frameRate: request.fps.numerator / request.fps.denominator });
  const audio = request.audio && new AudioSampleSource(audioEncoding(request));
  if (audio !== undefined) output.addAudioTrack(audio);

  try {
    await output.start();
    await writeVideo(request, {
      compositor,
      video,
      sources,
      generated,
      onProgress: hooks.onProgress,
    });
    if (audio !== undefined && request.audio !== undefined) {
      await writeAudio(audio, request.audio);
    }
    await output.finalize();
  } catch (error) {
    // Everything the encoders hold has to go back even when the run failed, and `finalize` is the
    // only other thing that releases them.
    await output.cancel().catch((reason: unknown) => void console.error(reason));
    throw error;
  } finally {
    sources.close();
    generated.close();
    compositor.dispose();
    context.dispose();
  }
  const buffer = target.buffer;
  if (buffer === null) throw new Error("error.exportFailed");
  return new Uint8Array(buffer);
}

// What it takes to answer "what pictures are on screen at this instant": the decoders and the
// painter. A still needs exactly this and nothing else the encoder carries.
export interface PictureSources {
  sources: SourcePool;
  generated: GeneratorFrames;
}

interface VideoPass extends PictureSources {
  compositor: Compositor;
  video: CanvasSource;
  onProgress?: (done: number, total: number) => void;
}

async function writeVideo(request: ExportRequest, pass: VideoPass): Promise<void> {
  const hashes = clipHashes(request.project);
  const step = timeToSeconds(frameDuration(request.fps));
  const origin = request.frames[0]!.at;
  let index = 0;
  for (const frame of request.frames) {
    const pictures = await gatherPictures(pass, hashes, request.project, frame);
    // Nothing is awaited between the last frame arriving and the upload, and `CanvasSource.add`
    // captures the canvas before it returns -- so the pictures are alive for the render and the
    // render is on the canvas before anything else can touch it.
    pass.compositor.render(
      request.project,
      frame.at,
      pictures,
      frame.params,
      frame.transforms,
    );
    await pass.video.add(timeToSeconds(frame.at - origin), step);
    index += 1;
    pass.onProgress?.(index, request.frames.length);
  }
}

// Both halves of the picture, through the same draw list the preview uses: decoded media and painted
// generators. Two lists would be two answers to "what is on screen", and a title that appears in the
// preview and not in the file is the kind of divergence nobody finds until the file is delivered.
export async function gatherPictures(
  pass: PictureSources,
  hashes: ReadonlyMap<string, string>,
  project: Project,
  frame: ExportFrame,
): Promise<Map<string, VideoFrame>> {
  const items = drawList(project, frame.at, frame.params, frame.transforms).items;
  const pictures = pass.generated.pictures(project, new Set(items.map((item) => item.clip)));
  for (const item of items) {
    const hash = hashes.get(item.clip);
    const at = frame.sources.get(item.clip);
    if (hash === undefined || at === undefined) continue;
    const source = await pass.sources.get(item.clip, hash);
    const picture = await source?.frameAt(at);
    if (picture !== undefined) pictures.set(item.clip, picture);
  }
  return pictures;
}

async function writeAudio(track: AudioSampleSource, audio: ExportAudio): Promise<void> {
  const numberOfChannels = audio.channels.length;
  for (const chunk of audioChunks(audio, Math.round(audio.sampleRate * AUDIO_CHUNK_SECONDS))) {
    const sample = new AudioSample({
      data: chunk.data,
      format: "f32-planar",
      numberOfChannels,
      sampleRate: audio.sampleRate,
      timestamp: chunk.timestamp,
    });
    // Awaiting the add is the backpressure: mediabunny holds it back while the encoder queue is
    // full, which is what keeps a long export from filling memory with samples nobody encoded yet.
    await track.add(sample);
    sample.close();
  }
}

export interface AudioChunk {
  timestamp: number;
  data: Float32Array<ArrayBuffer>;
  numberOfFrames: number;
}

// Planar layout, one plane after the other in a single buffer, which is what `f32-planar` means.
// Lazy on purpose: an hour of stereo is 1.4 GB of samples, and materialising the chunks would hold
// a second copy of all of it.
export function* audioChunks(audio: ExportAudio, chunkFrames: number): Generator<AudioChunk> {
  const total = audio.channels[0]?.length ?? 0;
  const channels = audio.channels.length;
  for (let offset = 0; offset < total; offset += chunkFrames) {
    const numberOfFrames = Math.min(chunkFrames, total - offset);
    const data = new Float32Array(numberOfFrames * channels);
    audio.channels.forEach((plane, index) =>
      data.set(plane.subarray(offset, offset + numberOfFrames), index * numberOfFrames),
    );
    yield { timestamp: offset / audio.sampleRate, data, numberOfFrames };
  }
}

// One decoder per clip rather than per medium, which is where this parts company with playback.
// Two clips of the same file share a frame cache otherwise, and decoding for the second one evicts
// the first one's picture while the gather is still running. In a preview that costs one stale
// frame; in a file it is written down for good.
//
// ponytail: and each one stays open until the run ends, so a timeline of five hundred clips holds
// five hundred decoders and their frame budgets at once. Closing a source once its clip is behind
// the export's position is the way out; it needs the run to know that a clip is finished rather
// than merely absent from this one frame, or an interleaved cut reopens decoders all day.
export class SourcePool {
  #create: () => FrameSource;
  #open = new Map<string, FrameSource | undefined>();

  constructor(create: () => FrameSource) {
    this.#create = create;
  }

  async get(clip: string, hash: string): Promise<FrameSource | undefined> {
    if (this.#open.has(clip)) return this.#open.get(clip);
    const source = this.#create();
    try {
      await source.open(hash);
      this.#open.set(clip, source);
    } catch (error) {
      // One missing medium costs its own clip its picture and the rest of the export nothing.
      console.error(error);
      source.close();
      this.#open.set(clip, undefined);
    }
    return this.#open.get(clip);
  }

  close(): void {
    for (const source of this.#open.values()) source?.close();
    this.#open.clear();
  }
}

function container(format: ExportFormat): OutputFormat {
  return format.id === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
}

function videoEncoding(request: ExportRequest): VideoEncodingConfig {
  return {
    codec: request.format.video,
    quality: new Quality({ bitrate: request.videoBitrate }),
    // The compositor's canvas has an alpha channel because clips lie over each other in it. The
    // file does not want one: MP4 has nowhere to put it, and a player that finds one in WebM
    // shows the page through the picture.
    alpha: "discard",
  };
}

function audioEncoding(request: ExportRequest): AudioEncodingConfig {
  return {
    codec: request.format.audio,
    quality: new Quality({ bitrate: request.audioBitrate }),
  };
}
