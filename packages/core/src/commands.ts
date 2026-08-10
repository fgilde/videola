import type {
  Clip,
  ClipSource,
  Command,
  EffectTarget,
  Generator,
  Interp,
  Keyframe,
  MediaAsset,
  ParamValue,
  ProjectSettings,
  Rate,
  Time,
  TrackKind,
  Transform,
  Transition,
  TrimEdge,
} from "./generated";

export const FLICKS_PER_SECOND = 705_600_000;

/**
 * How many channels a mix may be laid out over, and what each count means.
 *
 * The same two the core's `AUDIO_LAYOUTS` accepts, because a layout the interface offers and the model
 * refuses would be a control that produces an error. Which channel is which is stated where the
 * placement is done (`surround.ts` in the engine): L, R, C, LFE, Ls, Rs, the order every codec here
 * writes.
 */
export const AUDIO_LAYOUTS: readonly number[] = [2, 6];

/** Whether a layout has anywhere to put a sound other than left and right. */
export function isSurround(channels: number): boolean {
  return channels >= 6;
}

export function secondsToTime(seconds: number): Time {
  return Math.round(seconds * FLICKS_PER_SECOND);
}

export function timeToSeconds(time: Time): number {
  return time / FLICKS_PER_SECOND;
}

// Subtitle formats count in whole milliseconds and this project counts in flicks, and the two meet
// here and nowhere else. 705600000 is a whole multiple of 1000, so a millisecond is exactly 705600
// flicks and neither direction loses anything -- which is the whole reason an SRT can be read and
// written back character for character.
//
// Only one of the two rounds, and deliberately so: a whole millisecond multiplies into a whole
// number of flicks with nothing to decide, while a time a drag left between two milliseconds has to
// land on the nearer of them. Truncating there would make every caption written out creep earlier
// than the one on screen.
export const FLICKS_PER_MILLISECOND = FLICKS_PER_SECOND / 1000;

export function millisecondsToTime(milliseconds: number): Time {
  return milliseconds * FLICKS_PER_MILLISECOND;
}

export function timeToMilliseconds(time: Time): number {
  return Math.round(time / FLICKS_PER_MILLISECOND);
}

// The rate stays rational to the last division: 30000/1001 is not 29.97, and a frame step built
// from the decimal drifts off the timeline's own ruler after a few hundred frames. Everything
// that moves by a frame -- the ruler, the transport, playback -- has to land on the same value.
export function frameDuration(fps: Rate): Time {
  const rate = fps.numerator / fps.denominator;
  if (!Number.isFinite(rate) || rate <= 0) return FLICKS_PER_SECOND;
  return Math.round(FLICKS_PER_SECOND / rate);
}

// The three places an effect chain lives, written the way the wire wants them. A literal at every
// call site would be the same three shapes spelled out fifty times, and one of them spelled wrong.
export const on = {
  clip: (clip: string): EffectTarget => ({ kind: "clip", clip }),
  track: (track: string): EffectTarget => ({ kind: "track", track }),
  project: { kind: "project" } as EffectTarget,
};

// The one limit on how deep compound clips may go, mirrored from `MAX_COMPOUND_DEPTH` in the core.
// A recursive walk without it is a stack overflow a project file can trigger; the number itself is
// the loader's, so what loads is what draws. roundtrip.test.ts checks the two agree by behaviour.
export const MAX_COMPOUND_DEPTH = 8;

// `Clip::consumed_source` and `Clip::source_time_at` in TypeScript. The draw list needs them
// because a nested timeline has to be walked at the instant *inside* it, and that instant cannot
// come out of a batch query: which clips are on screen is what the batch is being asked about.
//
// Always project time towards the source, never the other way round -- and always the same
// rounding as the core, which the differential test in packages/core/src/roundtrip.test.ts pins
// against the real Rust build rather than against a second reading of this file. That pinning is
// what earns the second implementation: the mapping is an integral now, so a disagreement
// accumulates across a clip instead of stopping at one rounding.

// The keyframe track a speed ramp lives on, mirrored from `SPEED_TRACK` in the core. It is the one
// track read by area rather than by value, so the name has to be the same on both sides or a ramp
// authored here would be a track the picture walks past.
export const SPEED_TRACK = "speed";

