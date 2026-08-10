import { leafClips } from "../nesting";
import { drawList, isGroup, type DrawItem, type DrawList, type DrawNode } from "./draw-list";

import type { EffectParamSnapshot, Project, Time, TransformSnapshot } from "@videola/core";

/**
 * One instant inside a clip's exposure: where the clip stood then, and which picture it showed.
 *
 * `frame` is what a decoder handed back for that instant. Absent means "keep whatever the texture
 * holds", the same rule a late frame gets in the ordinary path: a sample with no picture still counts
 * as a sample, because dropping it would make the smear brighter at one end than the other.
 */
export interface Smear {
  matrix: readonly number[];
  uv: readonly [number, number, number, number];
  frame?: VideoFrame;
}

/**
 * How many instants a shutter is sampled at. Fixed rather than a setting, and shared by the preview
 * and the export, because a sample count is the one part of a smear a person cannot see and would
 * still make the two pictures differ. Eight is where a pan stops reading as a row of copies.
 */
export const SHUTTER_SAMPLES = 8;

/**
 * The instants one clip is exposed at, centred on the output frame.
 *
 * Centred rather than trailing: a camera's shutter opens before the moment the frame is named after
 * and closes after it, so a subject blurs symmetrically about where it is. A trailing window would
 * drag every moving thing behind its own position by half the exposure, which reads as lag.
 *
 * The first and last sample sit *inside* the window rather than on its edges. Two samples at the very
 * ends of a full-frame shutter would be shared with the frames either side and the smear would show
 * a seam at every frame boundary.
 */
export function exposure(at: Time, amount: number, frameFlicks: number): Time[] {
  if (!(amount > 0) || !Number.isFinite(amount) || frameFlicks <= 0) return [at];
  const window = Math.min(Math.max(amount, 0), 1) * frameFlicks;
  const step = window / SHUTTER_SAMPLES;
  const first = at - window / 2 + step / 2;
  const times: Time[] = [];
  for (let index = 0; index < SHUTTER_SAMPLES; index += 1) {
    // Never before the head of the timeline: a decoder has nothing there and the core answers for
    // nothing, so a negative instant would cost a sample and lighten one end of the smear.
    times.push(Math.max(0, Math.round(first + index * step)));
  }
  return times;
}

/** Which clips carry a shutter, and how wide. Nested clips included: a smear is a clip's own. */
export function blurAmounts(project: Project): Map<string, number> {
  const found = new Map<string, number>();
  for (const clip of leafClips(project)) {
    const amount = clip.motionBlur ?? 0;
    if (amount > 0) found.set(clip.id, amount);
  }
  return found;
}

/** The item for one clip inside a list, wherever the walk put it — nested clips are inside groups. */
export function itemFor(list: DrawList | DrawNode[], clip: string): DrawItem | undefined {
  const nodes = Array.isArray(list) ? list : list.items;
  for (const node of nodes) {
    if (isGroup(node)) {
      const inside = itemFor(node.items as DrawNode[], clip);
      if (inside !== undefined) return inside;
      continue;
    }
    if (node.clip === clip) return node;
  }
  return undefined;
}

/**
 * Where a clip stood at one instant of its exposure, as the draw list sees it.
 *
 * The whole list is built for that instant rather than the one clip's matrix being computed here.
 * Placement is the product of a transform, a crop, the frame and every compound the clip sits inside,
 * and a second answer to that would be a second geometry to keep in step with the first — the exact
 * mistake `quadMatrix` exists to prevent. A list is a walk over the timeline in JavaScript; the eight
 * of them per blurred clip cost nothing beside one decode.
 */
export function placementAt(
  project: Project,
  clip: string,
  at: Time,
  params: EffectParamSnapshot,
  transforms: TransformSnapshot,
): { matrix: readonly number[]; uv: readonly [number, number, number, number] } | undefined {
  const item = itemFor(drawList(project, at, params, transforms), clip);
  return item === undefined ? undefined : { matrix: item.matrix, uv: item.uv };
}
