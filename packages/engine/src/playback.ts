import { frameDuration } from "@videola/core";
import { mediaHash } from "@videola/media";

import type { Peaks } from "@videola/media";
import type {
  EffectParams,
  EffectParamSnapshot,
  Project,
  SourceTimes,
  Time,
  Transforms,
  TransformSnapshot,
} from "@videola/core";

import { Clock } from "./clock";
import { leafClips } from "./nesting";
import type { ClockSource } from "./clock";
import { VideoSource } from "./decode/video-source";
import { GeneratorFrames } from "./generate/generator";
import { Compositor } from "./render/compositor";
import { createContext } from "./render/context";
import { drawList } from "./render/draw-list";
import type { GlContext } from "./render/context";
import type { AudioGraph } from "./audio/graph";

// Playback steers the audio context as well as reading it. A freshly built one is suspended, its
// currentTime stands still, and a clock started on it would report a frozen position while
// isPlaying said otherwise -- so waking it up is part of pressing play.
export interface AudioTransport extends ClockSource {
  readonly state: AudioContextState;
  resume(): Promise<void>;
}

// What playback needs of a decoded medium, which is what `VideoSource` provides. Naming only
// these three is what lets a test drive a whole tick in a runtime with no WebCodecs in it.
export interface FrameSource {
  open(hash: string): Promise<void>;
  frameAt(t: Time): Promise<VideoFrame | undefined>;
  close(): void;
}

// Enough detail that a clip filling the screen does not look stepped, cheap enough that fifty of
// them cost nothing. Raise it if a strip ever looks blocky at full zoom.
export const WAVEFORM_BUCKETS = 600;

export interface PlaybackOptions {
  audio: AudioTransport;
  graph: AudioGraph;
  sourceTimes: SourceTimes;
  effectParams: EffectParams;
  transforms: Transforms;
  createFrameSource?: () => FrameSource;
}

// Orchestrates and does not work: it asks the core where every visible clip is reading from, the
// sources for the frames at those points, and the compositor to draw them. It computes no time of
// its own -- project time comes from the clock, source time from the core.
export class Playback {
  #audio: AudioTransport;
  #graph: AudioGraph;
  #sourceTimes: SourceTimes;
  #effectParams: EffectParams;
  #transforms: Transforms;
  #createFrameSource: () => FrameSource;
  #clock: Clock;
  #context?: GlContext;
  #compositor?: Compositor;
  #project?: Project;
  #hashes: ReadonlyMap<string, string> = new Map();
  #sources = new Map<string, Promise<FrameSource | undefined>>();
  #generated = new GeneratorFrames();
  #rolling = false;
  #painting = false;
  #due?: Time;

  constructor(options: PlaybackOptions) {
    this.#audio = options.audio;
    this.#graph = options.graph;
    this.#sourceTimes = options.sourceTimes;
    this.#effectParams = options.effectParams;
    this.#transforms = options.transforms;
    this.#createFrameSource = options.createFrameSource ?? ((): FrameSource => new VideoSource());
    this.#clock = new Clock(options.audio);
    // Subscribed before anyone else, so a consumer's listener sees the time the picture is
    // already on its way to. Never unsubscribed: the clock is this object's own, so the listener
    // dies with it -- and a tick that lands after dispose finds no compositor and paints nothing.
    this.#clock.onTick((at) => this.#show(at));
  }

  get isPlaying(): boolean {
    return this.#clock.isPlaying;
  }

  now(): Time {
    return this.#clock.now();
  }

  attach(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    this.#detach();
    // Readable: the preview is the one surface anything asks for a pixel back from.
    this.#context = createContext(canvas, { readable: true });
    this.#compositor = new Compositor(this.#context);
  }

