import type { Peaks } from "@videola/media";

// The strip is drawn in its own coordinates -- one unit per bucket across, two units tall with
// silence on the centre line -- and stretched to the clip by `preserveAspectRatio="none"`. So the
// path survives every zoom step and every resize without being rebuilt, which is the whole reason
// it is a path and not a canvas: there is no width in it to go stale.
export const WAVEFORM_HEIGHT = 2;

// A passage of digital silence has no height at all, and a strip with a hole in it reads as missing
// data rather than as a quiet part. Half a percent of the box is a hairline that stays on screen.
const HAIRLINE = 0.01;

export function waveformPath(peaks: Peaks): string {
  const buckets = Math.min(peaks.max.length, peaks.min.length);
  if (buckets === 0) return "";
  const top: string[] = [];
  const bottom: string[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    // Sanitised before the hairline is applied, not after: `Math.max(NaN, HAIRLINE)` is NaN, and
    // the floor would be lost on exactly the samples that need a fallback most.
    const high = Math.max(clamp(peaks.max[bucket]), HAIRLINE);
    const low = Math.min(clamp(peaks.min[bucket]), -HAIRLINE);
    top.push(`${bucket} ${round(1 - high)}`);
    bottom.push(`${bucket} ${round(1 - low)}`);
  }
  // Down the peaks and back along the troughs: one closed shape, filled, so no stroke width has to
  // survive the non-uniform stretch.
  return `M${top.join("L")}L${bottom.reverse().join("L")}Z`;
}

// A project file may carry samples past full scale, and a shape drawn outside the box is clipped by
// the viewBox into a flat edge that looks like clipping the user did not ask about.
function clamp(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
