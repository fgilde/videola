import { timeToSeconds } from "@videola/core";
import { mediaHash, peaks } from "@videola/media";

import type { Clip, MediaAsset, Project, Time, Track } from "@videola/core";
import type { Peaks } from "@videola/media";

import { integratedLufs } from "./loudness";

export interface AudioBufferSource {
  bufferFor(hash: string, from: Time, to: Time): Promise<AudioBuffer>;
}

interface Voice {
  clip: Clip;
  track: Track;
  buffer: AudioBuffer;
}

// Long enough that a volume slider cannot click, short enough that it still feels immediate.
const MASTER_GLIDE_SECONDS = 0.01;

export class AudioGraph {
  #ctx: BaseAudioContext;
  #source: AudioBufferSource;
  #master: GainNode;
  #tracks: readonly Track[] = [];
  #voices: Voice[] = [];
  #live: AudioNode[] = [];
  #playing: AudioBufferSourceNode[] = [];
  #buffers = new Map<string, AudioBuffer>();
  #generation = 0;

  constructor(ctx: BaseAudioContext, source: AudioBufferSource) {
    this.#ctx = ctx;
    this.#source = source;
    this.#master = ctx.createGain();
    this.#master.connect(ctx.destination);
  }

  // ponytail: every clip's audio is decoded up front and held for the length of the session. An
  // hour of stereo at 48 kHz is about 1.4 GB of float samples, so this holds for a short timeline
  // and not for a feature. The way out is a scheduling window -- decode the next few seconds on a
  // timer and release what has played -- which needs the clock from Task 9 to drive it.
  async prepare(project: Project): Promise<void> {
    this.stop();
    this.#generation += 1;
    const generation = this.#generation;
    const library = new Map(project.library.map((asset) => [asset.id, asset]));
    const voices: Voice[] = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        const hash = audibleHash(clip, library);
        if (hash === undefined) continue;
        const buffer = await this.#load(hash, clip);
        if (buffer !== undefined) voices.push({ clip, track, buffer });
      }
    }
    // Two edits in quick succession leave two prepares in flight, and decoding times decide
    // nothing about which project state is current. Whoever started last owns the graph.
    if (generation !== this.#generation) return;
    this.#master.gain.value = project.master.volume;
    this.#tracks = project.timeline.tracks;
    this.#voices = voices;
  }

  startAt(contextTime: number, projectTime: Time): void {
    this.stop();
    const soloing = this.#tracks.some((track) => track.solo);
    const buses = new Map<string, AudioNode>();
    for (const voice of this.#voices) {
      const bus = buses.get(voice.track.id) ?? this.#bus(voice.track, soloing);
      buses.set(voice.track.id, bus);
      this.#schedule(voice, bus, contextTime, projectTime);
    }
  }

  stop(): void {
    for (const node of this.#playing) node.stop();
    for (const node of this.#live) node.disconnect();
    this.#playing = [];
    this.#live = [];
  }

  // The strips the timeline draws come from the samples the graph decoded for playback, so what is
  // seen and what is heard cannot drift apart -- a reversed clip included, whose held buffer is
  // already the reversed copy. A clip the graph does not schedule gets no entry, which is what lets
  // the timeline tell "no sound" from "not read yet".
  waveforms(buckets: number): Map<string, Peaks> {
    return new Map(
      this.#voices.map((voice) => {
        const planes = Array.from({ length: voice.buffer.numberOfChannels }, (_, channel) =>
          voice.buffer.getChannelData(channel),
        );
        return [voice.clip.id, peaks(planes, buckets)];
      }),
    );
  }

  setMasterVolume(volume: number): void {
    this.#master.gain.setTargetAtTime(volume, this.#ctx.currentTime, MASTER_GLIDE_SECONDS);
  }

  // One medium missing must not take the rest of the timeline with it. The library is where a
  // gap gets reported to the user; here it costs one clip its sound and nothing else.
  //
  // Keyed by what the decode actually depends on, not by clip id: `prepare` runs again after
  // every edit, and without this a clip dragged across the timeline is decoded from OPFS once
  // per pointer movement. Splitting a clip reuses neither half, which is right -- their ranges
  // differ. The map is the same session-long hold the note above already describes.
  async #load(hash: string, clip: Clip): Promise<AudioBuffer | undefined> {
    const reverse = clip.speed.reverse;
    const key = `${hash}|${clip.inPoint}|${outPoint(clip)}|${reverse}`;
    const cached = this.#buffers.get(key);
    if (cached !== undefined) return cached;
    try {
      const decoded = await this.#source.bufferFor(hash, clip.inPoint, outPoint(clip));
      const buffer = reverse ? this.#reversed(decoded) : decoded;
      this.#buffers.set(key, buffer);
      return buffer;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  // An AudioBufferSourceNode has no negative playback rate, so a reversed clip plays a reversed
  // copy of its own range. The offset arithmetic in `#schedule` needs no branch for it: a timeline
  // position `p` into the clip consumes `p * rate` seconds of source counted back from the out
  // point, and that is the same `p * rate` counted forward from the start of the reversed copy.
  #reversed(buffer: AudioBuffer): AudioBuffer {
    const out = this.#ctx.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );
    const plane = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      buffer.copyFromChannel(plane, channel);
      plane.reverse();
      out.copyToChannel(plane, channel);
    }
    return out;
  }

  // Mute and solo land here rather than on the clip gains, so a track that is silenced mid-fade
  // stays silenced and the fade automation underneath it is left untouched. Mute beats solo: a
  // track that is both stays silent, and soloing it silences everything else all the same.
  #bus(track: Track, soloing: boolean): AudioNode {
    const gain = this.#ctx.createGain();
    gain.gain.value = soloing && !track.solo ? 0 : track.muted ? 0 : track.volume;
    const panner = this.#ctx.createStereoPanner();
    panner.pan.value = track.pan;
    gain.connect(panner).connect(this.#master);
    this.#live.push(gain, panner);
    return gain;
  }

  #schedule(voice: Voice, bus: AudioNode, contextTime: number, projectTime: Time): void {
    const { clip, buffer } = voice;
    const end = clip.start + clip.duration;
    if (end <= projectTime) return;
    const gain = this.#ctx.createGain();
    const clipStart = contextTime + timeToSeconds(clip.start - projectTime);
    automate(gain.gain, envelope(clip, clipStart), contextTime);
    const node = this.#ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = clip.speed.rate;
    node.connect(gain).connect(bus);
    // Offset and duration are measured in the buffer's own time, which runs at the playback rate
    // relative to the timeline -- a clip at half speed consumes half a second of source per
    // second of timeline.
    const skipped = Math.max(0, timeToSeconds(projectTime - clip.start));
    node.start(
      Math.max(contextTime, contextTime + timeToSeconds(clip.start - projectTime)),
      skipped * clip.speed.rate,
      timeToSeconds(end - Math.max(clip.start, projectTime)) * clip.speed.rate,
    );
    this.#live.push(node, gain);
    this.#playing.push(node);
  }
}

