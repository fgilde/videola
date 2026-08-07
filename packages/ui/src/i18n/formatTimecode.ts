import type { Rate } from "@videola/core/src/generated/Rate";

// ponytail: non-drop-frame timecode - the frame field counts 0..nominal-1 even for
// NTSC-derived rates (29.97, 23.976, 59.94), so it drifts from wall-clock time over a
// long timeline. That is what every editor shows until you explicitly ask for
// drop-frame; add SMPTE drop-frame compensation if that need shows up.
export function formatTimecode(seconds: number, fps: Rate): string {
  const nominal = Math.round(fps.numerator / fps.denominator);
  const sign = seconds < 0 ? "-" : "";
  const totalFrames = Math.round((Math.abs(seconds) * fps.numerator) / fps.denominator);
  const frames = totalFrames % nominal;
  const totalSeconds = Math.floor(totalFrames / nominal);
  const secondsPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const frameWidth = Math.max(2, String(nominal - 1).length);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(secondsPart)}.${pad(frames, frameWidth)}`;
}
