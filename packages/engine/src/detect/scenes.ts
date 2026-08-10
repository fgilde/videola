/**
 * Finding the cuts in a recording that already has them.
 *
 * A card off a camera is one long file with a dozen takes in it, and the first thing anybody does with
 * it is find the joins by hand. This is that, done by looking: every frame is reduced to a small grid
 * of brightnesses, consecutive grids are compared, and a moment where the picture changes far more than
 * it did on either side of it is a cut.
 *
 * Split into three pieces on purpose. `frameSignature` and `signatureDistance` touch pixels;
 * `sceneCuts` is arithmetic over a list of numbers and knows nothing about frames, which is what lets
 * the decision — what counts as a cut — be tested without a decoder, a driver or a fixture.
 */

/** How coarse the comparison is. */
const GRID_WIDE = 32;
const GRID_HIGH = 18;

export const SIGNATURE_SIZE = GRID_WIDE * GRID_HIGH;

/**
 * One frame as a grid of brightnesses, 0 to 1.
 *
 * Coarse on purpose. At 32 by 18 a pan, a hand moving through shot and a compression artefact all
 * average away, while a cut to another scene changes most cells at once — which is the difference the
 * whole thing rests on. Finer would find motion; coarser would miss a cut between two shots of the same
 * room.
 *
 * Rec. 709 luma rather than a channel average, because a cut between two frames of the same brightness
 * and different hue is a cut a person sees, and green carries most of what an eye reads as light.
 */
export function frameSignature(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: CanvasImageSource,
): Float32Array {
  ctx.drawImage(frame, 0, 0, GRID_WIDE, GRID_HIGH);
  const pixels = ctx.getImageData(0, 0, GRID_WIDE, GRID_HIGH).data;
  const signature = new Float32Array(SIGNATURE_SIZE);
  for (let cell = 0; cell < SIGNATURE_SIZE; cell += 1) {
    const at = cell * 4;
    signature[cell] =
      (0.2126 * pixels[at]! + 0.7152 * pixels[at + 1]! + 0.0722 * pixels[at + 2]!) / 255;
  }
  return signature;
}

/** How far apart two frames are: the mean absolute difference per cell, 0 to 1. */
export function signatureDistance(one: Float32Array, other: Float32Array): number {
  const cells = Math.min(one.length, other.length);
  if (cells === 0) return 0;
  let total = 0;
  for (let cell = 0; cell < cells; cell += 1) total += Math.abs(one[cell]! - other[cell]!);
  return total / cells;
}

export interface SceneOptions {
  /**
   * How far two consecutive frames have to be apart before the moment is a candidate, 0 to 1.
   *
   * 0.12 is about a tenth of the whole brightness range averaged over every cell, which a cut between
   * two different shots clears easily and a pan, a flash or a hand across the lens does not.
   */
  threshold: number;
  /**
   * How much bigger the change has to be than the neighbourhood it sits in.
   *
   * This is what tells a cut from a dissolve. A dissolve changes the picture steadily over a second, so
   * every frame of it clears any threshold that a cut clears — and every frame of it would be reported
   * as a cut. A cut is a *spike*: the frame before and after it are quiet. So a candidate has to be
   * this many times the median change around it, and a dissolve, however strong, never is.
   */
  prominence: number;
  /**
   * The fewest frames between two cuts. Nothing in an edit cuts twice inside a few frames, and a
   * flash frame otherwise reports two.
   */
  minGap: number;
}

export const SCENE_DEFAULTS: SceneOptions = { threshold: 0.12, prominence: 3, minGap: 8 };

/**
 * Which frames a cut lands on, given how far each frame is from the one before it.
 *
 * Index `i` of `distances` is the distance between frame `i` and frame `i + 1`, so a returned index is
 * the *first frame of the new shot*. That is the frame a split has to land on: a split at the last
 * frame of the old shot would leave one frame of the old take at the head of the new clip.
 *
 * Sorted, never repeated, and never within `minGap` of the previous one.
 */
export function sceneCuts(
  distances: readonly number[],
  options: SceneOptions = SCENE_DEFAULTS,
): number[] {
  const threshold = Math.max(0, options.threshold);
  const prominence = Math.max(1, options.prominence);
  const gap = Math.max(1, Math.round(options.minGap));
  const cuts: number[] = [];
  for (const [index, distance] of distances.entries()) {
    if (distance < threshold) continue;
    if (distance < prominence * around(distances, index, gap)) continue;
    const last = cuts[cuts.length - 1];
    // The louder of two candidates inside one gap wins, rather than the earlier one: a cut through a
    // flash frame produces two candidates a frame apart, and the true join is the bigger of them.
    if (last !== undefined && index + 1 - last < gap) {
      if (distance > distances[last - 1]!) cuts[cuts.length - 1] = index + 1;
      continue;
    }
    cuts.push(index + 1);
  }
  return cuts;
}

/**
 * The ordinary amount of change around one moment, as a median rather than a mean.
 *
 * A median, because the thing being measured against is a neighbourhood that may contain another cut,
 * and one large value would drag a mean up far enough to hide the candidate. The moment itself is left
 * out — a candidate compared against a window including itself is compared against itself.
 */
function around(distances: readonly number[], index: number, reach: number): number {
  const window: number[] = [];
  for (let at = index - reach; at <= index + reach; at += 1) {
    if (at === index || at < 0 || at >= distances.length) continue;
    window.push(distances[at]!);
  }
  if (window.length === 0) return 0;
  window.sort((a, b) => a - b);
  const middle = Math.floor(window.length / 2);
  return window.length % 2 === 0
    ? (window[middle - 1]! + window[middle]!) / 2
    : window[middle]!;
}
