import type { DocumentBackend, SaveOptions } from "./backend";
import type { Command, DispatchResult, LoadWarning, MediaKind, Project } from "./generated";

type Listener = (project: Project) => void;

export class VideolaDocument {
  #backend: DocumentBackend;
  #listeners = new Set<Listener>();
  #project: Project;
  #canUndo = false;
  #canRedo = false;

  constructor(backend: DocumentBackend) {
    this.#backend = backend;
    this.#project = backend.state();
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
    return this.#backend.warnings();
  }

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

  save(options: SaveOptions): Uint8Array {
    return this.#backend.save(options);
  }

  #absorb(result: DispatchResult): DispatchResult {
    this.#canUndo = result.canUndo;
    this.#canRedo = result.canRedo;
    this.#notify();
    return result;
  }

  #notify(): void {
    this.#project = this.#backend.state();
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

function mediaKind(mime: string): MediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/")) return "font";
  throw new Error("unsupportedMediaType");
}
