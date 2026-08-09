import type { Clip, Interp, Keyframe, Time } from "@videola/core";

/**
 * The keyframe track that carries a motion path, spelled as `clip::POSITION_TRACK` spells it. The
 * core resolves it last and it overwrites `x` and `y` outright, which is why a row for either of
 * those has to say so rather than merely stop working.
 */
export const POSITION_TRACK = "position";

/** What the row addresses, in the terms `keyframe.add` and its three siblings take. */
export interface LaneRow {
  /**
   * Unique inside one clip, and the identity a selection and a drag hold on to. Built from the
   * effect's id rather than its type, because a project can carry two effects of one type.
   */
  id: string;
  /** `null` addresses the clip's own transform -- what the commands mean by no effect type. */
  effectType: string | null;
  key: string;
  track: readonly Keyframe[];
  /**
   * A motion path answers the same question this row does, and the core lets the path win. The row
   * stays visible: hiding it would leave the keyframes on it invisible while they are still in the
   * file, and the point of the lane is that what is stored is what is shown.
   */
  overridden: boolean;
}

/**
 * Every keyframe track the clip actually carries, in one list. Empty tracks are left out: the core
 * falls back to the static value the moment a track runs empty, so a row for one would claim an
 * animation that no picture shows.
 */
export function laneRows(clip: Clip): LaneRow[] {
  const path = (clip.keyframes[POSITION_TRACK] ?? []).length > 0;
  const rows: LaneRow[] = [];
  for (const [key, track] of Object.entries(clip.keyframes)) {
    if (track.length === 0) continue;
    rows.push({
      id: `:${key}`,
      effectType: null,
      key,
      track,
      overridden: path && (key === "x" || key === "y"),
    });
  }
  for (const effect of clip.effects) {
    for (const [key, track] of Object.entries(effect.keyframes)) {
      if (track.length === 0) continue;
      rows.push({ id: `${effect.id}:${key}`, effectType: effect.effectType, key, track, overridden: false });
    }
  }
  return rows;
}

/**
 * Where a keyframe of this clip may be dragged to. Outside the clip the parameter is never
 * evaluated -- the same rule that greys the inspector's switch out when the playhead stands
 * elsewhere -- so a drag that left the span would move a key to a place where it does nothing.
 *
 * Clamping here rather than letting the core refuse is also what keeps a drag held against the
 * clip edge from reporting a refusal per pointer move.
 */
export function keyframeSpan(clip: Clip): { from: Time; to: Time } {
  return { from: clip.start, to: Math.max(clip.start, clip.start + clip.duration - 1) };
}

/**
 * Whether a keyframe already sits where a drag wants to go. The core refuses that move, and asking
 * first is what stops an ordinary drag across a neighbour from raising a refusal every few pixels.
 */
export function occupied(track: readonly Keyframe[], time: Time, except: Time): boolean {
  return track.some((entry) => entry.time === time && entry.time !== except);
}

/**
 * The interpolations this surface can author. Bezier is missing because nothing here can drag a
 * handle, and a curve shape that cannot be undone from the surface that set it is worse than one
 * that was never offered. A keyframe loaded from a file may still carry it -- see `offeredFor`.
 */
export const OFFERED: readonly Interp[] = ["linear", "hold", "ease"];

/**
 * A keyframe loaded from a file may carry an interpolation this build cannot author. Listing it
 * keeps a select truthful about what is set instead of displaying the first option instead.
 */
export function offeredFor(interp: Interp): readonly Interp[] {
  return OFFERED.includes(interp) ? OFFERED : [interp, ...OFFERED];
}
