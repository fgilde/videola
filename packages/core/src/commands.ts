import type {
  Clip,
  ClipSource,
  Command,
  EffectTarget,
  Interp,
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
// against the real Rust build rather than against a second reading of this file.
export function consumedSource(clip: Clip): Time {
  return Math.round(clip.duration * clip.speed.rate);
}

export function sourceTimeAt(clip: Clip, at: Time): Time | undefined {
  if (at < clip.start || at >= clip.start + clip.duration) return undefined;
  const offset = Math.round((at - clip.start) * clip.speed.rate);
  return clip.speed.reverse ? clip.inPoint + consumedSource(clip) - offset : clip.inPoint + offset;
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