// Programme loudness of a whole project, to R128, from a real render of the real graph -- clip gains,
// fades, track buses, mute and solo and the master all included, because they are all things that
// change the number. Measuring the decoded buffers instead would report the loudness of the material
// rather than of the programme.
//
// The context is the caller's: the browser has `OfflineAudioContext` and so does the test runner, and
// a factory parameter for one line of construction would be an interface with one implementation.
// Its length is what decides how much of the timeline is measured.
export async function measureLoudness(
  ctx: OfflineAudioContext,
  project: Project,
  source: AudioBufferSource,
): Promise<number> {
  const graph = new AudioGraph(ctx as unknown as BaseAudioContext, source);
  await graph.prepare(project);
  graph.startAt(ctx.currentTime, 0);
  const rendered = await ctx.startRendering();
  const planes = Array.from({ length: rendered.numberOfChannels }, (_, channel) =>
    rendered.getChannelData(channel),
  );
  return integratedLufs(planes, rendered.sampleRate);
}

interface Point {
  at: number;
  value: number;
}

// The whole point of Task 8: the envelope is scheduled once, in advance, and the audio thread
// interpolates it per sample. A gain written per animation frame is a staircase, and a staircase
// in an amplitude is a click.
//
// Everything before `from` is folded into a single starting value, because automation times are
// absolute and must not be negative -- and a clip whose fade began before playback did is the
// ordinary case, not an edge one. Pushing those events to zero instead would flatten the ramp
// onto a different slope; interpolating once and scheduling only the future keeps the shape.
function automate(gain: AudioParam, points: readonly Point[], from: number): void {
  gain.setValueAtTime(valueAt(points, from), from);
  for (const point of points) {
    if (point.at > from) gain.linearRampToValueAtTime(point.value, point.at);
  }
}

