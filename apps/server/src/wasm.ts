import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createWasmBackend, type DocumentBackend } from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";

let primed = false;

// The server runs the very same wasm32 artifact the browser loads, not a second native build of
// the core. That is what makes the two hosts enforce byte-identical rules: the reader's entry and
// media caps are sized against wasm32's 32-bit `usize` (see format/reader.rs), and a native build
// would reason about a different address space for the same numbers.
//
// `createWasmBackend` starts the module with `init()`, which fetches the .wasm relative to the
// glue's own URL. Node's fetch cannot read `file://`, and a bundled server has no such URL to
// resolve against either, so the module is primed from disk first and that later `init()`
// short-circuits on its own already-initialised guard.
function prime(): void {
  if (primed) return;
  initSync({ module: readFileSync(wasmPath()) });
  primed = true;
}

export function wasmPath(): string {
  const configured = process.env.VIDEOLA_WASM;
  if (configured !== undefined && configured !== "") return configured;
  return createRequire(import.meta.url).resolve("@videola/core/src/wasm/videola_core_bg.wasm");
}

export async function openBackend(archive?: Uint8Array): Promise<DocumentBackend> {
  prime();
  return createWasmBackend(archive);
}