export function consumedSource(clip: Clip): Time {
  return sourceOffset(clip, clip.duration);
}

export function sourceTimeAt(clip: Clip, at: Time): Time | undefined {
  if (at < clip.start || at >= clip.start + clip.duration) return undefined;
  const offset = sourceOffset(clip, at - clip.start);
  return clip.speed.reverse ? clip.inPoint + consumedSource(clip) - offset : clip.inPoint + offset;
}

// How much source a clip spends between two instants on the timeline. `consumedSource` is this
// asked for the whole clip; the audio graph asks it for the part still to play, and gets a buffer
// offset that is the very source time the picture is drawn from rather than a second computation
// that happens to agree.
export function consumedBetween(clip: Clip, from: Time, to: Time): Time {
  return sourceOffset(clip, to - clip.start) - sourceOffset(clip, from - clip.start);
}

// `Clip::source_offset`. A constant rate makes this a multiplication; a rate track makes it the
// area under that track, and that is the whole of what a speed ramp is -- project time maps to
// source time through an integral, not through a factor.
function sourceOffset(clip: Clip, delta: Time): Time {
  const track = ramp(clip);
  if (track === undefined) return Math.round(delta * clip.speed.rate);
  return Math.round(integrate(track, clip.start, clip.start + delta));
}

// The rate track, if it is one this build can read. A bezier key has no exact area and a value that
// is not a number has none at all; both are refused at the load boundary and by the command layer,
// so a track turned away here was written by a later version -- and the clip then runs at its static
// rate rather than at a guess. `speedRateAt` and `sourceOffset` ask through this one gate, so the
// rate the sound runs at and the rate the picture runs at are never decided differently.
function ramp(clip: Clip): readonly Keyframe[] | undefined {
  // Optional access on a field the type says is always there: a `Clip` reaches this from JSON the
  // core normalised *and* from callers that build one by hand, and the audio path never read
  // `keyframes` at all before this. Missing, the throw lands inside an async decode and comes out
  // as a transport that never starts rather than as an error anyone can see.
  const track = clip.keyframes?.[SPEED_TRACK];
  if (track === undefined || track.length === 0) return undefined;
  for (const keyframe of track) {
    if (keyframe.interp === "bezier" || keyframe.value.kind !== "float") return undefined;
  }
  return track;
}

// The rate the ramp reads at an instant: the curve `integrate` takes the area under. The audio graph
// needs it because an AudioBufferSourceNode reads its buffer at the running integral of
// `playbackRate` -- so handing the platform this curve is not an approximation of the mapping, it is
// the mapping, computed by the audio thread instead of by us.
export function speedRateAt(clip: Clip, at: Time): number {
  const track = ramp(clip);
  if (track === undefined) return clip.speed.rate;
  const first = track[0]!;
  const last = track[track.length - 1]!;
  if (at <= first.time) return rateOf(first);
  if (at >= last.time) return rateOf(last);
  let right = 0;
  while (right < track.length && track[right]!.time <= at) right += 1;
  const left = track[right - 1]!;
  const next = track[right]!;
  const span = next.time - left.time;
  if (span <= 0 || left.interp === "hold") return rateOf(left);
  return (
    rateOf(left) + (rateOf(next) - rateOf(left)) * ease(left.interp, (at - left.time) / span)
  );
}

// `easeArea` is this function's integral. Changing one without the other makes the rate the sound
// runs at and the rate the picture runs at two different curves, which is exactly the failure the
// whole of this file exists to prevent.
function ease(interp: Interp, s: number): number {
  return interp === "ease" ? s * s * (3 - 2 * s) : s;
}

// `keyframe::integrate`, flick for flick, for a track `ramp` has already vouched for.
function integrate(track: readonly Keyframe[], from: Time, to: Time): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from;
  for (const keyframe of track) {
    if (keyframe.time <= cursor || keyframe.time >= to) continue;
    total += spanArea(track, cursor, keyframe.time);
    cursor = keyframe.time;
  }
  return total + spanArea(track, cursor, to);
}

