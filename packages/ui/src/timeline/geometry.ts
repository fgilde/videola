import { FLICKS_PER_SECOND, type Clip, type Rate, type Time, type Track } from "@videola/core";

// Browsers stop honouring element widths somewhere above 33 million pixels, and the content div
// is as wide as the whole project. Staying below that is what keeps the scroll container from
// silently truncating the timeline instead of scrolling it.
export const MAX_ELEMENT_WIDTH_PX = 30_000_000;

// One frame at 30 fps is 23.5 million flicks, so this is roughly 118 pixels per frame - past the
// point where more zoom shows anything new.
export const MIN_FLICKS_PER_PIXEL = 200_000;
export const MAX_FLICKS_PER_PIXEL = 10 * FLICKS_PER_SECOND;

// ponytail: the element-width ceiling is enforced by refusing the zoom, so a project longer than
// about 2.4 hours cannot be zoomed all the way in. Lifting that means the content div stops
// being as wide as the project and the scroll offset gets driven by hand.
export function minZoomFor(contentDuration: Time): number {
  return Math.max(MIN_FLICKS_PER_PIXEL, contentDuration / MAX_ELEMENT_WIDTH_PX);
}

export const MIN_TRACK_HEIGHT = 44;
export const COARSE_TRIM_ZONE_PX = 44;
export const FINE_TRIM_ZONE_PX = 8;

export interface TimeRange {
  from: Time;
  to: Time;
}

export function clampZoom(flicksPerPixel: number, contentDuration = 0): number {
  const floor = minZoomFor(contentDuration);
  if (!Number.isFinite(flicksPerPixel) || flicksPerPixel <= 0) return floor;
  return Math.min(MAX_FLICKS_PER_PIXEL, Math.max(floor, flicksPerPixel));
}

export function timeToX(time: Time, flicksPerPixel: number): number {
  return time / flicksPerPixel;
}

// The single place a pixel becomes a time, so every gesture rounds identically.
export function xToTime(x: number, flicksPerPixel: number): Time {
  return Math.round(x * flicksPerPixel);
}

export function visibleRange(
  scrollLeft: number,
  viewportWidth: number,
  flicksPerPixel: number,
  overscanPx = 200,
): TimeRange {
  return {
    from: Math.max(0, xToTime(scrollLeft - overscanPx, flicksPerPixel)),
    to: Math.max(0, xToTime(scrollLeft + viewportWidth + overscanPx, flicksPerPixel)),
  };
}

// ponytail: linear scan per track per render. Clips are kept sorted by start in the core, so a
// binary search on the lower bound is the upgrade if a project ever holds enough clips to show.
export function clipsInRange(clips: readonly Clip[], range: TimeRange): Clip[] {
  return clips.filter((clip) => clip.start < range.to && clip.start + clip.duration > range.from);
}

export function frameDuration(fps: Rate): Time {
  const rate = fps.numerator / fps.denominator;
  if (!Number.isFinite(rate) || rate <= 0) return FLICKS_PER_SECOND;
  return Math.round(FLICKS_PER_SECOND / rate);
}

const STEP_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const STEP_FRAMES = [1, 2, 5, 10];

export function tickStep(flicksPerPixel: number, fps: Rate, minSpacingPx = 90): Time {
  const frame = frameDuration(fps);
  for (const frames of STEP_FRAMES) {
    if (timeToX(frame * frames, flicksPerPixel) >= minSpacingPx) return frame * frames;
  }
  for (const seconds of STEP_SECONDS) {
    const step = seconds * FLICKS_PER_SECOND;
    if (timeToX(step, flicksPerPixel) >= minSpacingPx) return step;
  }
  return 3600 * FLICKS_PER_SECOND;
}

export function rulerTicks(range: TimeRange, step: Time): Time[] {
  if (step <= 0) return [];
  const ticks: Time[] = [];
  for (let at = Math.ceil(range.from / step) * step; at <= range.to; at += step) {
    ticks.push(at);
  }
  return ticks;
}

export function trackHeight(track: Track): number {
  return Math.max(MIN_TRACK_HEIGHT, track.height);
}

// tracks[0] is drawn lowest, because that is the order the compositor blends in.
export function trackAt(tracks: readonly Track[], y: number): number {
  if (tracks.length === 0) return -1;
  let top = 0;
  for (let index = tracks.length - 1; index > 0; index -= 1) {
    top += trackHeight(tracks[index] as Track);
    if (y < top) return index;
  }
  return 0;
}

export function trimZoneWidth(clipWidthPx: number, pointerZonePx: number): number {
  return Math.max(2, Math.min(pointerZonePx, clipWidthPx / 3));
}
