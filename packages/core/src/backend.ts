import type { Dispatch, DispatchResult, LoadWarning, MediaKind, Project } from "./generated";

export interface SaveOptions {
  appVersion: string;
  created: string;
  modified: string;
  locale: string;
}

export interface ImportMediaResult {
  id: string;
  result: DispatchResult;
}

export interface DocumentBackend {
  state(): Project;
  dispatch(dispatch: Dispatch): DispatchResult;
  undo(): DispatchResult;
  redo(): DispatchResult;
  save(options: SaveOptions): Uint8Array<ArrayBuffer>;
  importMedia(name: string, mime: string, kind: MediaKind, bytes: Uint8Array): ImportMediaResult;
  warnings(): LoadWarning[];
}
