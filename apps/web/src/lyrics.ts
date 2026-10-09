import { AudioSource } from "@videola/engine";
import {
  heldTranscript,
  keepTranscript,
  lyricsInFile,
  mediaBlob,
  mediaHash,
  parseLrc,
  parseLyricText,
  sungText,
  wavFile,
  windowsOf,
  type HeldTranscript,
  type TranscriptStore,
} from "@videola/media";

import type { ListenOptions, WhisperSize } from "@videola/ui";

import type { HearingNews, HearingRequest } from "./hearing.worker";
import { call, type Connection } from "./publishing";

import type { MediaAsset, MediaId } from "@videola/core";

/**
 * Where the words of a song come from, in the order they are worth trying.
 *
 * The file first, because most music carries them and reading a tag costs nothing. Then whatever
 * somebody pasted. Only then listening: Whisper in this browser, or whatever the server offers --
 * ElevenLabs being the one thing in this editor that leaves the machine, and the menu says so.
 */
export interface FoundLines {
  lines: { at: number; until?: number; text: string }[];
  timed: boolean;
  from: string;
}

/** The lyrics inside a medium's own file, or nothing where it carries none. */
export async function lyricsForMedia(media: MediaId): Promise<FoundLines | undefined> {
  const hash = mediaHash(media);
  if (hash === undefined) return undefined;
  const file = await mediaBlob(hash);
  if (file === undefined) return undefined;
  // The tag is at the front of the file and the whole song is behind it. Reading the first two
  // megabytes is a tag with room to spare and not a hundred megabytes of audio through a decoder.
  const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
  const found = lyricsInFile(head) ?? lyricsInFile(new Uint8Array(await file.arrayBuffer()));
  if (found === undefined) return undefined;
  return { lines: [...found.lines], timed: found.timed, from: found.from };
}

/** What somebody pasted: an `.lrc` if it looks like one, plain lines if it does not. */
export function lyricsFromText(text: string): FoundLines | undefined {
  const asLrc = parseLrc(text);
  if (asLrc.lines.length > 0) {
    return { lines: [...asLrc.lines], timed: true, from: "lrc" };
  }
  const plain = parseLyricText(text);
  if (plain.lines.length === 0) return undefined;
  return { lines: [...plain.lines], timed: false, from: "text" };
}

/**
 * Which transcribers this editor has.
 *
 * Whisper in the browser always. Beside it whatever the server behind the editor offers: a
 * transcriber on that machine, or a key for ElevenLabs -- and the second one sends the song to a
 * company, which the menu has to say.
 */
export async function transcribers(connection: Connection): Promise<Engine[]> {
  try {
    const answer = await call(connection, "/api/lyrics/ready");
    const body = (await answer.json()) as { engines?: string[] };
    const offered = (body.engines ?? []).filter((engine): engine is Engine => engine === "server" || engine === "cloud");
    return ["local", ...offered];
  } catch {
    return ["local"];
  }
}

export type Engine = TranscriptStore;

export type { ListenOptions, WhisperSize };

export type Hearing =
  | { phase: "decoding" }
  | { phase: "loading"; fraction: number | undefined }
  | { phase: "listening"; fraction: number }
  | { phase: "sending" };

/**
 * The three sizes the dialogue offers, and how each is kept. Four-bit weights wherever they hold up:
 * they are what makes the largest one a download rather than an afternoon. Base keeps its encoder
 * whole because a model that small has nothing left to give.
 */
const WHISPER: Record<WhisperSize, { id: string; dtype: Record<string, string> }> = {
  base: { id: "onnx-community/whisper-base", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } },
  small: { id: "onnx-community/whisper-small", dtype: { encoder_model: "q4", decoder_model_merged: "q4" } },
  turbo: {
    id: "onnx-community/whisper-large-v3-turbo",
    dtype: { encoder_model: "q4", decoder_model_merged: "q4" },
  },
};
const RATE = 16000;

/**
 * The words of a song or a video, heard rather than read.
 *
 * Kept per medium and transcriber, so asking again costs nothing, and a local run that was stopped
 * carries on where it stopped. Everything is sent as 16 kHz mono, which is what Whisper and
 * ElevenLabs listen to anyway -- and a tenth of a video file.
 */
