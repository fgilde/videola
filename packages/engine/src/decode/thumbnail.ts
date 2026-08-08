import { VideoSampleSink } from "mediabunny";

import { openInput } from "./demuxer";

export const THUMBNAIL_WIDTH = 160;
export const THUMBNAIL_HEIGHT = 90;

// A tenth of the way in, and never more than a second. The first frame of real material is a fade
// from black about as often as it is a picture, and a black tile is the grey rectangle this was
// built to avoid.
//
// ponytail: a fixed offset, not a search for a frame worth showing. A shot that is still dark a
// second in still gives a dark tile. The upgrade is sampling two or three candidates and keeping
// the one with the most spread, which costs a decode each.
export const THUMBNAIL_AT_FRACTION = 0.1;
export const THUMBNAIL_MAX_OFFSET_SECONDS = 1;

/**
 * One frame of a medium as a still image, for the library. Undefined when the medium carries no
 * video at all or the frame cannot be had -- the caller shows nothing then, because a placeholder
 * where a picture belongs is a promise the application cannot keep.
 */
export async function thumbnail(source: Blob): Promise<Blob | undefined> {
  const input = openInput(source);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (track === null) return undefined;
    const at = Math.min(
      (await track.computeDuration()) * THUMBNAIL_AT_FRACTION,
      THUMBNAIL_MAX_OFFSET_SECONDS,
    );
    const sample = await new VideoSampleSink(track).getSample(at);
    if (sample === null) return undefined;
    const canvas = new OffscreenCanvas(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    const context = canvas.getContext("2d");
    if (context === null) return undefined;
    try {
      // 'cover' rather than 'contain': the tile is a fixed 16:9 box and letterboxing a portrait
      // clip inside it would leave more background than picture.
      sample.drawWithFit(context, { fit: "cover" });
    } finally {
      sample.close();
    }
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.7 });
  } finally {
    input.dispose();
  }
}
