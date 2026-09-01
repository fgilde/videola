import init, { readAudiola, WasmDocument } from "./wasm/videola_core.js";

import type {
  DocumentBackend,
  EffectParamSnapshot,
  ImportMediaResult,
  MediaBytes,
  SaveOptions,
  TransformSnapshot,
} from "./backend";
import type {
  ClipId,
  Dispatch,
  DispatchResult,
  Frame,
  Keyframe,
  LoadWarning,
  MediaKind,
  Project,
  ProjectSettings,
  SlotAnswer,
  Template,
  Time,
} from "./generated";

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
  return wrap(bytes === undefined ? new WasmDocument() : WasmDocument.open(bytes));
}

// An autosaved project state, taken over as an ordinary document. No media travel with it: the
// bytes are in OPFS under their content hash already, which is where everything that decodes,
// draws or exports reads them from. The project is untrusted all the same and goes through the
// same `normalize` gate a `.videola` does.
export async function createProjectBackend(project: Project): Promise<DocumentBackend> {
  await ensureReady();
  return wrap(WasmDocument.fromProject(project));
}

/// The templates the application ships with. Manifest and project together, because the gallery
/// draws its preview from the very timeline the template will build.
export async function builtinTemplates(): Promise<Template[]> {
  await ensureReady();
  return WasmDocument.builtinTemplates() as Template[];
}

/** One Audiola track as this side turns it into commands. Times are flicks, like every other time. */
export interface AudiolaTrackImport {
  name: string;
  colorHex: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  clips: readonly {
    media: string;
    name: string;
    start: number;
    duration: number;
    inPoint: number;
    volume: number;
    fadeIn: number;
    fadeOut: number;
  }[];
}

export interface AudiolaFile {
  tracks: readonly AudiolaTrackImport[];
  /** What the file held and this could not use, in words, so a silent loss is never silent. */
  notes: readonly string[];
  /** The bytes behind the clips, keyed by content hash — ready for the host's own media store. */
  media: ReadonlyMap<string, Uint8Array>;
}

/**
 * Read an `.audiola`, Audiola's own project file.
 *
 * Not a project: what comes back is something to append to the edit that is already open, because
 * that is what opening a mix is for. The caller adds a track and its clips through the same commands
 * a person would, which keeps one undo step and no second way for material to reach a timeline.
 */
export async function readAudiolaFile(bytes: Uint8Array): Promise<AudiolaFile> {
  await ensureReady();
  const imported = readAudiola(bytes);
  const described = imported.described as { tracks: AudiolaTrackImport[]; notes: string[] };
  const media = new Map<string, Uint8Array>();
  for (const [id, held] of imported.media as unknown as Map<string, Uint8Array>) {
    media.set(id, held);
  }
  return { tracks: described.tracks, notes: described.notes, media };
}

/**
 * A template file, and the material it brought with it.
 *
 * Not always empty: what the author did not turn into a question travels inside the `.videolat` --
 * an intro, a logo, a watermark. The caller has to put those bytes wherever it keeps media before it
 * bakes, or the template names material nobody has.
 */
export async function readTemplateFile(
  bytes: Uint8Array,
): Promise<{ template: Template; media: ReadonlyMap<string, Uint8Array> }> {
  await ensureReady();
  const found = WasmDocument.readTemplate(bytes) as {
    template: Template;
    media: Map<string, Uint8Array>;
  };
  return { template: found.template, media: found.media };
}

// The project a gallery card is drawn from: the template baked against a stand-in for every piece
// of material, each one a grey gradient sitting in exactly the rectangle the real answer will land
// in. A project comes back rather than a picture, because the compositor is on this side of the
// boundary -- `templatePoster` in @videola/engine is the half that turns it into pixels.
export async function templatePreview(template: Template, frame?: Frame): Promise<Project> {
  await ensureReady();
  return WasmDocument.templatePreview(template, frame ?? null) as Project;
}

// A baked template is an ordinary document: same backend interface, same commands, same undo. The
// caller cannot tell it apart from an opened file, and that is the whole point of Bake-to-Project.
export async function createTemplateBackend(
  template: Template,
  answers: Readonly<Record<string, SlotAnswer>>,
  settings?: ProjectSettings,
): Promise<DocumentBackend> {
  await ensureReady();
  return wrap(WasmDocument.fromTemplate(template, answers, settings ?? null));
}

function wrap(handle: WasmDocument): DocumentBackend {
  return {
    state: () => handle.state() as Project,
    // Static on the glue class, because two keyframes decide the whole answer and no document is
    // involved. Handed out through the backend all the same, so the surface reaches a curve the
    // same way it reaches its resolved transforms and parameters -- one object, one seam.
    curveShape: (left: Keyframe, right: Keyframe, samples: number) =>
      Array.from(WasmDocument.curveShape(left, right, samples)),
    toEdl: () => handle.toEdl(),
    toFcpxml: () => handle.toFcpxml(),
    toXmeml: () => handle.toXmeml(),
    toAudiola: (media) => {
      const written = handle.toAudiola(media);
      return { bytes: written.bytes, leftOut: written.leftOut };
    },
    sourceTimesAt: (at: Time) => handle.sourceTimesAt(at) as ReadonlyMap<string, Time>,
    effectParamsAt: (at: Time) => handle.effectParamsAt(at) as EffectParamSnapshot,
    transformsAt: (at: Time) => handle.transformsAt(at) as TransformSnapshot,
    dispatch: (dispatch: Dispatch) => handle.dispatch(dispatch) as DispatchResult,
    undo: () => handle.undo() as DispatchResult,
    redo: () => handle.redo() as DispatchResult,
    rollback: () => handle.rollback(),
    // The glue's own .d.ts under-types this as plain Uint8Array, but the JS it generates
    // (getArrayU8FromWasm0(...).slice()) always allocates a fresh ArrayBuffer-backed copy -
    // never a view into wasm memory, never a SharedArrayBuffer - so this cast just corrects
    // the declared type to what the implementation already guarantees.
    save: (options: SaveOptions, media: MediaBytes) =>
      handle.save(options, media) as Uint8Array<ArrayBuffer>,
    saveAsTemplate: (
      options: SaveOptions,
      id: string,
      marked: readonly ClipId[] | undefined,
      media: MediaBytes,
    ) => handle.saveAsTemplate(options, id, marked ?? null, media) as Uint8Array<ArrayBuffer>,
    importMedia: (name: string, mime: string, kind: MediaKind, media: Uint8Array) =>
      handle.importMedia(name, mime, kind, media) as ImportMediaResult,
    mediaBytes: (id: string) => handle.mediaBytes(id) as Uint8Array<ArrayBuffer> | undefined,
    warnings: () => handle.warnings() as LoadWarning[],
  };
}
