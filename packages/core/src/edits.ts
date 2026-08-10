import { cmd } from "./commands";

import type { Command } from "./generated/Command";
import type { EffectTarget } from "./generated/EffectTarget";
import type { Keyframe } from "./generated/Keyframe";
import type { Project } from "./generated/Project";
import type { Time } from "./generated/Time";

/**
 * What an edit that takes several commands needs of a document: the state to look at between two of
 * them, and somewhere to send the next. `VideolaDocument` satisfies it, and so does anything else
 * that keeps a project and applies a command — which is what makes this testable against the real
 * core rather than against a stand-in that splits clips by its own arithmetic.
 */
export interface EditTarget {
  readonly state: Project;
  dispatch(command: Command, coalesceKey?: string): void;
}

/**
 * Cut every clip that spans one of these instants.
 *
 * Applied one edit at a time against a live document rather than returned as a list of commands,
 * and for the reason a list cannot be right: a split mints two clips out of one, so the second cut
 * through the same clip names an id the first cut has already retired. Every clip is found again by
 * where it sits, immediately before it is cut.
 *
 * A locked track is passed over rather than dispatched at and refused. The core would say no either
 * way — that is where the rule lives — but "cut at the markers" is an operation over whatever is
 * there, and one locked track must not take the other five with it.
 *
 * Under one coalescing key, so a hundred cuts are one press of undo. Returns how many were made,
 * which is what an interface reports.
 */
export function splitAtTimes(
  target: EditTarget,
  times: readonly Time[],
  coalesceKey?: string,
): number {
  let made = 0;
  // Sorted and deduplicated: two markers on the same instant are one cut, and cutting left to right
  // means the piece a later instant falls in is always the right-hand half of the last cut.
  const instants = [...new Set(times)].sort((left, right) => left - right);
  for (const at of instants) {
    for (const track of target.state.timeline.tracks) {
      if (track.locked) continue;
      // Strictly inside: a cut on a clip's own edge would ask the core to make a piece of length
      // zero, which it refuses, and a marker sitting exactly on a cut is a marker with nothing to do.
      const clip = track.clips.find(
        (candidate) => candidate.start < at && at < candidate.start + candidate.duration,
      );
      if (clip === undefined) continue;
      target.dispatch(cmd.clipSplit(clip.id, at), coalesceKey);
      made += 1;
    }
  }
  return made;
}

/**
 * One key's easing, on every other key of its own track.
 *
 * A shape someone spent a minute on is a shape they want for the whole move, not for one segment of
 * it, and setting it again key by key is the same minute over and over. This is the answer to
 * "copy this curve", scoped to the one place a curve means the same thing everywhere: a single
 * parameter's own track. Across two parameters it would need a second track's keys to line up with
 * the first's, and nothing in the model says they do.
 *
 * Returned as commands rather than applied against a live document, because neither `setInterp` nor
 * `setHandles` mints or retires a key: every one of them names a time that is already there, so the
 * list cannot go stale between the first and the last.
 *
 * The interpolation goes out with the handles. Handles on a key set to `linear` are stored and
 * ignored, so a "copy the curve" that copied only the pair would be a press that changes nothing --
 * and both together on one coalescing key are one entry in the history.
 */
export function spreadEasing(
  track: readonly Keyframe[],
  target: EffectTarget,
  effectType: string | null,
  key: string,
  from: Keyframe,
): Command[] {
  const handleIn = from.handleIn ?? null;
  const handleOut = from.handleOut ?? null;
  return track
    .filter((keyframe) => keyframe.time !== from.time)
    .flatMap((keyframe) => [
      cmd.keyframeSetInterp(target, effectType, key, keyframe.time, from.interp),
      cmd.keyframeSetHandles(target, effectType, key, keyframe.time, handleIn, handleOut),
    ]);
}

/** Every marker's instant, which is what "cut on the beat" is asking for. */
export function markerTimes(project: Project): Time[] {
  return project.markers.map((marker) => marker.time);
}
