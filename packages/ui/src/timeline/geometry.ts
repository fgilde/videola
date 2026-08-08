import {
  FLICKS_PER_SECOND,
  frameDuration,
  type Clip,
  type MediaId,
  type Project,
  type Rate,
  type Time,
  type Track,
  type TrackId,
} from "@videola/core";

/** A pointer that went down on a library entry and has not been let go of yet. */
export interface MediaGrab {
  media: MediaId;
  x: number;
  y: number;
}

/** Where a grabbed medium would land if the pointer were released now. */
export interface MediaDrop {
  media: MediaId;
  track: TrackId;
  at: Time;
}

// The ruler and the transport must step by the same amount playback does, so the definition
// lives in the core next to the other time arithmetic and is only re-exported here.
export { frameDuration };

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

// Where the timeline stops and where "jump to the end" lands. Clips are kept sorted by start,
// but the last one is not necessarily the one that ends last.
export function projectEnd(project: Project): Time {
  return project.timeline.tracks.reduce(
    (longest, track) =>
      track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), longest),
    0,
  );
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
  // The floor is the outer clamp: written the other way round it loses to the ceiling once a
  // project is long enough for the two to cross, and the content element silently truncates.
  return Math.max(floor, Math.min(MAX_FLICKS_PER_PIXEL, flicksPerPixel));
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

export const MIN_CLIP_BOX_PX = 8;
export const MIN_TRIM_ZONE_PX = 5;
export const MIN_CLIP_LABEL_PX = 24;

export interface ClipBox {
  clip: Clip;
  start: Time;
  end: Time;
  count: number;
}

// Windowing in time alone is not enough. Zoom out far enough and the window holds the whole
// project, so an hour of one-second clips becomes an hour of DOM nodes. A run of clips that would
// draw thinner than a few pixels cannot be told apart on screen anyway, so it draws as one box.
// That makes the node count a function of the viewport instead of the material: every box either
// spans at least minWidthPx or is followed by a gap that wide, so their number is bounded by the
// visible width divided by that constant.
export function clipBoxes(
  clips: readonly Clip[],
  range: TimeRange,
  flicksPerPixel: number,
  minWidthPx = MIN_CLIP_BOX_PX,
): ClipBox[] {
  const boxes: ClipBox[] = [];
  let run: ClipBox | undefined;

  for (const clip of clipsInRange(clips, range)) {
    const end = clip.start + clip.duration;
    if (run === undefined) {
      run = { clip, start: clip.start, end, count: 1 };
      continue;
    }
    const wideEnough = timeToX(run.end - run.start, flicksPerPixel) >= minWidthPx;
    // A visible gap has to break the run, or one box would span an empty stretch of timeline.
    const gapVisible = timeToX(clip.start - run.end, flicksPerPixel) >= minWidthPx;
    if (wideEnough || gapVisible) {
      boxes.push(run);
      run = { clip, start: clip.start, end, count: 1 };
      continue;
    }
    run.end = Math.max(run.end, end);
    run.count += 1;
  }

  if (run !== undefined) boxes.push(run);
  return boxes;
}

const STEP_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
// Reaches past 10 frames, or a thousand-frame-per-second project falls off the end of the frame
// ladder and lands on whole seconds, jumping the tick spacing by a factor of forty. Steps of a
// second or more are the seconds ladder's business -- 50 frames of 30 is 1.667 s, which is a
// tick nobody can read.
const STEP_FRAMES = [1, 2, 5, 10, 20, 50, 100, 200, 500];

export function tickStep(flicksPerPixel: number, fps: Rate, minSpacingPx = 90): Time {
  const frame = frameDuration(fps);
  for (const frames of STEP_FRAMES) {
    const step = frame * frames;
    if (step >= FLICKS_PER_SECOND) break;
    if (timeToX(step, flicksPerPixel) >= minSpacingPx) return step;
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

export type ZoomBy = (factor: number, anchorX: number) => void;
