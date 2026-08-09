import { EffectPreview, effectManifests, referencePicture } from "@videola/engine";

// Big enough that a wipe's edge and a vignette's falloff are both readable, small enough that the
// whole grid together is a fraction of one frame of the picture it was taken from.
export const TILE_WIDTH = 192;
export const TILE_HEIGHT = 108;

/**
 * A picture per effect, each one the effect's own shader over the frame the editor is showing.
 *
 * The decision this file is: **one source frame, every tile drawn from it.** Not one decode per
 * tile -- twenty decodes to fill one dialog is what makes a library feel broken -- and not a still
 * kept beside each effect either, because a picture that is not this project's frame is a promise
 * about somebody else's footage. The preview canvas already holds the composited frame at the
 * playhead and is created readable, so the source costs one `drawImage` into a 192x108 scratch and
 * no decoder at all. What is left is fifteen passes of 20 736 fragments -- together a seventh of a
 * single 1080p frame, which is why nothing here is loaded lazily or cached between openings: the
 * work is smaller than the gesture that asks for it.
 *
 * Where the timeline has no picture to give -- an empty project, or a playhead in a gap -- the
 * tiles fall back to a generated reference frame rather than to nothing. It is still the effect's
 * own output; only the material is ours.
 *
 * The caller owns the URLs and has to revoke them.
 */
export async function effectTiles(
  frame: HTMLCanvasElement | null,
): Promise<ReadonlyMap<string, string>> {
  const source = sourceFrame(frame);
  // The picture a transition is coming *from*. A transition mixed with its own incoming frame is
  // the frame, and the tile would show a dissolve that dissolves into nothing.
  const outgoing = referencePicture(TILE_WIDTH, TILE_HEIGHT, 180);
  const preview = new EffectPreview(TILE_WIDTH, TILE_HEIGHT);
  const tiles = new Map<string, string>();
  try {
    for (const manifest of effectManifests()) {
      preview.render(manifest, source, outgoing);
      tiles.set(manifest.id, URL.createObjectURL(await preview.toBlob()));
    }
  } finally {
    preview.dispose();
  }
  return tiles;
}

/**
 * The editor's own frame, scaled down once for every tile to share -- or the reference picture when
 * there is nothing on screen. "Nothing" is decided by looking: a canvas that has never been drawn
 * into and one showing a gap in the timeline are both fully transparent, and a grid of fifteen
 * transparent tiles says nothing about fifteen effects.
 */
function sourceFrame(frame: HTMLCanvasElement | null): OffscreenCanvas {
  if (frame === null || frame.width === 0 || frame.height === 0) {
    return referencePicture(TILE_WIDTH, TILE_HEIGHT);
  }
  const scratch = new OffscreenCanvas(TILE_WIDTH, TILE_HEIGHT);
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (context === null) return referencePicture(TILE_WIDTH, TILE_HEIGHT);
  context.drawImage(frame, 0, 0, TILE_WIDTH, TILE_HEIGHT);
  const pixels = context.getImageData(0, 0, TILE_WIDTH, TILE_HEIGHT).data;
  for (let at = 3; at < pixels.length; at += 4) {
    if (pixels[at] !== 0) return scratch;
  }
  return referencePicture(TILE_WIDTH, TILE_HEIGHT);
}

/** Every object URL a grid handed out. Left alone, one open of the shelf leaks fifteen blobs. */
export function revokeTiles(tiles: ReadonlyMap<string, string>): void {
  for (const url of tiles.values()) URL.revokeObjectURL(url);
}
