import type {
  ClipSource,
  Command,
  ParamValue,
  ProjectSettings,
  Rate,
  Time,
  TrackKind,
  TrimEdge,
} from "./generated";

export const FLICKS_PER_SECOND = 705_600_000;

export function secondsToTime(seconds: number): Time {
  return Math.round(seconds * FLICKS_PER_SECOND);
}

export function timeToSeconds(time: Time): number {
  return time / FLICKS_PER_SECOND;
}

export function framesToTime(frame: number, fps: Rate): Time {
  return Math.round((frame * FLICKS_PER_SECOND * fps.denominator) / fps.numerator);
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

  mediaRemove: (media: string) => ({ type: "media.remove", media }),
} satisfies Record<string, (...args: never[]) => Command>;
