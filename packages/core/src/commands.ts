import type { ClipSource, Command, ParamValue, TrackKind } from "./generated";

export const FLICKS_PER_SECOND = 705_600_000;

export function secondsToTime(seconds: number): number {
  return Math.round(seconds * FLICKS_PER_SECOND);
}

export function timeToSeconds(time: number): number {
  return time / FLICKS_PER_SECOND;
}

export function framesToTime(frame: number, fps: number): number {
  return Math.round((frame * FLICKS_PER_SECOND) / fps);
}

export const cmd = {
  projectSetTitle: (title: string) => ({ type: "project.setTitle", title }),

  trackAdd: (kind: TrackKind, name: string, index: number | null = null) => ({
    type: "track.add",
    kind,
    name,
    index,
  }),
  trackRemove: (track: string) => ({ type: "track.remove", track }),
  trackRename: (track: string, name: string) => ({ type: "track.rename", track, name }),
  trackSetVolume: (track: string, volume: number) => ({
    type: "track.setVolume",
    track,
    volume,
  }),

  clipAdd: (track: string, source: ClipSource, start: number, duration: number) => ({
    type: "clip.add",
    track,
    source,
    start,
    duration,
  }),
  clipRemove: (clip: string) => ({ type: "clip.remove", clip }),
  clipMove: (clip: string, toTrack: string, start: number) => ({
    type: "clip.move",
    clip,
    toTrack,
    start,
  }),
  clipTrim: (clip: string, edge: "start" | "end", delta: number) => ({
    type: "clip.trim",
    clip,
    edge,
    delta,
  }),
  clipSplit: (clip: string, at: number) => ({ type: "clip.split", clip, at }),
  clipSetSpeed: (clip: string, rate: number, reverse: boolean, preservePitch = true) => ({
    type: "clip.setSpeed",
    clip,
    rate,
    reverse,
    preservePitch,
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

  mediaRemove: (media: string) => ({ type: "media.remove", media }),
} satisfies Record<string, (...args: never[]) => Command>;