// One interval inside a single segment: `integrate` cuts at every key, so this never straddles two.
// Outside the keys the curve is flat, the same clamp evaluation makes at both ends.
function spanArea(track: readonly Keyframe[], from: Time, to: Time): number {
  const width = to - from;
  let right = 0;
  while (right < track.length && track[right]!.time <= from) right += 1;
  const left = track[right - 1];
  if (left === undefined) return rateOf(track[0]) * width;
  const next = track[right];
  const span = next === undefined ? 0 : next.time - left.time;
  // A held key needs no branch: `easeArea` answers zero at both ends of it, so the general form
  // below already collapses to `width * start`, which is what a hold means.
  if (next === undefined || span <= 0) return rateOf(left) * width;
  const alpha = (from - left.time) / span;
  const beta = (to - left.time) / span;
  const start = rateOf(left);
  return (
    width * start +
    span * (rateOf(next) - start) * (easeArea(left.interp, beta) - easeArea(left.interp, alpha))
  );
}

// The definite integral of the easing from 0 to `s`. `bezier` never arrives; `hold` is settled in
// `spanArea`. Both are here only so every `Interp` has an answer.
function easeArea(interp: Interp, s: number): number {
  if (interp === "linear") return (s * s) / 2;
  if (interp === "ease") return s * s * s - (s * s * s * s) / 2;
  return 0;
}

function rateOf(keyframe: Keyframe | undefined): number {
  return keyframe?.value.kind === "float" ? keyframe.value.value : 0;
}

// What may be handed on: the head of a reversed clip maps one flick past the end of the range it
// consumes, which is a moment neither a decoder nor a nested timeline has.
export function readableSourceTimeAt(clip: Clip, at: Time): Time | undefined {
  const source = sourceTimeAt(clip, at);
  if (source === undefined) return undefined;
  const last = Math.max(clip.inPoint + consumedSource(clip) - 1, clip.inPoint);
  return Math.min(Math.max(source, clip.inPoint), last);
}

