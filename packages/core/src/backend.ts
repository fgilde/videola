import type {
  Dispatch,
  DispatchResult,
  LoadWarning,
  MediaKind,
  ParamValue,
  Project,
  Time,
} from "./generated";

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

// Every effect on every clip the moment touches, keyed by effect id, with the value of every
// parameter it can answer for — interpolated where keyframes exist. Batched for the same reason
// as `SourceTimes`, and carrying the same rule: the interpolation stays in the core, so the
// preview and the export cannot arrive at different numbers for the same frame.
export type EffectParamSnapshot = ReadonlyMap<string, ReadonlyMap<string, ParamValue>>;
export type EffectParams = (at: Time) => EffectParamSnapshot;

export interface DocumentBackend {
  state(): Project;
  sourceTimesAt(at: Time): ReadonlyMap<string, Time>;
  effectParamsAt(at: Time): EffectParamSnapshot;
  dispatch(dispatch: Dispatch): DispatchResult;
  undo(): DispatchResult;
  redo(): DispatchResult;
  // Undo that also drops the reverted step from the redo stack. A caller applying several
  // commands as one atomic unit needs this: a plain undo would leave the half of a rejected
  // batch that did land sitting on redo, one keystroke away from being reapplied.
  rollback(): void;
  save(options: SaveOptions, media: MediaBytes): Uint8Array<ArrayBuffer>;
  // A `.videolat` of this project: every medium it uses becomes a slot and the bytes stay behind,
  // so unlike `save` there is nothing for the caller to gather first.
  saveAsTemplate(options: SaveOptions, id: string): Uint8Array<ArrayBuffer>;
  importMedia(name: string, mime: string, kind: MediaKind, bytes: Uint8Array): ImportMediaResult;
  warnings(): LoadWarning[];
}
