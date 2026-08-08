import type { ClipId, Marker, Project, Time } from "@videola/core";

import { clipsInRange, type TimeRange } from "./geometry";

export const SNAP_RADIUS_PX = 10;

export type SnapKind = "playhead" | "clipEdge" | "marker" | "grid";

export interface SnapCandidate {
  time: Time;
  kind: SnapKind;
}

export interface SnapOptions {
  radiusPx: number;
  flicksPerPixel: number;
  gridStep?: Time;
}

export interface SnapResult {
  time: Time;
  candidate?: SnapCandidate;
}

export interface CandidateOptions {
  range: TimeRange;
  playhead?: Time;
  // A set, not one id: a drag moves the whole selection, and a clip travelling with the pointer
  // must not offer its own edge as a line to snap to.
  exclude?: ReadonlySet<ClipId>;
}

// When two lines are equally close the more deliberate one wins: a marker was placed by hand,
// a grid line is only a ruler.
const RANK: Record<SnapKind, number> = { playhead: 0, clipEdge: 1, marker: 2, grid: 3 };

// The radius is measured in pixels and converted to flicks, never the other way round. A radius
// kept in flicks would cover whole seconds once the timeline is zoomed in far enough.
export function snapTime(
  time: Time,
  candidates: readonly SnapCandidate[],
  options: SnapOptions,
): SnapResult {
  // Zero is the off switch, and it has to be an early exit: a radius of zero still admits an
  // exact hit, which drew a snap line for a snap that was not happening.
  if (options.radiusPx <= 0) return { time };
  const radius = options.radiusPx * options.flicksPerPixel;
  let best: SnapCandidate | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of withGrid(time, candidates, options.gridStep)) {
    const distance = Math.abs(candidate.time - time);
    if (distance > radius) continue;
    if (best === undefined || distance < bestDistance || beats(candidate, best, distance, bestDistance)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best === undefined ? { time } : { time: best.time, candidate: best };
}

// A dragged clip snaps on either edge, whichever wants to move less -- lining a clip up behind
// its neighbour is the edit this exists for.
export function snapSpan(
  start: Time,
  duration: Time,
  candidates: readonly SnapCandidate[],
  options: SnapOptions,
): SnapResult {
  const head = snapTime(start, candidates, options);
  const tail = snapTime(start + duration, candidates, options);
  if (tail.candidate === undefined) return head;
  const fromTail: SnapResult = { time: tail.time - duration, candidate: tail.candidate };
  if (head.candidate === undefined) return fromTail;
  return Math.abs(head.time - start) <= Math.abs(fromTail.time - start) ? head : fromTail;
}

export function snapCandidates(project: Project, options: CandidateOptions): SnapCandidate[] {
  const candidates: SnapCandidate[] = [];
  if (options.playhead !== undefined) {
    candidates.push({ time: options.playhead, kind: "playhead" });
  }
  for (const track of project.timeline.tracks) {
    for (const clip of clipsInRange(track.clips, options.range)) {
      if (options.exclude?.has(clip.id) === true) continue;
      candidates.push(
        { time: clip.start, kind: "clipEdge" },
        { time: clip.start + clip.duration, kind: "clipEdge" },
      );
    }
  }
  for (const marker of project.markers) {
    if (inRange(marker, options.range)) candidates.push({ time: marker.time, kind: "marker" });
  }
  return candidates;
}

// Equal distance and equal rank used to be decided by the order the candidates happened to be
// collected in, which is the track order. The earlier time is arbitrary too, but it is the same
// answer every time and does not move when a track is added.
function beats(
  candidate: SnapCandidate,
  best: SnapCandidate,
  distance: Time,
  bestDistance: Time,
): boolean {
  if (distance !== bestDistance) return false;
  if (RANK[candidate.kind] !== RANK[best.kind]) return RANK[candidate.kind] < RANK[best.kind];
  return candidate.time < best.time;
}

function withGrid(
  time: Time,
  candidates: readonly SnapCandidate[],
  gridStep: Time | undefined,
): readonly SnapCandidate[] {
  if (gridStep === undefined || gridStep <= 0) return candidates;
  return [
    ...candidates,
    { time: Math.round(time / gridStep) * gridStep, kind: "grid" },
  ];
}

function inRange(marker: Marker, range: TimeRange): boolean {
  return marker.time >= range.from && marker.time <= range.to;
}
