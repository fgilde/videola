import type {
  ClipId,
  Dispatch,
  DispatchResult,
  Keyframe,
  LoadWarning,
  MediaKind,
  ParamValue,
  Project,
  Time,
  Transform,
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

// Where every clip the moment touches actually sits, with its keyframed fields already resolved.
// `clip.transform` is only the value at rest; nothing that draws may read it directly, or the
// preview and the export would each be free to interpolate their own way. Batched like the two
// above, and for the same reason.
export type TransformSnapshot = ReadonlyMap<string, Transform>;
export type Transforms = (at: Time) => TransformSnapshot;

// The shape of one keyframe segment: `samples` numbers from the left key to the right one, each the
// fraction of the way the track has travelled there. 0 at the left key, 1 at the right, and past
// either where a bezier handle overshoots.
//
// The one thing a curve editor draws, and it comes out of the core for the reason the three above
// do: a second easing written in TypeScript would be a curve that looks like one thing and animates
// like another, which is the single fault a curve tool must not have.
export type CurveShape = (
  left: Keyframe,
  right: Keyframe,
  samples: number,
) => readonly number[];

export interface DocumentBackend {
  state(): Project;
  curveShape: CurveShape;
  /** The cut as a CMX3600 edit decision list, for a conform in another system. */
  toEdl(): string;
  /** The same cut as FCPXML, which Resolve, Premiere and Final Cut all read. */
  toFcpxml(): string;
  /** The same cut as Final Cut Pro 7 XML — `xmeml`, the file Premiere Pro imports as a sequence. */
  toXmeml(): string;
  /**
   * The sounding part of this project as an `.audiola`, so it opens in Audiola. `leftOut` counts the
   * clips with no sound to hand a mixer — a title, a compound, silent material — because a placeholder
   * would be a clip the other tool cannot play.
   */
  toAudiola(media: MediaBytes): { bytes: Uint8Array; leftOut: number };
  sourceTimesAt(at: Time): ReadonlyMap<string, Time>;
  effectParamsAt(at: Time): EffectParamSnapshot;
  transformsAt(at: Time): TransformSnapshot;
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
  /**
   * This project as a `.videolat`. `marked` is the author's own choice of which clips become
   * questions -- the editor's selection. Omitted means "decide for me": every medium and every title
   * becomes one.
   *
   * What was marked is a question and its material stays with the author. What was not marked travels
   * with the template, bytes and all: an intro, a logo, a watermark are part of the recipe, and a
   * template that asked for its own intro on every use would not be a template. That is why this
   * takes the same media map a save does.
   */
  saveAsTemplate(
    options: SaveOptions,
    id: string,
    marked: readonly ClipId[] | undefined,
    /**
     * Clips whose question keeps the length the template drew it at. Everything else takes the length
     * of the material it is answered with, and the timeline around it follows -- which is what makes
     * "my intro, then my video, then my end card" a template rather than a template for one
     * particular eleven-second video.
     */
    fixed: readonly ClipId[] | undefined,
    media: MediaBytes,
  ): Uint8Array<ArrayBuffer>;
  importMedia(name: string, mime: string, kind: MediaKind, bytes: Uint8Array): ImportMediaResult;
  // What the core itself holds for a medium: the entry a `.videola` brought with it, or the bytes
  // `importMedia` was handed. `undefined` where the library names a medium whose bytes only ever
  // lived in the caller's store, which is the ordinary case in the browser -- OPFS has them there.
  mediaBytes(id: string): Uint8Array<ArrayBuffer> | undefined;
  warnings(): LoadWarning[];
}
