import { mediaBlob, putProxy } from "@videola/media";
import { BufferTarget, Conversion, Mp4OutputFormat, Output, Quality } from "mediabunny";

import { openInput } from "../decode/demuxer";

/**
 * The tallest a proxy is made. Everything about this number is about how many decoded frames the
 * cache holds: a 4K frame is 33 MB in memory and a 720p one is 3.7 MB, so the same budget keeps
 * nine times as many of the latter (`framesWithin`). 720p is also the point past which a preview
 * on a laptop is being downscaled for the screen anyway, so the detail thrown away here is detail
 * nobody was shown.
 *
 * Material at or below this height gets no proxy at all: the encode would cost minutes to buy a
 * factor of one.
 */
export const PROXY_MAX_HEIGHT = 720;

/**
 * How often the proxy carries a key frame, in seconds.
 *
 * This is the half of the win that has nothing to do with resolution. `VideoSource` restarts at
 * the key packet at or before the instant asked for, so a long group of pictures -- 250 frames is
 * unremarkable in phone video and screen capture -- means one step backwards decodes 250 frames.
 * At one second the worst case is a frame rate's worth, whatever the camera did.
 */
export const PROXY_KEYFRAME_SECONDS = 1;

/**
 * Chosen to be cheap to *decode*, which is the opposite of what an export chooses. H.264 is the
 * one codec with hardware decoding on every machine that runs a browser; the bitrate is low
 * because a preview is looked at, not graded. A machine that cannot encode it gets no proxy and
 * loses nothing but the speed.
 */
export const PROXY_BITRATE = 2_000_000;

export interface ProxyBuilt {
  height: number;
  bytes: number;
}

/**
 * Makes the proxy for one medium and stores it under that medium's hash.
 *
 * Resolves to `undefined` where a proxy is not worth making or cannot be made -- material already
 * small enough, no video track, a machine with no H.264 encoder. None of those is an error: the
 * preview then decodes the original, which is what it did before there were proxies at all.
 *
 * The frame rate and the duration are deliberately not touched. A proxy with its own timebase
 * would put the preview on a different ruler from the timeline, and every source time the core
 * hands out would land on the wrong picture.
 */
export async function buildProxy(
  hash: string,
  maxHeight: number = PROXY_MAX_HEIGHT,
): Promise<ProxyBuilt | undefined> {
  const original = await mediaBlob(hash);
  if (original === undefined) throw new Error("error.mediaMissing");
  const input = openInput(original);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (track === null) return undefined;
    const height = await track.getCodedHeight();
    if (height <= maxHeight) return undefined;
    const target = new BufferTarget();
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new Mp4OutputFormat(), target }),
      video: {
        // Only the height is given: mediabunny derives the width from the display aspect ratio and
        // rounds it to something the encoder accepts. Naming both would need a `fit`, and every
        // value of `fit` is a way to get the aspect ratio wrong.
        height: maxHeight,
        codec: "avc",
        quality: new Quality({ bitrate: PROXY_BITRATE }),
        keyFrameInterval: PROXY_KEYFRAME_SECONDS,
        forceTranscode: true,
      },
      // The sound always comes from the original: `AudioSource` reads the medium itself, decoding
      // audio was never the expensive part, and a proxy without it is smaller and quicker to make.
      audio: { discard: true },
      showWarnings: false,
    });
    if (!conversion.isValid) return undefined;
    await conversion.execute();
    const bytes = target.buffer;
    if (bytes === null) return undefined;
    await putProxy(hash, new Uint8Array(bytes));
    return { height: maxHeight, bytes: bytes.byteLength };
  } finally {
    input.dispose();
  }
}
