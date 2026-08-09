import { FLICKS_PER_SECOND, millisecondsToTime, timeToMilliseconds } from "./commands";

import type { Time } from "./generated";

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
