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
  exclude?: ClipId;
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
  const radius = options.radiusPx * options.flicksPerPixel;
  let best: SnapCandidate | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of withGrid(time, candidates, options.gridStep)) {
    const distance = Math.abs(candidate.time - time);
    if (distance > radius) continue;
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== undefined && RANK[candidate.kind] < RANK[best.kind])
    ) {
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
      if (clip.id === options.exclude) continue;
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
