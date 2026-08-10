import { cmd } from "./commands";

import type { Clip } from "./generated/Clip";
import type { ClipId } from "./generated/ClipId";
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

/** Which of a clip's attributes to carry over. Each is a group somebody would ask for by name. */
export interface Attributes {
  /** Position, scale, rotation, anchor, opacity and crop — and the keys that animate any of them. */
  geometry: boolean;
  /** The effect chain, its parameters, and the keys on those. */
  effects: boolean;
  /** Gain and the speed ramp. */
  sound: boolean;
}

export const ALL_ATTRIBUTES: Attributes = { geometry: true, effects: true, sound: true };

/**
 * One clip's look on other clips — what every editor calls pasting attributes.
 *
 * The model is the clip on the clipboard, which is what `Ctrl`+`C` already put there. A second
 * store for "the clip whose attributes I want" would be a second thing to keep in step with the
 * first, and the question "which clip is the model" has one honest answer: the one you copied.
 *
 * Effects are added by type and then set parameter by parameter, because that is the whole of what
 * the command bus offers — there is no "replace this chain" command, and inventing one would put a
 * second authority on what an effect chain may contain next to `effect.add`. A type the target
 * already carries is left where it is and its parameters are overwritten: `effect.add` treats a
 * repeated type as a no-op, so the chain cannot grow a second brightness.
 *
 * Keyframes travel with whatever they animate. A geometry key is `null`-targeted, an effect key
 * names its type, and both go out with their interpolation and their handles — a paste that dropped
 * the easing would hand back a move that lands in the right place and gets there wrongly.
 */
export function pasteAttributes(
  from: Clip,
  onto: readonly ClipId[],
  what: Attributes = ALL_ATTRIBUTES,
): Command[] {
  const commands: Command[] = [];
  for (const clip of onto) {
    if (clip === from.id) continue;
    const target = { kind: "clip" as const, clip };
    if (what.geometry) {
      commands.push(cmd.clipSetTransform(clip, from.transform));
      for (const [key, track] of Object.entries(from.keyframes)) {
        // The speed ramp is a keyframe track like any other and belongs to the sound group, not to
        // the geometry: it is the one track the picture reads by area rather than by value.
        if (key === SPEED_TRACK) continue;
        commands.push(...keysOnto(target, null, key, track));
      }
    }
    if (what.sound) {
      commands.push(
        cmd.clipSetVolume(clip, from.volume),
        cmd.clipSetSpeed(clip, from.speed.rate, from.speed.reverse, from.speed.preservePitch),
      );
      const ramp = from.keyframes[SPEED_TRACK];
      if (ramp !== undefined) commands.push(...keysOnto(target, null, SPEED_TRACK, ramp));
    }
    if (what.effects) {
      for (const effect of from.effects) {
        commands.push(cmd.effectAdd(target, effect.effectType));
        for (const [key, value] of Object.entries(effect.params)) {
          commands.push(cmd.effectSetParam(target, effect.effectType, key, value));
        }
        for (const [key, track] of Object.entries(effect.keyframes)) {
          commands.push(...keysOnto(target, effect.effectType, key, track));
        }
      }
    }
  }
  return commands;
}

// The rate track's own name, spelled the way the core spells it.
const SPEED_TRACK = "speed";

// A whole keyframe track onto another clip: the key, its interpolation, and its handles. `add`
// carries the interpolation already, so the pair is the only thing left to say -- and only where
// there is one, because sending `null` twice would clear a default that was never set.
function keysOnto(
  target: EffectTarget,
  effectType: string | null,
  key: string,
  track: readonly Keyframe[],
): Command[] {
  return track.flatMap((keyframe) => {
    const add = cmd.keyframeAdd(
      target,
      effectType,
      key,
      keyframe.time,
      keyframe.value,
      keyframe.interp,
    );
    if (keyframe.handleIn == null && keyframe.handleOut == null) return [add];
    return [
      add,
      cmd.keyframeSetHandles(
        target,
        effectType,
        key,
        keyframe.time,
        keyframe.handleIn ?? null,
        keyframe.handleOut ?? null,
      ),
    ];
  });
}

/** Every marker's instant, which is what "cut on the beat" is asking for. */
export function markerTimes(project: Project): Time[] {
  return project.markers.map((marker) => marker.time);
}
