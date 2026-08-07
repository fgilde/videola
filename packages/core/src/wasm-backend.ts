import init, { WasmDocument } from "./wasm/videola_core.js";

import type { DocumentBackend, ImportMediaResult, MediaBytes, SaveOptions } from "./backend";
import type { Dispatch, DispatchResult, LoadWarning, MediaKind, Project } from "./generated";

let ready: Promise<unknown> | undefined;

async function ensureReady(): Promise<void> {
  ready ??= init();
  try {
    await ready;
  } catch (error) {
    ready = undefined;
    throw error;
  }
}

export async function createWasmBackend(bytes?: Uint8Array): Promise<DocumentBackend> {
  await ensureReady();
  const handle = bytes === undefined ? new WasmDocument() : WasmDocument.open(bytes);
  return {
    state: () => handle.state() as Project,
    dispatch: (dispatch: Dispatch) => handle.dispatch(dispatch) as DispatchResult,
    undo: () => handle.undo() as DispatchResult,
    redo: () => handle.redo() as DispatchResult,
    // The glue's own .d.ts under-types this as plain Uint8Array, but the JS it generates
    // (getArrayU8FromWasm0(...).slice()) always allocates a fresh ArrayBuffer-backed copy -
    // never a view into wasm memory, never a SharedArrayBuffer - so this cast just corrects
    // the declared type to what the implementation already guarantees.
    save: (options: SaveOptions, media: MediaBytes) =>
      handle.save(options, media) as Uint8Array<ArrayBuffer>,
    importMedia: (name: string, mime: string, kind: MediaKind, media: Uint8Array) =>
      handle.importMedia(name, mime, kind, media) as ImportMediaResult,
    warnings: () => handle.warnings() as LoadWarning[],
  };
}
