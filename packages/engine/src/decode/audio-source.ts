import { timeToSeconds } from "@videola/core";
import { mediaBlob } from "@videola/media";
import { AudioBufferSink } from "mediabunny";

import type { Time } from "@videola/core";

import { openInput } from "./demuxer";

// ponytail: one Input and one decoder per call, and the whole range materialised as float
// samples. That is right for what asks for it -- a clip's audio ahead of playback, a waveform,
// an export pass -- and wrong for a range measured in minutes, where an hour of stereo is 1.4 GB.
// The way out is the same as for video: keep the Input open and hand back buffers as they decode.
export class AudioSource {
  async bufferFor(hash: string, from: Time, to: Time): Promise<AudioBuffer> {
    const blob = await mediaBlob(hash);
    if (blob === undefined) throw new Error("error.mediaMissing");
    const input = openInput(blob);
    try {
      const track = await input.getPrimaryAudioTrack();
      if (track === null) throw new Error("error.mediaNoAudioTrack");
      return await collect(new AudioBufferSink(track), track.sampleRate, track.numberOfChannels, {
        from: timeToSeconds(from),
        to: timeToSeconds(to),
      });
    } finally {
      input.dispose();
    }
  }
}

interface Range {
  from: number;
  to: number;
}

async function collect(
  sink: AudioBufferSink,
  sampleRate: number,
  channels: number,
  range: Range,
): Promise<AudioBuffer> {
  const buffer = new AudioBuffer({
    length: Math.max(1, Math.round((range.to - range.from) * sampleRate)),
    sampleRate,
    numberOfChannels: channels,
  });
  // Assembled channel by channel and written back once. Reading the target through
  // copyFromChannel per chunk would copy the whole range for every decoded packet.
  const planes = Array.from({ length: channels }, () => new Float32Array(buffer.length));
  for await (const wrapped of sink.buffers(range.from, range.to)) {
    // A decoded packet begins at a packet boundary, which is nowhere near the requested start:
    // the offset is where this chunk lands in the range, and for the first one it is negative.
    const offset = Math.round((wrapped.timestamp - range.from) * sampleRate);
    const shared = Math.min(channels, wrapped.buffer.numberOfChannels);
    for (let channel = 0; channel < shared; channel += 1) {
      blit(planes[channel]!, channelData(wrapped.buffer, channel), offset);
    }
  }
  planes.forEach((plane, channel) => buffer.copyToChannel(plane, channel));
  return buffer;
}

export function blit(target: Float32Array, source: Float32Array, offset: number): void {
  const head = Math.max(0, -offset);
  const length = Math.min(source.length - head, target.length - offset - head);
  if (length <= 0) return;
  target.set(source.subarray(head, head + length), offset + head);
}

function channelData(buffer: AudioBuffer, channel: number): Float32Array {
  const data = new Float32Array(buffer.length);
  buffer.copyFromChannel(data, channel);
  return data;
}
