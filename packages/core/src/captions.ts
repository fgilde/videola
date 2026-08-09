import { cmd, FLICKS_PER_SECOND, millisecondsToTime, timeToMilliseconds } from "./commands";

import type { Clip, ClipId, Command, Generator, JsonValue, Project, Time, Track } from "./generated";

/**
 * One subtitle: when it comes up, when it goes, and the words. Times are flicks like everything
 * else on the timeline -- the millisecond a file carries is turned into one at the boundary, in
 * `millisecondsToTime`, and never anywhere else.
 */
export interface Cue {
  start: Time;
  end: Time;
  text: string;
}

// A caption file is something someone was handed, so every bound below is a real limit rather than
// a formality. A three-hour feature runs to about two thousand cues; ten times that is generous and
// still leaves a timeline that can be drawn. Without it a file of a million lines becomes a million
// clips, each of which the core normalises and the timeline lays out.
export const MAX_CUES = 20_000;

// The same ceiling `Time::MAX_REASONABLE` puts on any other time, applied here so a cue at
// 99:00:00 is dropped on its own rather than taking the whole import down when the core refuses it.
const MAX_TIME = FLICKS_PER_SECOND * 60 * 60 * 24;

// One line, both formats. SRT writes the fraction after a comma and always gives the hours; WebVTT
// writes it after a full stop and may leave the hours out. Reading both with one expression is what
// makes "the same cues either way" a fact about the parser rather than about two of them agreeing.
const CUE_TIMES =
  /^\s*(?:(\d{1,3}):)?(\d{1,3}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,3}):(\d{2})[.,](\d{1,3})(?:\s|$)/;

/**
 * The cues in an SRT or a WebVTT, in time order.
 *
 * Untrusted input throughout: a block whose timestamp will not parse, whose end does not come after
 * its start, whose text is blank, or that sits further out than a project may reach is dropped and
 * the rest of the file is still read. A file that is not a caption file at all yields no cues
 * rather than an exception -- the caller has a track to fill, and "nothing to put on it" is an
 * answer it can act on.
 */
export function parseCaptions(source: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of blocks(source)) {
    const cue = readCue(block);
    if (cue !== undefined) cues.push(cue);
    if (cues.length === MAX_CUES) break;
  }
  // A file out of order is a file someone edited by hand, and a track laid out in file order would
  // put its clips in an order nothing downstream expects. Sorting by end as well keeps two cues
  // that start together in a settled order, so writing them back is reproducible.
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

// CR would otherwise be the last character of every line, including a timestamp's milliseconds. A
// byte order mark needs no line of its own: `\s` in a JavaScript regular expression already matches
// U+FEFF, so the `^\s*` the timestamp starts with eats it, and stripping it here as well would be a
// line no test could ever fail.
function blocks(source: string): string[] {
  return source
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split(/\n[ \t]*\n/);
}

function readCue(block: string): Cue | undefined {
  const lines = block.split("\n");
  // Whatever stands before the timestamp is an index or a cue identifier, and there is at most one
  // of either -- but a NOTE block has no timestamp at all, which is exactly why this searches for
  // the line rather than assuming where it is.
  const at = lines.findIndex((line) => line.includes("-->"));
  if (at < 0) return undefined;
  const times = CUE_TIMES.exec(lines[at]!);
  if (times === null) return undefined;
  const start = millisecondsToTime(stamp(times, 1));
  const end = millisecondsToTime(stamp(times, 5));
  if (end <= start || start < 0 || end > MAX_TIME) return undefined;
  const text = clean(lines.slice(at + 1).join("\n"));
  return text.length === 0 ? undefined : { start, end, text };
}

// Three groups plus a fraction, from `offset`. The hours group is optional in WebVTT, and the
// fraction may be one or two digits, in which case it is tenths or hundredths and not milliseconds.
function stamp(match: RegExpExecArray, offset: number): number {
  const hours = Number(match[offset] ?? "0");
  const minutes = Number(match[offset + 1]);
  const seconds = Number(match[offset + 2]);
  const fraction = match[offset + 3]!;
  const milliseconds = Number(fraction.padEnd(3, "0"));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

// The renderer draws one run of text in one style, so a tag is not something it can honour -- and
// left in it would be drawn as the characters `<i>`. Dropped rather than refused: a file with
// italics in it is an ordinary file, and losing the italics is the honest cost of a generator that
// has no italics per word. The five named entities are the ones WebVTT defines.
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&lrm;": "",
  "&rlm;": "",
};

function clean(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity] ?? entity)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** The cues as an SRT: numbered from one, `HH:MM:SS,mmm`, a blank line after each. */
export function toSrt(cues: readonly Cue[]): string {
  return cues
    .map((cue, index) => `${index + 1}\n${span(cue, ",")}\n${cue.text}\n`)
    .join("\n");
}

/** The cues as a WebVTT: the header, then the same blocks without their numbers. */
export function toVtt(cues: readonly Cue[]): string {
  return `WEBVTT\n${cues.map((cue) => `\n${span(cue, ".")}\n${cue.text}\n`).join("")}`;
}

function span(cue: Cue, separator: string): string {
  return `${clock(cue.start, separator)} --> ${clock(cue.end, separator)}`;
}

