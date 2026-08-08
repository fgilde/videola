import { consumedSource, MAX_COMPOUND_DEPTH } from "@videola/core";

import type { Clip, Project, Time, Track } from "@videola/core";

// Every clip with material behind it, however deep it sits. Compound clips are walked through
// rather than returned: they have no medium, no picture and no sound of their own. Ids are unique
// across the whole project, so the result is a flat list and callers keep looking clips up by id.
export function leafClips(project: Project): Clip[] {
  const found: Clip[] = [];
  walk(project.timeline.tracks, 0, (clip) => found.push(clip));
  return found;
}

function walk(tracks: readonly Track[], depth: number, visit: (clip: Clip) => void): void {
  if (depth > MAX_COMPOUND_DEPTH) return;
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.source.kind === "compound") walk(clip.source.timeline.tracks, depth + 1, visit);
      else visit(clip);
    }
  }
}

export interface Voice {
  clip: Clip;
  track: Track;
}

// What the timeline sounds like, as ordinary clips on ordinary tracks. A nested clip is folded
// into the outer timeline's own coordinates, so everything downstream -- the decode range, the
// envelope, the scheduling -- works on a clip and never learns that nesting exists.
//
// Folding rather than evaluating, because the audio graph schedules ahead: an
// AudioBufferSourceNode is told once where it starts and how much of its buffer to play, which
// needs an interval, not the instant-by-instant mapping the picture gets.
//
// The bus stays the outer track's: mute, solo, volume and pan of a track apply to everything
// standing on it, nested or not.
export function audibleClips(project: Project): Voice[] {
  const voices: Voice[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      gather(clip, track, 0, voices);
    }
  }
  return voices;
}

function gather(clip: Clip, track: Track, depth: number, into: Voice[]): void {
  if (depth > MAX_COMPOUND_DEPTH) return;
  if (clip.source.kind !== "compound") {
    into.push({ clip, track });
    return;
  }
  for (const nestedTrack of clip.source.timeline.tracks) {
    for (const nested of nestedTrack.clips) {
      const heard = folded(clip, nested);
      if (heard !== undefined) gather(heard, track, depth + 1, into);
    }
  }
}

// The nested clip as the outer timeline hears it, or nothing where the compound's own range never
// reaches it. Two steps, in this order: cut the clip to the source range the compound actually
// consumes -- in the nested timeline's coordinates, where that is an ordinary trim -- and only then
// map what is left out to project time.
//
// ponytail: the compound's own fades are not applied to what is inside it. Its volume is, because
// a gain composes exactly; an envelope over the group does not, and would want a gain node per
// enclosing compound in the graph. No command writes fades in this version, so the only way to
// reach this is a hand-authored project file.
function folded(outer: Clip, nested: Clip): Clip | undefined {
  const consumed = consumedSource(outer);
  const from = Math.max(nested.start, outer.inPoint);
  const to = Math.min(nested.start + nested.duration, outer.inPoint + consumed);
  if (to <= from) return undefined;
  const cut = trimmedTo(nested, from, to);
  const rate = outer.speed.rate;
  const start = outer.speed.reverse
    ? outer.start + Math.round((outer.inPoint + consumed - to) / rate)
    : outer.start + Math.round((from - outer.inPoint) / rate);
  // Cast for the index signature `Clip` carries to keep unknown fields alive: an object literal
  // cannot satisfy it, a spread of a clip plus a few of that clip's own fields provably does.
  return {
    ...cut,
    start,
    duration: Math.round((to - from) / rate),
    speed: {
      ...cut.speed,
      rate: cut.speed.rate * rate,
      // A compound played backwards plays everything in it backwards, including a clip that was
      // already reversed -- which then reads forwards again.
      reverse: outer.speed.reverse ? !cut.speed.reverse : cut.speed.reverse,
    },
    volume: cut.volume * outer.volume,
  } as Clip;
}

// The same rule `command::clip::trimmed_fields` follows: a forward clip pays a head cut out of its
// in point, a reversed one pays a tail cut out of it instead, because the two ends of a reversed
// clip map to the opposite ends of its source range.
function trimmedTo(clip: Clip, from: Time, to: Time): Clip {
  const head = from - clip.start;
  const tail = clip.start + clip.duration - to;
  const shift = (span: Time): Time => Math.round(span * clip.speed.rate);
  return {
    ...clip,
    start: from,
    duration: to - from,
    inPoint: clip.inPoint + (clip.speed.reverse ? shift(tail) : shift(head)),
  } as Clip;
}