  async load(project: Project): Promise<void> {
    this.#project = project;
    this.#hashes = clipHashes(project);
    const wanted = new Set(this.#hashes.values());
    for (const hash of [...this.#sources.keys()]) {
      if (!wanted.has(hash)) this.#release(hash);
    }
    await this.#graph.prepare(project);
  }

  play(): void {
    if (this.#rolling) return;
    this.#rolling = true;
    if (this.#audio.state === "running") {
      this.#begin();
      return;
    }
    void this.#audio.resume().then(
      () => void (this.#rolling && this.#begin()),
      (error: unknown) => {
        this.#rolling = false;
        console.error(error);
      },
    );
  }

  pause(): void {
    this.#rolling = false;
    this.#graph.stop();
    this.#clock.pause();
  }

  seek(t: Time): void {
    this.#clock.seek(t);
    // Rescheduling the whole graph is what a jump costs: an AudioBufferSourceNode cannot be moved
    // once it is playing, so the voices are built again from the position the clock now reports.
    if (this.#clock.isPlaying) this.#graph.startAt(this.#audio.currentTime, this.#clock.now());
  }

  // Rolling and stepping are two different intents, and a step that leaves the clock running
  // would be overwritten by the next tick before anyone saw it.
  stepFrame(direction: 1 | -1): void {
    const fps = this.#project?.settings.fps;
    if (fps === undefined) return;
    this.pause();
    this.seek(this.#clock.now() + direction * frameDuration(fps));
  }

  // An edit changes the picture without moving the playhead, and resizing the canvas empties the
  // drawing buffer without moving it either. Neither is a seek: routing them through seek would
  // rebuild the whole audio graph at the same position, once per keystroke and once per pixel of
  // window resize.
  refresh(): void {
    this.#show(this.#clock.now());
  }

  // The counterpart to the remembered absence in `#open`: a medium whose bytes came back has an
  // "it is not there" in the way that no tick would ever retry. Dropping the entry is what lets
  // the next paint open it for real.
  forget(hash: string): void {
    this.#release(hash);
  }

  // Read after `load` resolves, because that is when the graph holds the decoded samples. Fixed
  // resolution rather than one derived from the clip's width in pixels: the strip is stretched to
  // the clip by its viewBox, so no zoom step can invalidate it.
  waveforms(buckets = WAVEFORM_BUCKETS): Map<string, Peaks> {
    return this.#graph.waveforms(buckets);
  }

  onTime(cb: (t: Time) => void): () => void {
    return this.#clock.onTick(cb);
  }

  /**
   * The picture as it stands, shrunk to `width` by `height` -- what a measuring instrument reads.
   *
   * Empty before a canvas is attached and after it has been let go, which is what a panel asking
   * on a timer will hit sooner or later: measuring a preview that is no longer there has to be an
   * empty reading, not a throw at whatever rate the timer runs.
   */
  sample(width: number, height: number): Uint8Array {
    return this.#compositor?.sample(width, height) ?? new Uint8Array(0);
  }

  dispose(): void {
    this.pause();
    for (const hash of [...this.#sources.keys()]) this.#release(hash);
    this.#generated.close();
    this.#detach();
    this.#project = undefined;
  }

  #begin(): void {
    this.#graph.startAt(this.#audio.currentTime, this.#clock.now());
    this.#clock.play();
  }

  #detach(): void {
    this.#compositor?.dispose();
    this.#context?.dispose();
    this.#compositor = undefined;
    this.#context = undefined;
  }

  #release(hash: string): void {
    const opening = this.#sources.get(hash);
    this.#sources.delete(hash);
    void opening?.then((source) => source?.close());
  }

  // Ticks arrive faster than a decode finishes. The positions a decode overtook are dropped
  // rather than queued: a picture nobody is waiting for any more costs the one they are.
  #show(at: Time): void {
    this.#due = at;
    if (this.#painting) return;
    void this.#paint();
  }

  async #paint(): Promise<void> {
    this.#painting = true;
    try {
      while (this.#due !== undefined) {
        const at = this.#due;
        this.#due = undefined;
        await this.#present(at);
      }
    } finally {
      this.#painting = false;
    }
  }

  // The frames are gathered and handed over with nothing awaited in between. The cache is free to
  // close any of them the next time it decodes, and only this source can make it decode, so the
  // map cannot rot between the last frame arriving and the upload.
  async #present(at: Time): Promise<void> {
    const project = this.#project;
    const compositor = this.#compositor;
    if (project === undefined || compositor === undefined) return;
    // Asked for once and used twice, before anything is awaited: the list of clips to fetch and
    // the picture that gets drawn then describe the same moment, even if the project changes
    // while a decode is in flight.
    const params = this.#effectParams(at);
    const transforms = this.#transforms(at);
    const frames = await this.#frames(project, at, params, transforms);
    compositor.render(project, at, frames, params, transforms);
  }

  // ponytail: two clips of the same medium share one source, and decoding for the second can
  // evict the first one's frame while this gather is still running. The compositor holds the
  // previous picture for that clip rather than blanking it, so the cost is one stale frame. A
  // real fix is a pin on the cache entry for the length of the gather.
  async #frames(
    project: Project,
    at: Time,
    params: EffectParamSnapshot,
    transforms: TransformSnapshot,
  ): Promise<Map<string, VideoFrame>> {
    const items = drawList(project, at, params, transforms).items;
    const sourceTimes = this.#sourceTimes(at);
    const found = await Promise.all(
      items.map((item) => this.#frameFor(item.clip, sourceTimes)),
    );
    const frames = new Map(found.filter((entry) => entry !== undefined));
    // Painted rather than decoded, and painted last: nothing is awaited after this, so a generator's
    // picture cannot go stale between here and the upload the way a decoded one can.
    for (const [clip, picture] of this.#generated.pictures(
      project,
      new Set(items.map((item) => item.clip)),
    )) {
      frames.set(clip, picture);
    }
    return frames;
  }

  async #frameFor(
    clip: string,
    sourceTimes: ReadonlyMap<string, Time>,
  ): Promise<[string, VideoFrame] | undefined> {
    const hash = this.#hashes.get(clip);
    const at = sourceTimes.get(clip);
    if (hash === undefined || at === undefined) return undefined;
    const source = await this.#source(hash);
    const frame = await source?.frameAt(at);
    return frame === undefined ? undefined : [clip, frame];
  }

  // Opened on first sight rather than on load: a timeline of fifty clips would otherwise hold
  // fifty decoders open for the sake of a playhead standing on one of them.
  #source(hash: string): Promise<FrameSource | undefined> {
    const existing = this.#sources.get(hash);
    if (existing !== undefined) return existing;
    const opening = this.#open(hash);
    this.#sources.set(hash, opening);
    return opening;
  }

  // A medium that failed to open is remembered as absent until `forget` or a `load` drops it.
  // Retrying per tick would hammer OPFS sixty times a second for a file that is not coming back.
  async #open(hash: string): Promise<FrameSource | undefined> {
    const source = this.#createFrameSource();
    try {
      await source.open(hash);
      return source;
    } catch (error) {
      // One missing medium costs its own clips their picture and the rest of the timeline
      // nothing. The library is where the gap gets reported to the user.
      console.error(error);
      source.close();
      return undefined;
    }
  }
}

// Built once per load, because the alternative is walking the timeline for every frame. Which
// media have a picture is not decided here: the draw list drops a clip whose asset has no size,
// so a hash for an audio-only medium is never asked for. Nested clips are in, keyed by their own
// id -- the draw list names them that way and this is what it looks their frames up with.
export function clipHashes(project: Project): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const clip of leafClips(project)) {
    if (clip.source.kind !== "media") continue;
    const hash = mediaHash(clip.source.media);
    if (hash !== undefined) hashes.set(clip.id, hash);
  }
  return hashes;
}
