import { putTranscript, transcriptText, type TranscriptStore } from "./opfs";

/** One line of a transcript, in milliseconds, which is what every lyric source uses. */
export interface HeardLine {
  at: number;
  until: number;
  text: string;
}

/**
 * What a transcriber has heard of one medium so far.
 *
 * `until` is how many seconds of the song are behind it. A run that was stopped keeps what it had,
 * and the next one starts there instead of at the top of the song.
 */
export interface HeldTranscript {
  model: string;
  until: number;
  done: boolean;
  lines: HeardLine[];
}

export async function heldTranscript(
  hash: string,
  store: TranscriptStore,
  model: string,
): Promise<HeldTranscript | undefined> {
  const text = await transcriptText(hash, store).catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    const held = JSON.parse(text) as Partial<HeldTranscript>;
    // A different model hears different words; carrying on from its half would stitch two
    // transcripts together at a seam nobody can see.
    if (held.model !== model || !Array.isArray(held.lines)) return undefined;
    return {
      model,
      until: typeof held.until === "number" ? held.until : 0,
      done: held.done === true,
      lines: held.lines,
    };
  } catch {
    return undefined;
  }
}

export async function keepTranscript(
  hash: string,
  store: TranscriptStore,
  held: HeldTranscript,
): Promise<void> {
  await putTranscript(hash, store, JSON.stringify(held));
}

/** Whisper listens to thirty seconds at a time and no more. */
const LONGEST_WINDOW_S = 30;
/** The earliest a window may be cut, so the search for a quiet spot has room and windows stay long. */
const SHORTEST_WINDOW_S = 20;
const FRAME_S = 0.1;

/**
 * The song, cut into pieces a transcriber can take one at a time, in samples.
 *
 * Cut at the quietest tenth of a second between twenty and thirty seconds into each piece, which in a
 * song is a breath between two lines far more often than not -- a cut through a word loses it.
 */
export function windowsOf(
  samples: Float32Array,
  rate: number,
  fromSeconds = 0,
): { start: number; end: number }[] {
  const windows: { start: number; end: number }[] = [];
  const longest = Math.round(LONGEST_WINDOW_S * rate);
  const shortest = Math.round(SHORTEST_WINDOW_S * rate);
  const frame = Math.max(1, Math.round(FRAME_S * rate));
  let start = Math.min(samples.length, Math.max(0, Math.round(fromSeconds * rate)));
  while (start < samples.length) {
    if (samples.length - start <= longest) {
      windows.push({ start, end: samples.length });
      break;
    }
    const end = quietestFrame(samples, start + shortest, start + longest, frame);
    windows.push({ start, end });
    start = end;
  }
  return windows;
}

function quietestFrame(samples: Float32Array, from: number, to: number, frame: number): number {
  let best = to;
  let lowest = Number.POSITIVE_INFINITY;
  for (let at = from; at + frame <= to; at += frame) {
    let energy = 0;
    for (let i = at; i < at + frame; i += 1) energy += samples[i]! * samples[i]!;
    if (energy < lowest) {
      lowest = energy;
      best = at + Math.floor(frame / 2);
    }
  }
  return best;
}

/**
 * The words of a line, or nothing where there are none.
 *
 * Whisper fills an instrumental with what it has heard most in its training: notes, a bracketed
 * "[Music]", or thanks for watching. None of that is a lyric.
 */
export function sungText(text: string): string | undefined {
  const words = text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
    .replace(/[♪♫♬♩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\p{L}/u.test(words)) return undefined;
  if (/^(thanks?|thank you) (so much )?for watching[.!]*$/i.test(words)) return undefined;
  return words;
}

/** Mono samples as a 16-bit WAV file, which every transcription service takes. */
export function wavFile(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(clamped * 0x7fff), true);
  }
  return bytes;
}
