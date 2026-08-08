export interface Peaks {
  readonly min: Float32Array;
  readonly max: Float32Array;
}

// Two extremes per bucket, not an average: an average turns a snare hit into a bump and a strip of
// speech into a grey band. The bucket count is a pixel width, so the boundaries are derived from it
// rather than from an integer stride -- a stride of `frames / buckets` rounded down hands back more
// buckets than were asked for, and the surplus is drawn past the end of the strip.
//
// Ported from Audiola's `AudioEdits.ComputePeaks`, with the bucket boundaries fixed to the caller's
// count and the mixdown generalised past stereo.
export function peaks(channels: readonly Float32Array[], buckets: number): Peaks {
  const min = new Float32Array(Math.max(0, buckets));
  const max = new Float32Array(Math.max(0, buckets));
  const frames = channels[0]?.length ?? 0;
  if (frames === 0 || min.length === 0) return { min, max };

  const scale = 1 / channels.length;
  for (let bucket = 0; bucket < min.length; bucket += 1) {
    // Half-open, and at least one sample wide: zoomed in past one sample per pixel, neighbouring
    // buckets read the same sample rather than leaving a gap in the middle of the strip.
    const from = Math.floor((bucket * frames) / min.length);
    const to = Math.max(from + 1, Math.floor(((bucket + 1) * frames) / min.length));
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let frame = from; frame < to; frame += 1) {
      let mono = 0;
      for (const plane of channels) mono += plane[frame] ?? 0;
      mono *= scale;
      if (mono < low) low = mono;
      if (mono > high) high = mono;
    }
    min[bucket] = low;
    max[bucket] = high;
  }
  return { min, max };
}
