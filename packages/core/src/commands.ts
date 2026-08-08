import type {
  ClipSource,
  Command,
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

export const cmd = {
  projectSetSettings: (settings: ProjectSettings) => ({ type: "project.setSettings", settings }),
  projectSetTitle: (title: string) => ({ type: "project.setTitle", title }),

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

  effectAdd: (clip: string, effectType: string) => ({
    type: "effect.add",
    clip,
    effectType,
  }),
  effectSetParam: (clip: string, effectType: string, key: string, value: ParamValue) => ({
    type: "effect.setParam",
    clip,
    effectType,
    key,
    value,
  }),

  // Sending this again at the same `time` replaces the keyframe there, so a slider drag over a
  // keyframed parameter is the same shape as a clip drag: one dispatch per pointer move, all of
  // them under one coalesce key, one entry on the undo stack.
  keyframeAdd: (
    clip: string,
    effectType: string,
    key: string,
    time: Time,
    value: ParamValue,
    interp: Interp = "linear",
  ) => ({ type: "keyframe.add", clip, effectType, key, time, value, interp }),
  keyframeRemove: (clip: string, effectType: string, key: string, time: Time) => ({
    type: "keyframe.remove",
    clip,
    effectType,
    key,
    time,
  }),
  keyframeMove: (clip: string, effectType: string, key: string, from: Time, to: Time) => ({
    type: "keyframe.move",
    clip,
    effectType,
    key,
    from,
    to,
  }),
  keyframeSetInterp: (
    clip: string,
    effectType: string,
    key: string,
    time: Time,
    interp: Interp,
  ) => ({ type: "keyframe.setInterp", clip, effectType, key, time, interp }),

  // Since M1 the bytes live in OPFS rather than in WASM memory, so the caller is the only side
  // that ever sees them and has to supply the id it hashed them to. The core still checks the
  // id's canonical form, the duration and the frame rate before the asset enters the library.
  mediaImport: (asset: MediaAsset) => ({ type: "media.import", asset }),
  mediaRemove: (media: string) => ({ type: "media.remove", media }),
} satisfies Record<string, (...args: never[]) => Command>;
