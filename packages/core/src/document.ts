import type { DocumentBackend, SaveOptions } from "./backend";
import type { Command, DispatchResult, LoadWarning, MediaKind, Project } from "./generated";

type Listener = (project: Project) => void;

export class VideolaDocument {
  #backend: DocumentBackend;
  #listeners = new Set<Listener>();
  #canUndo = false;
  #canRedo = false;

  constructor(backend: DocumentBackend) {
    this.#backend = backend;
  }

  get state(): Project {
    return this.#backend.state();
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
    this.#absorb(result);
    return result;
  }

  undo(): DispatchResult {
    return this.#absorb(this.#backend.undo());
  }

  redo(): DispatchResult {
    return this.#absorb(this.#backend.redo());
  }

  importMedia(file: { name: string; type: string }, bytes: Uint8Array): string {
    const id = this.#backend.importMedia(file.name, file.type, mediaKind(file.type), bytes);
    this.#notify();
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
    const project = this.#backend.state();
    for (const listener of this.#listeners) {
      listener(project);
    }
  }
}

function mediaKind(mime: string): MediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/")) return "font";
  throw new Error(`unsupported media type: ${mime}`);
}
