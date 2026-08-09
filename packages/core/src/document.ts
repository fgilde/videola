import type {
  DocumentBackend,
  EffectParams,
  MediaBytes,
  SaveOptions,
  SourceTimes,
  Transforms,
} from "./backend";
import type {
  ClipId,
  Command,
  DispatchResult,
  LoadWarning,
  MediaKind,
  Project,
} from "./generated";

type Listener = (project: Project) => void;

export class VideolaDocument {
  #backend: DocumentBackend;
  #listeners = new Set<Listener>();
  #project: Project;
  #warnings: LoadWarning[];
  #canUndo = false;
  #canRedo = false;

  constructor(backend: DocumentBackend) {
    this.#backend = backend;
    this.#project = backend.state();
    this.#warnings = backend.warnings();
  }

  get state(): Project {
    return this.#project;
  }

  get canUndo(): boolean {
    return this.#canUndo;
  }

  get canRedo(): boolean {
    return this.#canRedo;
  }

  get warnings(): LoadWarning[] {
    return this.#warnings;
  }

  // Bound to the instance, because playback holds it as a plain function for the length of a
  // session and never sees the document it came from.
  sourceTimesAt: SourceTimes = (at) => this.#backend.sourceTimesAt(at);

  effectParamsAt: EffectParams = (at) => this.#backend.effectParamsAt(at);

  transformsAt: Transforms = (at) => this.#backend.transformsAt(at);

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(command: Command, coalesceKey?: string): DispatchResult {
    const result = this.#backend.dispatch(
      coalesceKey === undefined ? { command } : { command, coalesceKey },
    );
    return this.#absorb(result);
  }

  undo(): DispatchResult {
    return this.#absorb(this.#backend.undo());
  }

  redo(): DispatchResult {
    return this.#absorb(this.#backend.redo());
  }

  importMedia(file: { name: string; type: string }, bytes: Uint8Array): string {
    const { id, result } = this.#backend.importMedia(
      file.name,
      file.type,
      mediaKind(file.type),
      bytes,
    );
    this.#absorb(result);
    return id;
  }

  save(options: SaveOptions, media: MediaBytes): Uint8Array<ArrayBuffer> {
    return this.#backend.save(options, media);
  }

  saveAsTemplate(
    options: SaveOptions,
    id: string,
    marked?: readonly ClipId[],
  ): Uint8Array<ArrayBuffer> {
    return this.#backend.saveAsTemplate(options, id, marked);
  }

  #absorb(result: DispatchResult): DispatchResult {
    this.#canUndo = result.canUndo;
    this.#canRedo = result.canRedo;
    this.#notify();
    return result;
  }

  #notify(): void {
    this.#project = this.#backend.state();
    this.#warnings = this.#backend.warnings();
    for (const listener of this.#listeners) {
      // A listener's own bug must not undo a dispatch that already succeeded, nor
      // block sibling listeners from seeing it.
      try {
        listener(this.#project);
      } catch (error) {
        console.error(error);
      }
    }
  }
}

export function mediaKind(mime: string): MediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/")) return "font";
  throw new Error("error.unsupportedMedia");
}
