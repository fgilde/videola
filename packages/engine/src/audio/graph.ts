import {
  consumedBetween,
  consumedSource,
  speedRateAt,
  SPEED_TRACK,
  timeToSeconds,
} from "@videola/core";
import { mediaHash, peaks } from "@videola/media";

import type {
  Clip,
  Effect,
  EffectParams,
  Keyframe,
  MediaAsset,
  Project,
  Time,
  Track,
} from "@videola/core";
import type { Peaks } from "@videola/media";

import { audibleClips } from "../nesting";
import { isSurround } from "@videola/core";

import { clampParam } from "../effects/registry";
import { audioEffect, offlineAudioEffect } from "./effects";
import { CHANNEL, LFE_CUTOFF_HZ, stereoSpread } from "./surround";
import type { OfflineAudioEffect } from "./effects";
import type { EffectParam } from "./effects";
import { integratedLufs, levelFrom, SILENT_LEVEL } from "./loudness";
import type { Level } from "./loudness";

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

/** The key `levels` reports the master bus under; every other key is a track id. */
export const MASTER_METER = "master";

// 2048 frames is 43 ms at 48 kHz -- longer than a frame at sixty, so a meter read once per frame
// sees every sample that went past rather than a slice of each one. Smaller windows make the
// effective value jitter; larger ones smear a transient into the average around it.
const METER_WINDOW = 2048;

// How finely a keyframe segment is sampled between its two corners. Only a curve needs it -- a
// linear segment lands every extra sample back on the line it already had -- and eight is where a
// filter sweep stops being audibly a sequence of straight runs.
const CURVE_STEPS = 8;

export class AudioGraph {
  #ctx: BaseAudioContext;
  #source: AudioBufferSource;
  #master: GainNode;
  #params?: EffectParams;
  #tracks: readonly Track[] = [];
  #masterEffects: readonly Effect[] = [];
  #voices: Voice[] = [];
  #live: AudioNode[] = [];
  #playing: AudioBufferSourceNode[] = [];
  #buffers = new Map<string, AudioBuffer>();
  #generation = 0;
  #meters = new Map<string, AnalyserNode>();
  #levels = new Map<string, Level>();
  #window = new Float32Array(METER_WINDOW);
  // The compressors and limiters currently in the graph, by effect id. Rebuilt with the graph on every
  // seek, like every other node: a reading from a node nothing is routed through is a reading of the
  // past.
  #compressors = new Map<string, DynamicsCompressorNode>();
  // How many channels the mix is laid out over, from the project rather than from the context: an
  // offline render of a 5.1 project on a stereo device still has to *place* every track in six
  // channels, and what the machine can play is the browser's problem after that.
  #channels = 2;

