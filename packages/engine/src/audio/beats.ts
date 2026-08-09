import { cmd, consumedSource, timeToSeconds } from "@videola/core";

import type { Clip, Command, Time, Track } from "@videola/core";
import type { Peaks } from "@videola/media";

import { projectTimeAt } from "./detect";

export interface BeatOptions {
  /**
   * How far above the neighbourhood a rise has to stand to count. Below about 1.2 a sustained note
   * swelling counts as a hit; above about 2.5 only the loudest hit in a bar survives.
   */
  sensitivity: number;
  /** No two beats closer than this. 0.2 s is 300 bpm, which is past anything anyone cuts to. */
  minIntervalSeconds: number;
  /** How much of the track either side sets the neighbourhood a rise is judged against. */
  windowSeconds: number;
}

// Measured against a metronome fixture rather than chosen: at 1.5 every click is found and nothing
// between them is, and the same numbers hold for a track that gets louder halfway through, which is
// what the moving neighbourhood is for.
export const DEFAULT_BEATS: BeatOptions = {
  sensitivity: 1.5,
  minIntervalSeconds: 0.2,
  windowSeconds: 0.5,
};

/**
 * Which buckets a beat falls in.
 *
 * The envelope is what the waveform strip already holds — the loudest sample in each bucket — so
 * this costs a few passes over a few thousand floats rather than a decode. What a beat is, here, is
 * a **rise**: the difference between one bucket and the last, kept only where it is positive. A
 * loud passage is not a beat and a quiet one is full of them, which is why the level itself cannot
 * be the signal and its increase has to be.
 *
 * The threshold moves with the music. A fixed one finds every hit in the loud half of a track and
 * none in the quiet half; a mean over the surrounding second, times a factor, finds the same hits in
 * both. And the rise has to be the largest of its immediate neighbours, so one hit is one beat
 * rather than the three or four buckets its attack is spread over.
 */
export function beatBuckets(
  peaks: Peaks,
  secondsPerBucket: number,
  options: BeatOptions = DEFAULT_BEATS,
): number[] {
  const count = Math.min(peaks.max.length, peaks.min.length);
  if (count < 3 || secondsPerBucket <= 0) return [];

  const flux = new Float32Array(count);
  let previous = 0;
  for (let bucket = 0; bucket < count; bucket += 1) {
    const level = Math.max(Math.abs(peaks.max[bucket] ?? 0), Math.abs(peaks.min[bucket] ?? 0));
    flux[bucket] = Math.max(0, level - previous);
    previous = level;
  }

  const half = Math.max(1, Math.round(options.windowSeconds / secondsPerBucket / 2));
  const apart = Math.max(1, Math.round(options.minIntervalSeconds / secondsPerBucket));
  // A running sum, so the neighbourhood costs one add and one subtract per bucket rather than a
  // window's worth. Over a long track the difference is the whole of what makes this cheap.
  let sum = 0;
  for (let bucket = 0; bucket <= Math.min(half, count - 1); bucket += 1) sum += flux[bucket] ?? 0;

  const found: number[] = [];
  let last = -Infinity;
  for (let bucket = 0; bucket < count; bucket += 1) {
    const from = Math.max(0, bucket - half);
    const to = Math.min(count - 1, bucket + half);
    const mean = sum / (to - from + 1);
    const rise = flux[bucket] ?? 0;
    const rising = rise >= (flux[bucket - 1] ?? 0) && rise > (flux[bucket + 1] ?? 0);
    // Silence has a mean of zero, and everything is above zero times anything. A rise has to be
    // audible on its own before it is compared with its neighbourhood at all.
    if (rise > mean * options.sensitivity && rise > FLOOR && rising && bucket - last >= apart) {
      found.push(bucket);
      last = bucket;
    }
    const leaving = bucket - half;
    const arriving = bucket + half + 1;
    if (leaving >= 0) sum -= flux[leaving] ?? 0;
    if (arriving < count) sum += flux[arriving] ?? 0;
  }
  return found;
}

// A rise of a thousandth of full scale is the noise of a quiet room being quantised, not a drum.
const FLOOR = 0.001;

/** Where a clip's beats fall in project time. */
export function beatTimes(peaks: Peaks, clip: Clip, options: BeatOptions = DEFAULT_BEATS): Time[] {
  const buckets = Math.min(peaks.max.length, peaks.min.length);
  if (buckets === 0) return [];
  // Over the buffer, not over the clip: under a speed ramp the source a clip consumes is not
  // proportional to the time it occupies, and the buckets were laid out over the samples. The same
  // step silence detection takes, through the same function, so a ramp is dealt with in one place.
  const consumed = consumedSource(clip);
  if (consumed <= 0) return [];
  const secondsPerBucket = timeToSeconds(consumed) / buckets;
  return beatBuckets(peaks, secondsPerBucket, options).map((bucket) =>
    projectTimeAt(clip, Math.round((bucket / buckets) * consumed)),
  );
}

/**
 * A marker on every beat of a track, as commands.
 *
 * Markers and not cuts. A beat is a suggestion — the point of finding them is to have something to
 * snap to while cutting, and an editor who wanted every beat cut could not undo it clip by clip.
 * They are numbered rather than named after the track, because what a marker is for here is being
 * counted along: "the fourth one" is how anyone talks about a bar.
 */
export function beatMarkers(
  track: Track,
  peaks: ReadonlyMap<string, Peaks>,
  options: BeatOptions = DEFAULT_BEATS,
): Command[] {
  const times = track.clips
    .flatMap((clip) => {
      const read = peaks.get(clip.id);
      return read === undefined ? [] : beatTimes(read, clip, options);
    })
    .sort((left, right) => left - right);
  return times.map((time, index) => cmd.markerAdd(time, String(index + 1)));
}
