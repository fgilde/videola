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
 * The keyframe track a speed ramp lives on, spelled as `clip::SPEED_TRACK` spells it.
 */
export const SPEED_TRACK = "speed";

/**
 * The interpolations this surface can author. The three presets are the common cases and stay a
 * single click; `bezier` joins them now that a handle can be dragged, and a shape that cannot be
 * undone from the surface that set it is exactly what kept it out before.
 */
export const OFFERED: readonly Interp[] = ["linear", "hold", "ease", "bezier"];

/**
 * The same list without the curve, for the one track that cannot carry one. A rate track is
 * integrated to say how much source a clip has consumed, and a bezier has no elementary
 * antiderivative -- an inexact area would break the additivity the whole time mapping stands on, so
 * the core refuses it. Offering it here and having the core say no is a menu entry that draws the
 * wrong frame.
 */
export const OFFERED_ON_SPEED: readonly Interp[] = ["linear", "hold", "ease"];

/**
 * Whether this row is the one a speed ramp lives on. A speed track hangs off the clip itself, so an
 * effect parameter that happens to be called `speed` is not it.
 */
export function isSpeedRow(row: { effectType: string | null; key: string }): boolean {
  return row.effectType === null && row.key === SPEED_TRACK;
}

/**
 * A keyframe loaded from a file may carry an interpolation this row cannot author -- a `bezier` on
 * a rate track, written by hand. Listing it keeps a select truthful about what is set instead of
 * displaying the first option instead.
 */
export function offeredFor(interp: Interp, allowed: readonly Interp[] = OFFERED): readonly Interp[] {
  return allowed.includes(interp) ? allowed : [interp, ...allowed];
}