  /**
   * `params` is the core's own resolver -- `Document.effectParamsAt` -- and the reason a keyframed
   * cutoff sweeps here without a second interpolation living next to the one in Rust. Preview,
   * export and the loudness reading are all handed the same one, which is what keeps them hearing
   * the same thing. Left out, effects still sound, at the static values they were authored with.
   */
  constructor(ctx: BaseAudioContext, source: AudioBufferSource, params?: EffectParams) {
    this.#ctx = ctx;
    this.#source = source;
    this.#params = params;
    this.#master = ctx.createGain();
    // In the line rather than hanging off it: a node with no route to the destination is not pulled,
    // so a meter tapped as a dead branch reads zero for exactly as long as nobody checks. An
    // AnalyserNode's output is its input unchanged, which the export's sample-for-sample agreement
    // with playback is the standing proof of -- both run this same graph.
    this.#master.connect(this.#meter(MASTER_METER)).connect(ctx.destination);
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
    // Nested clips arrive already folded into the outer timeline's coordinates, so nothing below
    // this line knows about compound clips.
    for (const { clip, track } of audibleClips(project)) {
      // The same flag the renderer reads: a clip switched off is not heard either, and one that was
      // silent in the picture and audible in the mix would be the worst of both answers.
      if (clip.enabled === false) continue;
      const hash = audibleHash(clip, library);
      if (hash === undefined) continue;
      const buffer = await this.#load(hash, clip);
      if (buffer !== undefined) voices.push({ clip, track, buffer });
    }
    // Two edits in quick succession leave two prepares in flight, and decoding times decide
    // nothing about which project state is current. Whoever started last owns the graph.
    if (generation !== this.#generation) return;
    this.#master.gain.value = project.master.volume;
    // A deleted track must stop reporting a level, or the mixer keeps a strip alive for it.
    const alive = new Set([MASTER_METER, ...project.timeline.tracks.map((track) => track.id)]);
    for (const id of [...this.#meters.keys()]) {
      if (!alive.has(id)) this.#meters.delete(id);
    }
    this.#channels = project.settings.audioChannels ?? 2;
    this.#tracks = project.timeline.tracks;
    this.#masterEffects = project.master.effects;
    this.#voices = voices;
  }

  startAt(contextTime: number, projectTime: Time): void {
    this.stop();
    this.#compressors.clear();
    // Built before the buses, because a bus needs somewhere to send to and that is now the head of
    // the mastering chain rather than the master fader itself.
    const masterIn = this.#chain(this.#masterEffects, this.#master, contextTime, projectTime);
    const soloing = this.#tracks.some((track) => track.solo);
    const buses = new Map<string, AudioNode>();
    for (const voice of this.#voices) {
      const bus =
        buses.get(voice.track.id) ??
        this.#bus(voice.track, soloing, masterIn, contextTime, projectTime);
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

  /**
   * What every bus is putting out right now, keyed by track id and by `MASTER_METER`. One call per
   * animation frame answers the whole desk, because the expensive part is the read and not the
   * arithmetic -- and because a strip that lagged a frame behind its neighbour would look wrong.
   *
   * `elapsed` is the wall time since the last call, which is what the hold marker falls by. Nothing
   * is scheduled means nothing is playing, and a meter left standing at the last block it saw would
   * be reporting sound that stopped -- so a stopped transport reads silent rather than frozen.
   */
  levels(elapsed = 0): ReadonlyMap<string, Level> {
    const rolling = this.#playing.length > 0;
    const next = new Map<string, Level>();
    for (const [id, node] of this.#meters) {
      if (!rolling) {
        next.set(id, SILENT_LEVEL);
        continue;
      }
      node.getFloatTimeDomainData(this.#window);
      next.set(id, levelFrom([this.#window], this.#levels.get(id), elapsed));
    }
    this.#levels = next;
    return next;
  }

  /**
   * How hard every compressor in the graph is working right now, in decibels below zero, by effect id.
   *
   * Read from the node rather than computed: `DynamicsCompressorNode.reduction` is the amount of gain
   * the node is applying at this instant, and it is the one number about a compressor that cannot be
   * derived from its settings -- what it does depends on what is going through it.
   *
   * Empty while nothing is scheduled. A meter left standing at the last value it saw would report a
   * compressor working on sound that stopped, which is the same rule the level meters follow.
   */
  reductions(): ReadonlyMap<string, number> {
    const found = new Map<string, number>();
    if (this.#playing.length === 0) return found;
    for (const [id, node] of this.#compressors) found.set(id, node.reduction);
    return found;
  }

  setMasterVolume(volume: number): void {
    this.#master.gain.setTargetAtTime(volume, this.#ctx.currentTime, MASTER_GLIDE_SECONDS);
  }

  // Kept across `startAt`, unlike everything in `#live`: a seek rebuilds every bus around it, and a
  // meter that were rebuilt with them would lose its hold marker every time the playhead moved.
  #meter(id: string): AnalyserNode {
    const existing = this.#meters.get(id);
    if (existing !== undefined) return existing;
    const node = this.#ctx.createAnalyser();
    node.fftSize = METER_WINDOW;
    this.#meters.set(id, node);
    return node;
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
    // The offline effects are part of what the samples *are*, so they are part of what the cache is
    // keyed by: turning the noise reduction up has to decode nothing again and analyse everything
    // again, and dragging the clip must do neither.
    const offline = offlineChain(clip);
    const key = `${hash}|${clip.inPoint}|${outPoint(clip)}|${reverse}|${offlineKey(offline)}`;
    const cached = this.#buffers.get(key);
    if (cached !== undefined) return cached;
    try {
      const decoded = await this.#source.bufferFor(hash, clip.inPoint, outPoint(clip));
      const turned = reverse ? this.#reversed(decoded) : decoded;
      const buffer = this.#offline(turned, offline);
      this.#buffers.set(key, buffer);
      return buffer;
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  /**
   * The offline effects, applied to the samples themselves.
   *
   * After the reverse rather than before it, because that is the order the chain reads in: a clip
   * plays reversed and then its noise is taken out, and the noise floor of a reversed recording is the
   * same floor either way. Channel by channel, because a floor is a property of one microphone.
   *
   * ponytail: 2048-point windows at a quarter hop over the whole clip, on this thread. A minute of
   * stereo is about a second of work, paid once per change of setting and never during playback. A
   * worker would hide it -- worth doing the day somebody drags the amount slider rather than sets it.
   */
  #offline(buffer: AudioBuffer, chain: readonly OfflinePass[]): AudioBuffer {
    if (chain.length === 0) return buffer;
    const out = this.#ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    const plane = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      buffer.copyFromChannel(plane, channel);
      let samples: Float32Array<ArrayBuffer> = plane;
      for (const pass of chain) samples = pass.effect.apply(samples, pass.values);
      out.copyToChannel(samples, channel);
    }
    return out;
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
  #bus(
    track: Track,
    soloing: boolean,
    masterIn: AudioNode,
    contextTime: number,
    projectTime: Time,
  ): AudioNode {
    const gain = this.#ctx.createGain();
    gain.gain.value = soloing && !track.solo ? 0 : track.muted ? 0 : track.volume;
    // After the fader, which is what the strip's meter is asked about: what this track is sending, not
    // what its clips were before anyone touched the desk. The tap is disconnected first because it
    // outlives the bus around it -- a seek builds a new one every time, and the meter has to survive
    // that or a hold marker would be reset by scrubbing.
    //
    // Ahead of the panner rather than behind it, and that is a change surround forced: a six-channel
    // tap would report the loudest speaker rather than the level of the track, and a strip reads a
    // track. In stereo the two are the same number.
    const meter = this.#meter(track.id);
    meter.disconnect();
    const placed = isSurround(this.#channels) ? this.#place(track) : this.#stereoPan(track);
    gain.connect(meter).connect(placed.head);
    placed.out.connect(masterIn);
    this.#live.push(gain, ...placed.nodes);
    return this.#chain(track.effects, gain, contextTime, projectTime);
  }

  // The stereo case, unchanged: one native node, one number.
  #stereoPan(track: Track): Placed {
    const panner = this.#ctx.createStereoPanner();
    panner.pan.value = track.pan;
    return { head: panner, out: panner, nodes: [panner] };
  }

  /**
   * A track placed in the surround field: one gain per output channel, merged into the layout.
   *
   * Built out of a splitter, a gain per destination and a merger rather than out of a `PannerNode`,
   * because that node is a stereo device -- it renders a 3D position to two channels through HRTF or
   * an equal-power law and has no notion of a centre speaker or an LFE. What a surround panner is, is
   * exactly this table of gains, and `surroundGains` is where the table is decided.
   *
   * A stereo track keeps its width: each of its two channels is placed half a pan-width to its own
   * side, so a bed left alone comes out of the front pair the way it went in. A mono track is a point.
   *
   * The LFE is a send with a low-pass in front of it, at the 120 Hz the specification for that channel
   * asks for -- a band rather than a place, which is why it is a knob of its own and not a position.
   */
  #place(track: Track): Placed {
    const ctx = this.#ctx;
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(this.#channels);
    const nodes: AudioNode[] = [splitter, merger];
    const spread = stereoSpread(track.pan, track.rear ?? 0);
    for (const [source, gains] of spread.entries()) {
      for (const [channel, level] of gains.entries()) {
        if (level <= 0) continue;
        const send = ctx.createGain();
        send.gain.value = level;
        splitter.connect(send, source).connect(merger, 0, channel);
        nodes.push(send);
      }
    }
    const lfe = track.lfe ?? 0;
    if (lfe > 0) {
      // Off both channels, so a track panned hard to one side still reaches the subwoofer: the LFE has
      // no side, and half the low end of a mix is not what a send of one asked for.
      const cut = ctx.createBiquadFilter();
      cut.type = "lowpass";
      cut.frequency.value = LFE_CUTOFF_HZ;
      const send = ctx.createGain();
      send.gain.value = lfe;
      for (const source of [0, 1]) splitter.connect(cut, source);
      cut.connect(send).connect(merger, 0, CHANNEL.lfe);
      nodes.push(cut, send);
    }
    return { head: splitter, out: merger, nodes };
  }

  // Inserts sit ahead of the fader, the way a console wires them: the fader then rides a signal the
  // compressor has already levelled, so pulling it down changes how loud the track is and not what
  // the compressor is doing to it. The same rule on the master leaves `setMasterVolume`'s glide as
  // the last thing before the output, which is what a fader is for.
  //
  // Walked backwards because each effect is built already connected to what stands downstream of
  // it, and what comes back is the head -- the node whoever is upstream should feed.
  #chain(
    effects: readonly Effect[],
    destination: AudioNode,
    contextTime: number,
    projectTime: Time,
  ): AudioNode {
    let head = destination;
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const effect = effects[index]!;
      if (!effect.enabled) continue;
      const manifest = audioEffect(effect.effectType);
      // A blur someone put on an audio bus, or a type this build does not carry. Silently passing
      // it through costs that one effect; refusing would cost the whole track its sound.
      if (manifest === undefined) continue;
      const built = manifest.build(this.#ctx);
      for (const param of manifest.params) {
        const knob = built.knobs.get(param.key);
        if (knob === undefined) continue;
        automate(knob, this.#points(effect, param, contextTime, projectTime), contextTime);
      }
      built.node.connect(head);
      this.#live.push(built.node);
      // Kept by effect id so a strip can ask how hard its own compressor is working. Only the nodes
      // that *have* an answer are held: `reduction` is a property of `DynamicsCompressorNode` and of
      // nothing else, and a map with a zero in it for every gain and filter would be a reading.
      if (isCompressor(built.node)) this.#compressors.set(effect.id, built.node);
      head = built.node;
    }
    return head;
  }

  // The same shape a fade takes, and the same `automate` underneath: a list of corners scheduled
  // once, interpolated by the audio thread per sample. A cutoff written per animation frame is a
  // staircase, and a staircase in a filter frequency is a zipper.
  #points(
    effect: Effect,
    param: EffectParam,
    contextTime: number,
    projectTime: Time,
  ): Point[] {
    const corners = sampleTimes(effect.keyframes[param.key] ?? []);
    // Nothing keyframed: one value, held. Asked at the moment playback opens, because a project
    // whose parameter is static still has a core that is the one to state what static means.
    if (corners.length === 0) corners.push(projectTime);
    return corners.map((at) => ({
      // In flicks first and seconds after, so a corner an hour into the timeline lands on the
      // sample the timeline says it does.
      at: contextTime + timeToSeconds(at - projectTime),
      value: this.#valueAt(effect, param, at),
    }));
  }

  // The core resolves, this clamps. A project file may carry a cutoff of a million or a `ParamValue`
  // that is not a number at all, and a BiquadFilterNode takes both without complaint.
  #valueAt(effect: Effect, param: EffectParam, at: Time): number {
    const resolved = this.#params?.(at).get(effect.id)?.get(param.key);
    return clampParam(param, (resolved ?? effect.params[param.key])?.value);
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
    node.connect(gain).connect(bus);
    // An AudioBufferSourceNode reads its buffer at the running integral of `playbackRate`, and that
    // is the same integral `sourceTimeAt` takes for the picture. Handing the platform the rate
    // curve is therefore not an approximation of the mapping -- it is the mapping, computed on the
    // audio thread. A ramp that moved the picture and not the sound would be the failure this
    // replaces; here there is no second place for it to happen.
    automate(node.playbackRate, ratePoints(clip, contextTime, projectTime), contextTime);
    // Offset and duration are measured in the buffer's own time, which under a ramp is no longer a
    // multiple of the timeline's -- so both come from the core's own mapping rather than from a
    // rate times a span.
    const from = Math.max(clip.start, projectTime);
    node.start(
      Math.max(contextTime, contextTime + timeToSeconds(clip.start - projectTime)),
      timeToSeconds(consumedBetween(clip, clip.start, from)),
      timeToSeconds(consumedBetween(clip, from, end)),
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
  params?: EffectParams,
): Promise<number> {
  const graph = new AudioGraph(ctx as unknown as BaseAudioContext, source, params);
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

// Where the core gets asked, for one keyframed parameter. The corners are where the shape may turn;
// the steps between them are what makes an eased segment a polyline through the core's own values
// instead of a straight run between its ends. A linear segment is untouched by them -- every extra
// sample lands back on the line it already had -- and the one a single flick short of each corner is
// what keeps a hold a step rather than a ramp across its last eighth.
//
// No interpolation is done here, which is the point: this decides *when* to ask and the core decides
// what the answer is, so an eased sweep sounds like the curve the inspector drew.
function sampleTimes(track: readonly Keyframe[]): Time[] {
  const times: Time[] = [];
  const push = (at: Time): void => {
    if (times.length === 0 || at > times[times.length - 1]!) times.push(at);
  };
  for (const [index, corner] of track.entries()) {
    push(corner.time);
    const next = track[index + 1];
    if (next === undefined) continue;
    const span = next.time - corner.time;
    for (let step = 1; step < CURVE_STEPS; step += 1) {
      push(corner.time + Math.round((span * step) / CURVE_STEPS));
    }
    push(next.time - 1);
  }
  return times;
}

// The rate curve as automation corners. Without a ramp it is one value held, which is what the
// static rate always was.
//
// ponytail: the corners are `sampleTimes`'s, so a `linear` or `hold` segment comes out exact -- the
// platform's ramp between two corners is the same trapezoid the core integrates -- while an `ease`
// segment is a polyline of CURVE_STEPS through the curve, a fraction of a millisecond adrift over a
// second of ramp. Raise CURVE_STEPS if that ever shows against a sample.
function ratePoints(clip: Clip, contextTime: number, projectTime: Time): Point[] {
  const track = clip.keyframes?.[SPEED_TRACK] ?? [];
  if (track.length === 0) return [{ at: contextTime, value: clip.speed.rate }];
  return sampleTimes(track).map((at) => ({
    at: contextTime + timeToSeconds(at - projectTime),
    value: speedRateAt(clip, at),
  }));
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
  return audibleClips(project).some(({ clip }) => audibleHash(clip, library) !== undefined);
}

// The range that has to be decoded, which under a ramp is no longer the duration times a rate. It
// comes from the core's own `consumedSource` for the same reason the schedule's offsets do: a
// buffer shorter than the ramp consumes ends in silence partway through the clip, and nothing else
// here would report it. The cache key above is built from this, so a ramp that changes the range
// decodes a new buffer rather than reusing one cut for a different speed.
function outPoint(clip: Clip): Time {
  return clip.inPoint + consumedSource(clip);
}

/** One offline pass and the settings it runs at. */
interface OfflinePass {
  effect: OfflineAudioEffect;
  values: Record<string, number>;
}

/**
 * The offline effects on a clip, in chain order, with their static values.
 *
 * Static and not resolved at an instant, deliberately: this rewrites the samples once for the whole
 * clip, and a keyframed amount would be a promise that the sweep is heard. The inspector therefore
 * offers no keyframe switch for one, and a hand-authored track is read at the value it starts from.
 */
function offlineChain(clip: Clip): OfflinePass[] {
  const passes: OfflinePass[] = [];
  for (const authored of clip.effects) {
    if (!authored.enabled) continue;
    const effect = offlineAudioEffect(authored.effectType);
    if (effect === undefined) continue;
    const values: Record<string, number> = {};
    for (const param of effect.params) {
      const written = authored.params[param.key];
      const value = written?.kind === "float" ? written.value : param.default;
      values[param.key] = clampParam(param, value);
    }
    passes.push({ effect, values });
  }
  return passes;
}

function offlineKey(chain: readonly OfflinePass[]): string {
  return chain
    .map((pass) => `${pass.effect.id}:${Object.entries(pass.values).sort().flat().join(",")}`)
    .join("|");
}

/** A track's panning stage: where the signal goes in, where it comes out, and what to release. */
interface Placed {
  head: AudioNode;
  out: AudioNode;
  nodes: readonly AudioNode[];
}

// A compressor and a limiter are the same native node held at different settings, and it is the only
// node here with a `reduction` to read. Asked of the node rather than of the effect type, so a manifest
// that later builds one under a third name needs no change here.
function isCompressor(node: AudioNode): node is DynamicsCompressorNode {
  return "reduction" in node && typeof (node as DynamicsCompressorNode).reduction === "number";
}
