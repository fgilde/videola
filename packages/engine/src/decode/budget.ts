import { DEFAULT_FRAME_BUDGET_BYTES } from "./frame-cache";

// The numbers the preview is held to. They are here rather than in a paragraph somewhere because
// a performance claim nobody can fail is not a claim: every one of these is asserted against a
// measurement in `packages/engine/browser` (the export harness), on real decoded frames.

const BYTES_PER_PIXEL = 4;

/**
 * How many decoded frames of this size the cache can hold at once.
 *
 * This is the whole argument for proxies in one function. A `VideoFrame` costs width × height × 4
 * bytes whatever the file it came from was compressed to, so the budget buys nine times as many
 * frames at 720p as at 4K -- and a cache that holds a handful of frames evicts the frame the
 * playhead is about to step back onto, every time.
 */
export function framesWithin(
  width: number,
  height: number,
  budgetBytes: number = DEFAULT_FRAME_BUDGET_BYTES,
): number {
  const perFrame = width * height * BYTES_PER_PIXEL;
  return perFrame <= 0 ? 0 : Math.floor(budgetBytes / perFrame);
}

/**
 * The fewest frames the cache has to hold for a scrub to stay in the cache rather than in the
 * decoder. Below this, stepping back one frame decodes from the previous key packet again.
 *
 * One second at 24 fps: the length of a scrub gesture that has not yet let go.
 */
export const MIN_CACHED_FRAMES = 24;

/**
 * A frame the playhead has already landed near must arrive within this. It is the frame budget of
 * a 25 Hz preview -- not a promise of 25 Hz playback, which the encoder and the machine decide,
 * but the point past which a scrub stops tracking the pointer.
 */
export const FRAME_BUDGET_MS = 40;

/**
 * A step backwards, which always restarts the decoder at the preceding key packet and decodes
 * forward from there. Generous next to `FRAME_BUDGET_MS` because it is a whole group of pictures,
 * and still the number that decides whether a J-K-L crawl is usable.
 */
export const SEEK_BUDGET_MS = 400;
