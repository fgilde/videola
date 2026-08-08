import { canEncodeAudio, canEncodeVideo } from "mediabunny";

import type { AudioCodec, VideoCodec } from "mediabunny";

export type ContainerId = "mp4" | "webm";

export interface ExportFormat {
  id: ContainerId;
  video: VideoCodec;
  audio: AudioCodec;
  mimeType: string;
  extension: string;
}

// H.264 in MP4 first, because it is the one combination a phone, a television and every editor
// plays back. VP9 in WebM is a substitute, not a preference: Chromium encodes H.264, Firefox and
// Safari often do not, and a menu entry that cannot encode is worse than naming the substitute.
export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: "mp4", video: "avc", audio: "aac", mimeType: "video/mp4", extension: "mp4" },
  { id: "webm", video: "vp9", audio: "opus", mimeType: "video/webm", extension: "webm" },
];

export interface ExportTarget {
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
}

export interface FormatSupport {
  format: ExportFormat;
  video: boolean;
  audio: boolean;
}

export interface EncodeProbe {
  video(codec: VideoCodec, size: { width: number; height: number }): Promise<boolean>;
  audio(
    codec: AudioCodec,
    format: { sampleRate: number; numberOfChannels: number },
  ): Promise<boolean>;
}

// Both of these end in `VideoEncoder.isConfigSupported` and `AudioEncoder.isConfigSupported`, plus
// a real trial encode where the browser's answer is known to be unreliable. Asking the encoder is
// the only honest way to fill this menu; a table of what browsers are said to support is out of
// date on the day it is written.
const BROWSER_PROBE: EncodeProbe = {
  video: (codec, size) => canEncodeVideo(codec, size),
  audio: (codec, format) => canEncodeAudio(codec, format),
};

// Probed at the size and sample format the export will actually use. A 4K H.264 encode can be
// refused on a machine that encodes 1080p happily, so a menu built from a probe at some nominal
// resolution promises what the run then cannot deliver.
export async function formatSupport(
  target: ExportTarget,
  probe: EncodeProbe = BROWSER_PROBE,
): Promise<FormatSupport[]> {
  return Promise.all(
    EXPORT_FORMATS.map(async (format) => ({
      format,
      video: await attempt(() => probe.video(format.video, target)),
      audio: await attempt(() =>
        probe.audio(format.audio, {
          sampleRate: target.sampleRate,
          numberOfChannels: target.channels,
        }),
      ),
    })),
  );
}

// A probe that throws has answered the only question asked of it: this configuration is not one
// the machine encodes. Letting it reject would take the whole menu down with one bad codec string.
async function attempt(probe: () => Promise<boolean>): Promise<boolean> {
  try {
    return await probe();
  } catch (error) {
    console.error(error);
    return false;
  }
}
