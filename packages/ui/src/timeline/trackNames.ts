import type { Project } from "@videola/core";

/**
 * A name for a row the application makes itself: what is on it, and a number only where that name
 * is taken.
 *
 * "Ü3" says nothing about which of three overlays carries the words and which the bars. Rows a
 * person makes keep their V1 and A2 -- those are somebody else's to name -- but a row that arrives
 * with a lyric video already on it can say so.
 */
export function namedTrack(project: Project, label: string): string {
  const taken = new Set(project.timeline.tracks.map((track) => track.name));
  if (!taken.has(label)) return label;
  for (let number = 2; ; number += 1) {
    const candidate = `${label} ${number}`;
    if (!taken.has(candidate)) return candidate;
  }
}
