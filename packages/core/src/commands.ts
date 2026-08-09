import type {
  Clip,
  ClipSource,
  Command,
  EffectTarget,
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

export function secondsToTime(seconds: number): Time {
  return Math.round(seconds * FLICKS_PER_SECOND);
}

export function timeToSeconds(time: Time): number {
  return time / FLICKS_PER_SECOND;
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

// `Clip::source_offset`. A constant rate makes this a multiplication; a rate track makes it the
// area under that track, and that is the whole of what a speed ramp is -- project time maps to
// source time through an integral, not through a factor.
function sourceOffset(clip: Clip, delta: Time): Time {
  const area = integrate(clip.keyframes[SPEED_TRACK] ?? [], clip.start, clip.start + delta);
  return Math.round(area ?? delta * clip.speed.rate);
}

// `keyframe::integrate`, flick for flick. `undefined` where the track cannot be integrated exactly
// -- a bezier key or a value that is not a number -- and the caller then falls back to the static
// rate, the same as the core does. Both shapes are refused at the load boundary, so this only
// answers `undefined` for a project a later version wrote.
function integrate(track: readonly Keyframe[], from: Time, to: Time): number | undefined {
  if (track.length === 0) return undefined;
  for (const keyframe of track) {
    if (keyframe.interp === "bezier" || keyframe.value.kind !== "float") return undefined;
  }
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
  if (next === undefined || span <= 0 || left.interp === "hold") return rateOf(left) * width;
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

  markerAdd: (time: Time, label: string) => ({ type: "marker.add", time, label }),
  markerRemove: (marker: string) => ({ type: "marker.remove", marker }),
  markerRename: (marker: string, label: string) => ({ type: "marker.rename", marker, label }),

  // Since M1 the bytes live in OPFS rather than in WASM memory, so the caller is the only side
  // that ever sees them and has to supply the id it hashed them to. The core still checks the
  // id's canonical form, the duration and the frame rate before the asset enters the library.
  mediaImport: (asset: MediaAsset) => ({ type: "media.import", asset }),
  mediaRemove: (media: string) => ({ type: "media.remove", media }),
} satisfies Record<string, (...args: never[]) => Command>;
