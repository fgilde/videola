import { env, pipeline } from "@huggingface/transformers";
import ortFactory from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortBinary from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

import type { HeardLine } from "@videola/media";

/**
 * Whisper, in a worker of this page.
 *
 * The one transcriber that is always there: no key, no server, no Python. The model comes from
 * Hugging Face the first time and out of the browser's cache after that; the runtime ships with
 * the editor, so the desktop app's content policy needs to allow one host and not two.
 */
export interface HearingRequest {
  model: string;
  /** Per file, because a model is only as small as the format its weights are kept in. */
  dtype: Record<string, string>;
  /** Said rather than guessed: left to itself, Whisper takes most songs for English and translates. */
  language: string;
  rate: number;
  audio: Float32Array;
  windows: readonly { start: number; end: number }[];
}

export type HearingNews =
  | { kind: "loading"; loaded: number; total: number }
  | { kind: "heard"; index: number; lines: HeardLine[] }
  | { kind: "failed"; message: string };

env.allowLocalModels = false;
// The runtime is imported from this bundle by URL; a cached copy would be a blob URL, and the
// desktop app does not run scripts from those.
env.useWasmCache = false;
if (env.backends.onnx.wasm !== undefined) {
  env.backends.onnx.wasm.wasmPaths = { mjs: ortFactory, wasm: ortBinary };
}

type Recognizer = (
  audio: Float32Array,
  options: { return_timestamps: true; language: string; task: "transcribe" },
) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

const tell = (news: HearingNews): void => postMessage(news);

self.onmessage = (event: MessageEvent<HearingRequest>) => {
  hear(event.data).catch((error: unknown) =>
    tell({ kind: "failed", message: String((error as Error).message ?? error) }),
  );
};

async function hear(request: HearingRequest): Promise<void> {
  const recognize = await recognizer(request.model, request.dtype);
  for (const [index, window] of request.windows.entries()) {
    const heard = await recognize(request.audio.subarray(window.start, window.end), {
      return_timestamps: true,
      language: request.language,
      task: "transcribe",
    });
    tell({ kind: "heard", index, lines: linesOf(heard, window, request.rate) });
  }
}

async function recognizer(model: string, dtype: Record<string, string>): Promise<Recognizer> {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (info.status !== "progress" || info.file === undefined) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    tell({ kind: "loading", loaded, total });
  };
  // A graphics card does in seconds what the processor does in a minute, where there is one to ask.
  if (await hasGpu()) {
    try {
      return (await pipeline("automatic-speech-recognition", model, {
        device: "webgpu",
        dtype: dtype as never,
        progress_callback,
      })) as unknown as Recognizer;
    } catch {
      files.clear();
    }
  }
  return (await pipeline("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: dtype as never,
    progress_callback,
  })) as unknown as Recognizer;
}

async function hasGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) return false;
  return (await gpu.requestAdapter().catch(() => null)) != null;
}

function linesOf(
  heard: Awaited<ReturnType<Recognizer>>,
  window: { start: number; end: number },
  rate: number,
): HeardLine[] {
  const offset = window.start / rate;
  const end = window.end / rate;
  const chunks = heard.chunks ?? [{ text: heard.text, timestamp: [0, null] as [number, null] }];
  const lines: HeardLine[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (text === "") continue;
    const from = offset + chunk.timestamp[0];
    const until = Math.min(end, chunk.timestamp[1] === null ? end : offset + chunk.timestamp[1]);
    lines.push({ at: Math.round(from * 1000), until: Math.round(Math.max(from, until) * 1000), text });
  }
  return lines;
}
