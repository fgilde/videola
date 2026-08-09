import { cmd, on, secondsToTime } from "@videola/core";

import type { Command, Time, Track } from "@videola/core";
import type { Peaks } from "@videola/media";

import { DEFAULT_DETECT, loudSpans, mergeSpans } from "./detect";
import type { DetectOptions, Span } from "./detect";

/** The insert a duck is written onto, and the one parameter it moves. Both are `gain`. */
export const DUCK_EFFECT = "gain";
export const DUCK_PARAM = "gain";

export interface DuckOptions {
  /** What the music is pulled down to while the speech is there, as a factor of its own level. */
  duck: number;
  /** How long the fall takes. Long enough not to click, short enough not to swallow a word. */
  attackSeconds: number;
  /** And the rise, which is the slower of the two -- a duck that snapped back would pump. */
  releaseSeconds: number;
  detect: DetectOptions;
}

// Six decibels down is the amount a broadcast bed comes down by: enough that a voice sits on top of
// it, little enough that the music does not disappear. A quarter of a second down and half a second
// back up is the ordinary radio setting, and both are here as numbers a caller may change rather
// than as constants nobody can reach.
export const DEFAULT_DUCK: DuckOptions = {
  duck: 0.5,
  attackSeconds: 0.25,
  releaseSeconds: 0.5,
  detect: DEFAULT_DETECT,
};

/**
 * Where the speech on a track is, from the peaks the graph already read for the strips.
 *
 * A whole track rather than a clip: speech cut into six clips is one voice, and a bed ducked per
 * clip would rise back up in every join. `mergeSpans` is what makes two clips that touch one span.
 */
export function speechSpans(
  track: Track,
  peaks: ReadonlyMap<string, Peaks>,
  options = DEFAULT_DETECT,
): Span[] {
  return mergeSpans(
    track.clips.flatMap((clip) => {
      const read = peaks.get(clip.id);
      return read === undefined ? [] : loudSpans(read, clip, options);
    }),
  );
}

/**
 * The duck itself: keyframes on a `gain` insert on the music bus, one command per corner.
 *
 * The choice this makes, and why. Web Audio has no sidechain -- `DynamicsCompressorNode` takes one
 * input and there is no second one to key it off -- so a sidechain compressor here would have to be
 * built out of an analyser and a gain written per frame, which is the staircase every other
 * envelope in this graph exists to avoid. Keyframes cost nothing extra: the insert chain already
 * automates every parameter it has, sample by sample on the audio thread, and preview and export
 * read the same track of them. And what is written is *visible*: the strip draws the curve's
 * corners with the same diamond the inspector uses, so a duck that came out wrong is a keyframe to
 * drag rather than an automatic to argue with.
 *
 * Four corners per phrase -- open, down, down, open -- which is a trapezoid and not a notch. The
 * attack is taken *before* the speech starts rather than at it, because a bed that begins to fall
 * on the first syllable has already covered it.
 */
export function duckCommands(
  music: Track,
  spans: readonly Span[],
  options = DEFAULT_DUCK,
): Command[] {
  const target = on.track(music.id);
  const existing = music.effects.find((effect) => effect.effectType === DUCK_EFFECT);
  // Ducking twice must replace the curve, not lay a second one over it: `keyframe.add` upserts at
  // the instant it is given and leaves every other corner where it was, so the old ones go first.
  // A duck run against a re-cut voice track would otherwise keep the corners of the old cut.
  const cleared = (existing?.keyframes[DUCK_PARAM] ?? []).map((keyframe) =>
    cmd.keyframeRemove(target, DUCK_EFFECT, DUCK_PARAM, keyframe.time),
  );
  return [
    ...(existing === undefined ? [cmd.effectAdd(target, DUCK_EFFECT)] : cleared),
    ...duckCorners(spans, options).map(({ at, value }) =>
      cmd.keyframeAdd(target, DUCK_EFFECT, DUCK_PARAM, at, { kind: "float", value }),
    ),
  ];
}

export interface Corner {
  at: Time;
  value: number;
}

/**
 * The corners of the curve, in project time. Split out from the commands because this is the part
 * with a shape to check: a test can read it as numbers rather than as a list of dispatches.
 *
 * Two phrases close enough together that the rise of one would run into the fall of the next leave
 * the bed down in between, which is what a real console does and what an editor would have drawn by
 * hand -- the alternative is a bump between two sentences.
 */
export function duckCorners(spans: readonly Span[], options = DEFAULT_DUCK): Corner[] {
  const attack = secondsToTime(options.attackSeconds);
  const release = secondsToTime(options.releaseSeconds);
  const corners: Corner[] = [];
  const push = (at: Time, value: number): void => {
    const last = corners[corners.length - 1];
    // A clip at the head of the timeline has nowhere to put its attack, so the rise and the fall
    // land on the same instant -- and two keyframes at one moment have no order between them. The
    // later of the two is the one that was meant.
    if (last !== undefined && last.at === at) last.value = value;
    else corners.push({ at, value });
  };

  for (let index = 0; index < spans.length; index += 1) {
    const from = spans[index]!.from;
    let to = spans[index]!.to;
    // Two phrases close enough that the rise after one would still be climbing when the next fall
    // began: the bed stays down between them. That is what a console does and what an editor would
    // have drawn, and the alternative is an audible bump between two sentences.
    while (index + 1 < spans.length && spans[index + 1]!.from - attack <= to + release) {
      index += 1;
      to = spans[index]!.to;
    }
    push(Math.max(0, from - attack), 1);
    push(from, options.duck);
    push(to, options.duck);
    push(to + release, 1);
  }
  return corners;
}
