export function formatTimecode(seconds: number, fps: number): string {
  const sign = seconds < 0 ? "-" : "";
  const totalFrames = Math.round(Math.abs(seconds) * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secondsPart = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const frameWidth = Math.max(2, String(fps - 1).length);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(secondsPart)}.${pad(frames, frameWidth)}`;
}
