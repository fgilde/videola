import init, { WasmDocument } from "./wasm/videola_core.js";

import type { DocumentBackend, SaveOptions } from "./backend";
import type { Dispatch, DispatchResult, LoadWarning, MediaKind, Project } from "./generated";

let ready: Promise<unknown> | undefined;

async function ensureReady(): Promise<void> {
  ready ??= init();
  await ready;
}

export async function createWasmBackend(bytes?: Uint8Array): Promise<DocumentBackend> {
  await ensureReady();
  const document = bytes === undefined ? new WasmDocument() : WasmDocument.open(bytes);
  return {
    state: () => document.state() as Project,
    dispatch: (dispatch: Dispatch) => document.dispatch(dispatch) as DispatchResult,
    undo: () => document.undo() as DispatchResult,
    redo: () => document.redo() as DispatchResult,
    save: (options: SaveOptions) => document.save(options),
    importMedia: (name: string, mime: string, kind: MediaKind, media: Uint8Array) =>
      document.importMedia(name, mime, kind, media),
    warnings: () => document.warnings() as LoadWarning[],
  };
}
