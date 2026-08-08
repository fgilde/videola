import type { Dispatch, DispatchResult, LoadWarning, MediaKind, Project, Time } from "./generated";

export interface SaveOptions {
  appVersion: string;
  created: string;
  modified: string;
  locale: string;
}

// Since M1 media lives in OPFS, so the caller is the only side that holds the bytes and has to
// hand them over for the write. The core still keeps whatever a `.videola` brought with it and
// falls back to that, so an untouched project saves without the caller re-reading anything.
export type MediaBytes = Map<string, Uint8Array<ArrayBuffer>>;

export interface ImportMediaResult {
  id: string;
  result: DispatchResult;
}

// Every clip the moment touches, mapped to the point in its own medium it reads from — one call
// per frame instead of one per clip, because playback asks at display rate. The times are already
// clamped to what a decoder may be handed, so a reversed clip's first frame is a real sample and
// not the exclusive end of its range.
export type SourceTimes = (at: Time) => ReadonlyMap<string, Time>;

export interface DocumentBackend {
  state(): Project;
  sourceTimesAt(at: Time): ReadonlyMap<string, Time>;
  dispatch(dispatch: Dispatch): DispatchResult;
  undo(): DispatchResult;
  redo(): DispatchResult;
  save(options: SaveOptions, media: MediaBytes): Uint8Array<ArrayBuffer>;
  importMedia(name: string, mime: string, kind: MediaKind, bytes: Uint8Array): ImportMediaResult;
  warnings(): LoadWarning[];
}