// A hold reads as a ramp between two equal values, so the whole envelope is one list of corners
// and `automate` never has to know which kind of segment it is walking through.
function envelope(clip: Clip, clipStart: number): Point[] {
  const target = clip.volume;
  const [fadeIn, fadeOut] = fadeDurations(clip);
  const clipEnd = clipStart + timeToSeconds(clip.duration);
  const points: Point[] = [{ at: clipStart, value: fadeIn > 0 ? 0 : target }];
  if (fadeIn > 0) points.push({ at: clipStart + fadeIn, value: target });
  if (fadeOut > 0) {
    points.push({ at: clipEnd - fadeOut, value: target });
    points.push({ at: clipEnd, value: 0 });
  }
  return points;
}

// Trimming and splitting leave the fades alone, so a clip shorter than its own fades is reachable
// without anyone touching a fade handle. Scaling both down by the same factor keeps their ratio
// and lets the envelope peak where the two would have crossed. Clamping only the longer one, or
// leaving them, puts the descent before the rise -- and the automation list is sorted by time,
// not by insertion, so that comes out as silence rather than as an error.
function fadeDurations(clip: Clip): [number, number] {
  const fadeIn = Math.max(0, timeToSeconds(clip.fades.inDuration));
  const fadeOut = Math.max(0, timeToSeconds(clip.fades.outDuration));
  const duration = timeToSeconds(clip.duration);
  const total = fadeIn + fadeOut;
  if (total <= duration) return [fadeIn, fadeOut];
  return [(fadeIn * duration) / total, (fadeOut * duration) / total];
}

function valueAt(points: readonly Point[], when: number): number {
  const first = points[0]!;
  if (when <= first.at) return first.value;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    if (when >= point.at) continue;
    const span = point.at - previous.at;
    if (span <= 0) return point.value;
    return previous.value + ((point.value - previous.value) * (when - previous.at)) / span;
  }
  return points[points.length - 1]!.value;
}

function audibleHash(clip: Clip, library: ReadonlyMap<string, MediaAsset>): string | undefined {
  if (clip.source.kind !== "media") return undefined;
  const asset = library.get(clip.source.media);
  // The track's kind says nothing about sound: a video track carries clips whose medium has an
  // audio stream, and an audio track can hold a video file someone dropped on it. The library
  // entry is the only thing that knows.
  if (asset === undefined || asset.channels === null || asset.channels === undefined) {
    return undefined;
  }
  return mediaHash(asset.id);
}

// Whether a project has anything to put in an audio track at all. Shares `audibleHash` with the
// graph on purpose: an export that decides for itself would write a silent track for material the
// graph refuses to schedule, or leave one out that it would have.
export function hasAudibleClips(project: Project): boolean {
  const library = new Map(project.library.map((asset) => [asset.id, asset]));
  return project.timeline.tracks.some((track) =>
    track.clips.some((clip) => audibleHash(clip, library) !== undefined),
  );
}

function outPoint(clip: Clip): Time {
  return clip.inPoint + Math.round(clip.duration * clip.speed.rate);
}
