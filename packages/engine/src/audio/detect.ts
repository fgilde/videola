import { consumedBetween, consumedSource, secondsToTime } from "@videola/core";

import type { Clip, Time } from "@videola/core";
import type { Peaks } from "@videola/media";

/** A stretch of the timeline, in project time. Half-open: `from` sounds, `to` is the first that does not. */
export interface Span {
  from: Time;
  to: Time;
}

export interface DetectOptions {
  /** Anything whose peak stays under this counts as nothing being there. */
  thresholdDb: number;
  /** Gaps shorter than this are inside a phrase rather than between two, and get closed up. */
  minGapSeconds: number;
  /** What is left after that and still shorter than this was a click, not a phrase. */
  minSpanSeconds: number;
  /** Grown by this at both ends, so a breath before a word is not cut off it. */
  padSeconds: number;
}

// Below this a peak is the noise floor of a quiet room rather than anything anyone put there, and
// above it a whisper still registers. Speech detection and silence detection want the same number
// from opposite sides, which is the whole reason there is one detector and not two.
export const DEFAULT_DETECT: DetectOptions = {
  thresholdDb: -40,
  minGapSeconds: 0.25,
  minSpanSeconds: 0.15,
  padSeconds: 0.1,
};

/**
 * Where a clip is making a sound, in project time.
 *
 * Read from the peaks the graph already computed for the strip on screen, which is what makes this
 * cheap: the samples were decoded for playback and scanned once for drawing, and this is a third
 * pass over a few thousand floats rather than over a few million.
 *
 * The bucket-to-time step is where a speed ramp and a reversed clip are dealt with, and they are
 * dealt with in one place: buckets are laid out evenly over the *buffer*, and the buffer is the
 * source the clip consumes -- which under a ramp is not proportional to project time at all. So a
 * bucket boundary is turned back into a moment by inverting the core's own `consumedBetween`
 * rather than by dividing a duration. A reversed clip needs no case of its own: its buffer is
 * already the reversed copy the graph plays, so bucket zero is the first thing heard either way.
 */
export function loudSpans(peaks: Peaks, clip: Clip, options = DEFAULT_DETECT): Span[] {
  const buckets = peaks.max.length;
  if (buckets === 0) return [];
  const floor = Math.pow(10, options.thresholdDb / 20);
  const consumed = consumedSource(clip);
  const moment = (bucket: number): Time =>
    projectTimeAt(clip, Math.round((bucket / buckets) * consumed));

  const spans: Span[] = [];
  let open: number | undefined;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const level = Math.max(Math.abs(peaks.max[bucket]!), Math.abs(peaks.min[bucket]!));
    if (level >= floor) {
      open ??= bucket;
      continue;
    }
    if (open !== undefined) spans.push({ from: moment(open), to: moment(bucket) });
    open = undefined;
  }
  if (open !== undefined) spans.push({ from: moment(open), to: clip.start + clip.duration });

  return tidy(spans, options, clip.start, clip.start + clip.duration);
}

/** What is left of `within` once every span is taken out of it -- the silence between the phrases. */
export function gapsBetween(spans: readonly Span[], within: Span): Span[] {
  const gaps: Span[] = [];
  let cursor = within.from;
  for (const span of spans) {
    if (span.from > cursor) gaps.push({ from: cursor, to: span.from });
    if (span.to > cursor) cursor = span.to;
  }
  if (cursor < within.to) gaps.push({ from: cursor, to: within.to });
  return gaps;
}

/** The union of several clips' spans, sorted and merged, which is what a whole track is making. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.from <= last.to) {
      if (span.to > last.to) last.to = span.to;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

// Close the short gaps first, then drop what is still too short, then pad. In that order on
// purpose: padding first would close gaps by the back door and by a distance nobody set, and
// dropping first would throw away the halves of a word that a gap of one bucket had split.
function tidy(spans: readonly Span[], options: DetectOptions, from: Time, to: Time): Span[] {
  const gap = secondsToTime(options.minGapSeconds);
  const closed: Span[] = [];
  for (const span of spans) {
    const last = closed[closed.length - 1];
    if (last !== undefined && span.from - last.to <= gap) {
      last.to = span.to;
      continue;
    }
    closed.push({ ...span });
  }
  const pad = secondsToTime(options.padSeconds);
  const long = closed.filter(
    (span) => span.to - span.from >= secondsToTime(options.minSpanSeconds),
  );
  return mergeSpans(
    long.map((span) => ({
      from: Math.max(from, span.from - pad),
      to: Math.min(to, span.to + pad),
    })),
  );
}

// The inverse of `consumedBetween`, by bisection. There is no closed form: under a rate track the
// map from project time to source time is the area under that track, and a ramp can hold, rise and
// fall inside one clip. Monotone, though -- a rate is never negative -- so halving the interval
// finds the moment to the flick in about fifty steps for a clip of any length.
//
// A clip without a ramp lands on the same answer all the same: for a constant rate the integral is
// the proportional point, so the bisection converges on exactly that.
function projectTimeAt(clip: Clip, consumed: Time): Time {
  let low = clip.start;
  let high = clip.start + clip.duration;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (consumedBetween(clip, clip.start, middle) < consumed) low = middle;
    else high = middle;
  }
  return high;
}