// The one place a flick becomes a wall clock. Every division below happens on the millisecond the
// time already is, never on a fraction of a second -- a difference taken in seconds and then
// multiplied back lands a millisecond either side often enough to be visible.
function clock(time: Time, separator: string): string {
  const total = Math.max(0, timeToMilliseconds(time));
  const milliseconds = total % 1000;
  const seconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / 3_600_000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}${separator}${pad(milliseconds, 3)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * How a subtitle looks unless someone changes it: white on a translucent black plate, low and
 * centred, in the same style keys `textStyle` in packages/engine/src/generate/text.ts already
 * reads. Nothing new is being drawn -- what was missing was the combination.
 *
 * The plate is what makes it readable on a bright sky and on a night interior both. A stroke alone
 * survives one and not the other, and a stroke wide enough for both eats the counters of the
 * letters. The stroke is kept as well and narrow, so clearing the plate still leaves an edge.
 *
 * `y` is the *centre* of the block, and the generator has no bottom anchor, so a three-line caption
 * grows down as well as up. 0.84 keeps three lines inside the frame; a fourth would run off, and
 * subtitles are two lines by convention for exactly that reason.
 *
 * No animation on purpose: a subtitle that fades in is unreadable for the first third of a second
 * it is on screen, and it is on screen for about two.
 */
export const CAPTION_STYLE: Readonly<Record<string, JsonValue>> = {
  fontSize: 0.05,
  fontWeight: 600,
  align: "center",
  x: 0.5,
  y: 0.84,
  maxWidth: 0.8,
  lineHeight: 1.25,
  color: "#ffffff",
  background: "#000000b3",
  padding: 0.35,
  strokeWidth: 0.03,
  strokeColor: "#000000",
};

/** The commands that put `cues` on a track as ordinary clips, one clip per cue. */
export function captionClips(track: string, cues: readonly Cue[]): Command[] {
  return cues.map((cue) =>
    cmd.clipAdd(
      track,
      { kind: "generator", generator: { type: "text", content: cue.text, style: { ...CAPTION_STYLE } } },
      cue.start,
      cue.end - cue.start,
    ),
  );
}

/**
 * The cues a project holds, read back off its caption tracks.
 *
 * Only caption tracks, and that is the whole reason `TrackKind::Caption` exists: a lower third is a
 * text clip on a text track, and a subtitle file written from every text clip in the project would
 * carry the lower thirds as cues.
 *
 * A hidden track is left out. It is not in the picture, so it is not in the file either -- the same
 * rule `paints` applies in the renderer, and the alternative is a subtitle file carrying lines the
 * viewer was never shown.
 */
export function captionCues(project: Project, track?: string): Cue[] {
  const cues: Cue[] = [];
  for (const candidate of project.timeline.tracks) {
    if (!isCaptionTrack(candidate, track)) continue;
    for (const clip of candidate.clips) {
      const text = captionText(clip);
      if (text !== undefined && clip.duration > 0) {
        cues.push({ start: clip.start, end: clip.start + clip.duration, text });
      }
    }
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

function isCaptionTrack(candidate: Track, track?: string): boolean {
  if (candidate.kind !== "caption" || candidate.hidden) return false;
  return track === undefined || candidate.id === track;
}

/** The words a clip draws, if it draws words at all. */
export function captionText(clip: Clip): string | undefined {
  return textGenerator(clip)?.content;
}

/**
 * The clip's text generator, narrowed. The inspector needs the whole thing rather than the words
 * alone, because `clip.setGenerator` replaces the whole block and a style dropped on the way
 * through would restyle the caption every time someone corrected a typo in it.
 */
export function textGenerator(clip: Clip): Extract<Generator, { type: "text" }> | undefined {
  if (clip.source.kind !== "generator" || clip.source.generator.type !== "text") return undefined;
  return clip.source.generator;
}

/**
 * Two captions into one: the words joined on their own lines, the span reaching from the first
 * one's head to the second one's tail, and the second clip gone.
 *
 * Three commands the core already has rather than a fourth it would have to grow, dispatched under
 * one coalesce key so the whole merge is one undo step. Nothing here is new machinery -- which is
 * the point, because a merge that behaved differently from a retype and a trim would be a fourth
 * thing to keep in step with the other three.
 */
export function mergeCaptions(project: Project, clip: ClipId): Command[] {
  const pair = mergeable(project, clip);
  if (pair === undefined) return [];
  const [first, second] = pair;
  const held = textGenerator(first);
  if (held === undefined) return [];
  // The first caption's own style is kept, not the default: someone who restyled it meant it.
  const content = `${held.content}\n${captionText(second) ?? ""}`.trim();
  const generator = { ...held, content };
  // Never negative: a second caption that ends before the first does would otherwise shorten it.
  const reach = Math.max(0, second.start + second.duration - (first.start + first.duration));
  return [
    cmd.clipSetGenerator(first.id, generator),
    ...(reach > 0 ? [cmd.clipTrim(first.id, "end", reach)] : []),
    cmd.clipRemove(second.id),
  ];
}

/** Whether there is a next caption on the same track to merge this one with. */
export function canMergeCaptions(project: Project, clip: ClipId): boolean {
  return mergeable(project, clip) !== undefined;
}

// The clip and the caption that follows it on the same track. "Follows" is by start time and not by
// array position: a track's clips are not kept sorted, and merging with whatever happens to be next
// in the array would join two captions minutes apart.
function mergeable(project: Project, clip: ClipId): [Clip, Clip] | undefined {
  for (const track of project.timeline.tracks) {
    const first = track.clips.find((candidate) => candidate.id === clip);
    if (first === undefined) continue;
    if (track.kind !== "caption" || captionText(first) === undefined) return undefined;
    const second = track.clips
      .filter((candidate) => candidate.id !== clip && candidate.start >= first.start)
      .filter((candidate) => captionText(candidate) !== undefined)
      .sort((a, b) => a.start - b.start)[0];
    return second === undefined ? undefined : [first, second];
  }
  return undefined;
}
