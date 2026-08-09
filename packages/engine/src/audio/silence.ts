import { cmd } from "@videola/core";

import type { Clip, Command, Project, Time, Track } from "@videola/core";
import type { Peaks } from "@videola/media";

import { DEFAULT_DETECT, gapsBetween, loudSpans } from "./detect";
import type { DetectOptions, Span } from "./detect";

/**
 * What cutting silence needs of a document: the state to look at between two edits, and somewhere
 * to send the next one. `VideolaDocument` satisfies it, and so does anything else that keeps a
 * project and applies a command -- which is what makes this testable against the real core rather
 * than against a stand-in that splits clips by its own arithmetic.
 */
export interface CutTarget {
  readonly state: Project;
  dispatch(command: Command, coalesceKey?: string): void;
}

/** Where a track goes quiet, in project time -- the complement of where its clips are sounding. */
export function silentSpans(
  track: Track,
  peaks: ReadonlyMap<string, Peaks>,
  options: DetectOptions = DEFAULT_DETECT,
): Span[] {
  return track.clips.flatMap((clip) => {
    const read = peaks.get(clip.id);
    if (read === undefined) return [];
    const within = { from: clip.start, to: clip.start + clip.duration };
    return gapsBetween(loudSpans(read, clip, options), within);
  });
}

/**
 * Cuts each quiet stretch out of the track, leaving a gap where it was.
 *
 * A gap and not a ripple, deliberately. Rippling would pull everything after the cut earlier on
 * this track alone, and every other track -- the picture the voice belongs to above all -- would
 * stay where it was. Silence removal is worth having; silence removal that walks the sound off the
 * lips is not. Whoever wants the timeline closed up can ripple-delete the gaps afterwards, which is
 * one command they can see and undo.
 *
 * Applied one edit at a time against a live document rather than returned as a list, because a
 * split mints a new clip id in the core and the piece being thrown away is exactly that new clip.
 * Nothing here holds an id across an edit for that reason: every clip is found again by where it
 * sits, which is what makes the order the spans are taken in not matter -- measured, by taking the
 * same three cuts in both directions and getting the same timeline.
 *
 * Returns how many stretches were actually removed, which is what the interface reports.
 */
export function cutSilence(
  doc: CutTarget,
  trackId: string,
  quiet: readonly Span[],
  coalesceKey?: string,
): number {
  let cut = 0;
  // Sorted so that a caller handing them over in any order gets the same timeline back, not
  // because the loop needs it: each round looks the clip up by what it covers.
  for (const span of [...quiet].sort((a, b) => b.from - a.from)) {
    const track = trackOf(doc.state, trackId);
    const clip = track?.clips.find(
      (candidate) => candidate.start < span.to && end(candidate) > span.from,
    );
    if (track === undefined || clip === undefined) continue;
    const from = Math.max(clip.start, span.from);
    const to = Math.min(end(clip), span.to);
    if (to <= from) continue;

    const send = (command: Command): void => doc.dispatch(command, coalesceKey);
    // The whole clip is quiet: nothing to split off it.
    if (from <= clip.start && to >= end(clip)) {
      send(cmd.clipRemove(clip.id));
      cut += 1;
      continue;
    }
    // A cut that reaches the end of the clip leaves nothing after it, so only the front is split
    // off -- and it is the front that keeps the id, which is why the piece to remove is looked up
    // by where it starts rather than named.
    if (to < end(clip)) send(cmd.clipSplit(clip.id, to));
    if (from > clip.start) send(cmd.clipSplit(clip.id, from));
    const removed = trackOf(doc.state, trackId)?.clips.find((candidate) => candidate.start === from);
    if (removed !== undefined) {
      send(cmd.clipRemove(removed.id));
      cut += 1;
    }
  }
  return cut;
}

const end = (clip: Clip): Time => clip.start + clip.duration;

const trackOf = (project: Project, id: string): Track | undefined =>
  project.timeline.tracks.find((track) => track.id === id);
