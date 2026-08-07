import { timeToSeconds } from "@videola/core";
import { mediaHash } from "@videola/media";

import type { Clip, MediaAsset, Project, Time, Track } from "@videola/core";

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
    this.#master.gain.value = project.master.volume;
    this.#tracks = project.timeline.tracks;
    const library = new Map(project.library.map((asset) => [asset.id, asset]));
    const voices: Voice[] = [];
    for (const track of this.#tracks) {
      for (const clip of track.clips) {
        const hash = audibleHash(clip, library);
        if (hash === undefined) continue;
        const buffer = await this.#source.bufferFor(hash, clip.inPoint, outPoint(clip));
        voices.push({ clip, track, buffer });
      }
    }
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

  setMasterVolume(volume: number): void {
    this.#master.gain.setTargetAtTime(volume, this.#ctx.currentTime, MASTER_GLIDE_SECONDS);
  }

  // Mute and solo land here rather than on the clip gains, so a track that is silenced mid-fade
  // stays silenced and the fade automation underneath it is left untouched.
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
    automateFades(gain.gain, clip, contextTime + timeToSeconds(clip.start - projectTime));
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

// The whole point of Task 8: the envelope is scheduled once, in advance, and the audio thread
// interpolates it per sample. A gain written per animation frame is a staircase, and a staircase
// in an amplitude is a click.
function automateFades(gain: AudioParam, clip: Clip, clipStart: number): void {
  const target = clip.volume;
  const fadeIn = timeToSeconds(clip.fades.inDuration);
  const fadeOut = timeToSeconds(clip.fades.outDuration);
  const clipEnd = clipStart + timeToSeconds(clip.duration);
  gain.setValueAtTime(fadeIn > 0 ? 0 : target, notBeforeStart(clipStart));
  if (fadeIn > 0) gain.linearRampToValueAtTime(target, notBeforeStart(clipStart + fadeIn));
  if (fadeOut <= 0) return;
  // Overlapping fades would otherwise put a hold in the middle of the rising ramp, which reads as
  // a step rather than as the crossed pair the two durations describe.
  const outStart = Math.max(clipStart + fadeIn, clipEnd - fadeOut);
  gain.setValueAtTime(target, notBeforeStart(outStart));
  gain.linearRampToValueAtTime(0, notBeforeStart(clipEnd));
}

// Automation times are absolute and cannot be negative. Playing from the middle of a clip puts
// its nominal start behind the context's zero only in an offline render, where the context is
// born at the moment playback begins; a live AudioContext has been running for seconds by then
// and the clamp never fires. The events kept in place still describe the right ramp, because the
// spec computes a value from the surrounding events whether or not they are in the past.
function notBeforeStart(when: number): number {
  return Math.max(0, when);
}

// ponytail: a reversed clip stays silent -- an AudioBufferSourceNode has no negative playback
// rate, so there is nothing to schedule. The way out is reversing the sample data once in
// `prepare` and inverting the offset, which costs one buffer copy per reversed clip.
function audibleHash(clip: Clip, library: ReadonlyMap<string, MediaAsset>): string | undefined {
  if (clip.source.kind !== "media" || clip.speed.reverse) return undefined;
  const asset = library.get(clip.source.media);
  // The track's kind says nothing about sound: a video track carries clips whose medium has an
  // audio stream, and an audio track can hold a video file someone dropped on it. The library
  // entry is the only thing that knows.
  if (asset === undefined || asset.channels === null || asset.channels === undefined) {
    return undefined;
  }
  return mediaHash(asset.id);
}

function outPoint(clip: Clip): Time {
  return clip.inPoint + Math.round(clip.duration * clip.speed.rate);
}