export const cmd = {
  projectSetSettings: (settings: ProjectSettings) => ({ type: "project.setSettings", settings }),
  projectSetTitle: (title: string) => ({ type: "project.setTitle", title }),
  // The one fader the whole mix passes through. Clamped in the core to the same 0..4 a track's is,
  // so a drag can send whatever the slider produces.
  projectSetMasterVolume: (volume: number) => ({ type: "project.setMasterVolume", volume }),

  trackAdd: (kind: TrackKind, name: string, index: number | null = null) => ({
    type: "track.add",
    kind,
    name,
    index,
  }),
  trackRemove: (track: string) => ({ type: "track.remove", track }),
  trackReorder: (track: string, toIndex: number) => ({ type: "track.reorder", track, toIndex }),
  trackRename: (track: string, name: string) => ({ type: "track.rename", track, name }),
  trackSetVolume: (track: string, volume: number) => ({
    type: "track.setVolume",
    track,
    volume,
  }),
  // Where a track sits front to back, and how much of it goes to the LFE channel. Both are read only
  // where the project is laid out over more than two channels, and both stay in the file either way.
  trackSetSurround: (track: string, rear: number, lfe: number) => ({
    type: "track.setSurround" as const,
    track,
    rear,
    lfe,
  }),

  trackSetPan: (track: string, pan: number) => ({ type: "track.setPan", track, pan }),
  trackSetFlags: (
    track: string,
    muted: boolean | null = null,
    solo: boolean | null = null,
    locked: boolean | null = null,
    hidden: boolean | null = null,
  ) => ({ type: "track.setFlags", track, muted, solo, locked, hidden }),

  clipAdd: (track: string, source: ClipSource, start: Time, duration: Time) => ({
    type: "clip.add",
    track,
    source,
    start,
    duration,
  }),
  // The two halves of a three-point edit. `inPoint` is the source in point the range was marked
  // at and `duration` is out minus in, so the pair of them is the marked range and `start` is the
  // place on the timeline it lands. Insert moves everything after it on *every* track; overwrite
  // moves nothing and replaces what it covers on the one track named.
  clipInsert: (
    track: string,
    source: ClipSource,
    start: Time,
    duration: Time,
    inPoint: Time = 0,
  ) => ({ type: "clip.insert", track, source, start, duration, inPoint }),
  clipOverwrite: (
    track: string,
    source: ClipSource,
    start: Time,
    duration: Time,
    inPoint: Time = 0,
  ) => ({ type: "clip.overwrite", track, source, start, duration, inPoint }),
  clipRemove: (clip: string) => ({ type: "clip.remove", clip }),
  clipMove: (clip: string, toTrack: string, start: Time) => ({
    type: "clip.move",
    clip,
    toTrack,
    start,
  }),
  clipTrim: (clip: string, edge: TrimEdge, delta: Time) => ({
    type: "clip.trim",
    clip,
    edge,
    delta,
  }),
  clipSplit: (clip: string, at: Time) => ({ type: "clip.split", clip, at }),
  // Deleting without leaving a hole. `clip.remove` keeps the gap, this one closes it by pulling
  // everything that starts at or after the clip's end back by its length.
  clipRippleDelete: (clip: string) => ({ type: "clip.rippleDelete", clip }),
  // Same delta rule as `clipTrim`: computed from the clip's current edge, never accumulated.
  clipRippleTrim: (clip: string, edge: TrimEdge, delta: Time) => ({
    type: "clip.rippleTrim",
    clip,
    edge,
    delta,
  }),
  clipRoll: (clip: string, edge: TrimEdge, delta: Time) => ({
    type: "clip.roll",
    clip,
    edge,
    delta,
  }),
  clipSlip: (clip: string, delta: Time) => ({ type: "clip.slip", clip, delta }),
  clipSlide: (clip: string, delta: Time) => ({ type: "clip.slide", clip, delta }),
  // The whole clip travels, which is what makes this both paste and duplicate: the payload is a
  // clip read out of a project, and the core mints new ids for it. `start` wins over the copy's
  // own start field.
  clipPaste: (track: string, clip: Clip, start: Time) => ({
    type: "clip.paste",
    track,
    clip,
    start,
  }),
  clipGroup: (clips: readonly string[]) => ({ type: "clip.group", clips: [...clips] }),
  clipUngroup: (clip: string) => ({ type: "clip.ungroup", clip }),
  clipNest: (clips: readonly string[]) => ({ type: "clip.nest", clips: [...clips] }),
  clipSetSpeed: (clip: string, rate: number, reverse: boolean, preservePitch = true) => ({
    type: "clip.setSpeed",
    clip,
    rate,
    reverse,
    preservePitch,
  }),
  clipSetVolume: (clip: string, volume: number) => ({ type: "clip.setVolume", clip, volume }),
  // The whole struct, like `clip.setSpeed` and `project.setSettings`: read the clip's current
  // transform, spread the one field that changed. A partial command would need a null per field
  // and could still never express "put the crop back the way it was".
  clipSetTransform: (clip: string, transform: Transform) => ({
    type: "clip.setTransform",
    clip,
    transform,
  }),
  // The whole generator, for the same reason `clipSetTransform` takes the whole transform: read the
  // clip's current one and spread the field that changed. This is the only way a title's or a
  // subtitle's words change after the clip exists.
  // Switch a clip off without taking it out: it keeps its place and its length, nothing draws or plays
  // it, and one press puts it back. The way to compare two takes.
  clipSetEnabled: (clip: string, enabled: boolean) => ({
    type: "clip.setEnabled" as const,
    clip,
    enabled,
  }),

  // How much of a frame the clip was exposed for: 0 off, 0.5 a 180-degree shutter, 1 the whole
  // frame. What the renderer does with it is average the clip over that window.
  clipSetMotionBlur: (clip: string, amount: number) => ({
    type: "clip.setMotionBlur" as const,
    clip,
    amount,
  }),

  clipSetGenerator: (clip: string, generator: Generator) => ({
    type: "clip.setGenerator",
    clip,
    generator,
  }),
  // `null` clears it. Only the incoming edge exists as a command because only `transitionIn` is
  // read when the picture is drawn.
  clipSetTransition: (clip: string, transition: Transition | null) => ({
    type: "clip.setTransition",
    clip,
    transition,
  }),

  // `target` is `on.clip(id)`, `on.track(id)` or `on.project`: an equaliser on a bus and a blur on
  // a clip are the same command pointed at a different chain.
  effectAdd: (target: EffectTarget, effectType: string) => ({
    type: "effect.add",
    target,
    effectType,
  }),
  // Takes the effect out, with its parameters and its keyframes. The counterpart of `effectAdd`, and
  // the reason a switch in the interface can be a switch rather than a one-way door.
  effectRemove: (target: EffectTarget, effectType: string) => ({
    type: "effect.remove" as const,
    target,
    effectType,
  }),

  // Bypass. Everything the effect carries stays where it is, which is what makes hearing what it does
  // and putting it back cost nothing.
  effectSetEnabled: (target: EffectTarget, effectType: string, enabled: boolean) => ({
    type: "effect.setEnabled" as const,
    target,
    effectType,
    enabled,
  }),

  effectSetParam: (target: EffectTarget, effectType: string, key: string, value: ParamValue) => ({
    type: "effect.setParam",
    target,
    effectType,
    key,
    value,
  }),

  // Sending this again at the same `time` replaces the keyframe there, so a slider drag over a
  // keyframed parameter is the same shape as a clip drag: one dispatch per pointer move, all of
  // them under one coalesce key, one entry on the undo stack.
  //
  // `effectType` of `null` addresses the clip's own transform instead of an effect -- the keys are
  // then `x`, `y`, `scaleX`, `scaleY`, `rotation`, `anchorX`, `anchorY`, `opacity` and the four
  // `crop*`, and only a clip target has them.
  keyframeAdd: (
    target: EffectTarget,
    effectType: string | null,
    key: string,
    time: Time,
    value: ParamValue,
    interp: Interp = "linear",
  ) => ({ type: "keyframe.add", target, effectType, key, time, value, interp }),
  keyframeRemove: (target: EffectTarget, effectType: string | null, key: string, time: Time) => ({
    type: "keyframe.remove",
    target,
    effectType,
    key,
    time,
  }),
  keyframeMove: (
    target: EffectTarget,
    effectType: string | null,
    key: string,
    from: Time,
    to: Time,
  ) => ({
    type: "keyframe.move",
    target,
    effectType,
    key,
    from,
    to,
  }),
  keyframeSetInterp: (
    target: EffectTarget,
    effectType: string | null,
    key: string,
    time: Time,
    interp: Interp,
  ) => ({ type: "keyframe.setInterp", target, effectType, key, time, interp }),
  // What a curve editor drags, one pair per keyframe: `handleOut` shapes the travel away from this
  // key and `handleIn` the travel arriving at it, both a point in the segment's own unit square --
  // the same pair CSS `cubic-bezier` takes. `null` clears one back to the default ease-in-out.
  //
  // One dispatch per pointer move under one coalesce key, the shape every other drag here has.
  keyframeSetHandles: (
    target: EffectTarget,
    effectType: string | null,
    key: string,
    time: Time,
    handleIn: [number, number] | null,
    handleOut: [number, number] | null,
  ) => ({ type: "keyframe.setHandles", target, effectType, key, time, handleIn, handleOut }),

  markerAdd: (time: Time, label: string) => ({ type: "marker.add", time, label }),
  markerRemove: (marker: string) => ({ type: "marker.remove", marker }),
  markerRename: (marker: string, label: string) => ({ type: "marker.rename", marker, label }),
  markerSetColor: (marker: string, colorHex: string) => ({
    type: "marker.setColor",
    marker,
    colorHex,
  }),
  markerSetNote: (marker: string, note: string) => ({ type: "marker.setNote", marker, note }),

  // Since M1 the bytes live in OPFS rather than in WASM memory, so the caller is the only side
  // that ever sees them and has to supply the id it hashed them to. The core still checks the
  // id's canonical form, the duration and the frame rate before the asset enters the library.
  mediaImport: (asset: MediaAsset) => ({ type: "media.import", asset }),
  mediaRemove: (media: string) => ({ type: "media.remove", media }),
} satisfies Record<string, (...args: never[]) => Command>;