export async function transcribeMedia(
  connection: Connection,
  asset: MediaAsset,
  engine: Engine,
  listen: ListenOptions,
  onHearing: (hearing: Hearing) => void,
  signal: AbortSignal,
): Promise<FoundLines> {
  const hash = mediaHash(asset.id);
  if (hash === undefined) throw new Error("error.noSuchMedia");
  const whisper = WHISPER[listen.size];
  // What was heard depends on who listened and in which language they were told to.
  const model = `${engine === "local" ? whisper.id : engine}|${listen.language}`;
  const held = (await heldTranscript(hash, engine, model)) ?? { model, until: 0, done: false, lines: [] };
  if (!held.done) {
    onHearing({ phase: "decoding" });
    const samples = await songSamples(hash, asset);
    signal.throwIfAborted();
    if (engine === "local") {
      const request = { model: whisper.id, dtype: whisper.dtype, language: listen.language };
      await hearHere(samples, held, request, signal, onHearing, () => keepTranscript(hash, engine, held));
    } else {
      onHearing({ phase: "sending" });
      held.lines = await hearThere(connection, engine, listen.language, samples, signal);
      held.done = true;
    }
    await keepTranscript(hash, engine, held);
  }
  return { lines: held.lines, timed: held.lines.some((line) => line.until > line.at), from: "transcript" };
}

async function songSamples(hash: string, asset: MediaAsset): Promise<Float32Array> {
  const song = await new AudioSource().bufferFor(hash, 0, asset.duration ?? 0);
  const length = Math.max(1, Math.ceil(song.duration * RATE));
  const context = new OfflineAudioContext(1, length, RATE);
  const source = context.createBufferSource();
  source.buffer = song;
  source.connect(context.destination);
  source.start();
  return (await context.startRendering()).getChannelData(0);
}

function hearHere(
  samples: Float32Array,
  held: HeldTranscript,
  request: Pick<HearingRequest, "model" | "dtype" | "language">,
  signal: AbortSignal,
  onHearing: (hearing: Hearing) => void,
  keep: () => Promise<void>,
): Promise<void> {
  const windows = windowsOf(samples, RATE, held.until);
  if (windows.length === 0) {
    held.done = true;
    return Promise.resolve();
  }
  const worker = new Worker(new URL("./hearing.worker.ts", import.meta.url), { type: "module" });
  let saving = Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const stop = (error: unknown): void => {
      worker.terminate();
      reject(error);
    };
    signal.addEventListener("abort", () => stop(signal.reason), { once: true });
    worker.onerror = (event) => stop(new Error(event.message));
    worker.onmessage = (event: MessageEvent<HearingNews>) => {
      const news = event.data;
      if (news.kind === "failed") stop(new Error(news.message));
      if (news.kind === "loading") {
        onHearing({ phase: "loading", fraction: news.total > 0 ? news.loaded / news.total : undefined });
      }
      if (news.kind !== "heard") return;
      for (const line of news.lines) {
        const text = sungText(line.text);
        if (text !== undefined) held.lines.push({ ...line, text });
      }
      held.until = windows[news.index]!.end / RATE;
      held.done = news.index === windows.length - 1;
      onHearing({ phase: "listening", fraction: held.until / (samples.length / RATE) });
      // One write after the other: two writes to the same file at once are one write too many.
      saving = saving.then(keep).then(() => {
        if (!held.done) return;
        worker.terminate();
        resolve();
      }, stop);
    };
    onHearing({ phase: "loading", fraction: undefined });
    worker.postMessage({ ...request, rate: RATE, audio: samples, windows } satisfies HearingRequest);
  });
}

async function hearThere(
  connection: Connection,
  engine: Engine,
  language: string,
  samples: Float32Array,
  signal: AbortSignal,
): Promise<HeldTranscript["lines"]> {
  const query = new URLSearchParams({ engine, language });
  const answer = await call(connection, `/api/lyrics/transcribe?${query.toString()}`, {
    method: "POST",
    headers: { "content-type": "audio/wav" },
    body: wavFile(samples, RATE),
    signal,
  });
  const body = (await answer.json()) as { lines?: HeldTranscript["lines"] };
  return body.lines ?? [];
}
