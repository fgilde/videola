import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { mediaKind } from "@videola/core";
import type { Command, DispatchResult, LoadWarning, Project } from "@videola/core";
import type { DocumentBackend } from "@videola/core";

import { RenderError, renderStills, type RenderCode } from "./frames";
import { describeProject, validateProject, type Finding } from "./inspect";
import { PathOutsideRoot, Storage, writeAtomic } from "./paths";
import { openBackend } from "./wasm";

export const APP_VERSION = "0.0.0";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ProjectView {
  readonly id: string;
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly warnings: readonly LoadWarning[];
  readonly source: string | null;
  readonly title: string;
}

export interface ApplyResult {
  readonly view: ProjectView;
  readonly results: readonly DispatchResult[];
}

// `canUndo`/`canRedo` arrive on a DispatchResult and nowhere else — the facade does not expose the
// history stack itself. A session that has never dispatched reports both false, which is true of
// it, and every mutating call refreshes them from the result the core just returned.
class Session {
  revision = 0;
  source: string | null = null;
  canUndo = false;
  canRedo = false;
  readonly created = new Date().toISOString();

  constructor(
    readonly id: string,
    readonly backend: DocumentBackend,
  ) {}

  absorb(result: DispatchResult): DispatchResult {
    this.canUndo = result.canUndo;
    this.canRedo = result.canRedo;
    return result;
  }
}

export interface ApiOptions {
  readonly storageRoot: string;
  readonly maxProjects?: number;
  readonly locale?: string;
}

// The one place that turns a request into core calls, shared verbatim by the HTTP routes and the
// MCP tools. Neither transport reaches the core on its own, so neither can offer a capability the
// other lacks — and neither can skip a check the other performs.
export class Api {
  #sessions = new Map<string, Session>();
  #storage: Storage;
  #maxProjects: number;
  #locale: string;

  constructor(options: ApiOptions) {
    this.#storage = new Storage(options.storageRoot);
    this.#maxProjects = options.maxProjects ?? 8;
    this.#locale = options.locale ?? "en";
  }

  storage(): Storage {
    return this.#storage;
  }

  async create(): Promise<ProjectView> {
    return this.#adopt(await openBackend(), null);
  }

  async openPath(given: string): Promise<ProjectView> {
    const path = await this.#resolveForReading(given);
    const bytes = await readFile(path);
    return this.#adopt(await this.#openArchive(bytes), given);
  }

  async openArchive(bytes: Uint8Array): Promise<ProjectView> {
    return this.#adopt(await this.#openArchive(bytes), null);
  }

  list(): readonly ProjectView[] {
    return [...this.#sessions.values()].map((session) => this.#view(session));
  }

  view(id: string): ProjectView {
    return this.#view(this.#session(id));
  }

  state(id: string): Project {
    return this.#session(id).backend.state();
  }

  close(id: string): void {
    this.#session(id);
    this.#sessions.delete(id);
  }

  // Atomic by construction: one coalesce key per call means the commands that land form a single
  // history entry, so a rejected command anywhere in the chain is undone by one `rollback`. The
  // whole chain runs without an `await`, which is what keeps a second request from landing in the
  // middle of it.
  apply(id: string, commands: readonly Command[], ifRevision?: number): ApplyResult {
    const session = this.#session(id);
    if (commands.length === 0) throw new ApiError(400, "emptyBatch", "no commands given");
    this.#requireRevision(session, ifRevision);

    const coalesceKey = `batch_${randomBytes(8).toString("hex")}`;
    const couldUndo = session.canUndo;
    const results: DispatchResult[] = [];
    let changed = false;
    try {
      for (const command of commands) {
        const result = session.absorb(session.backend.dispatch({ command, coalesceKey }));
        changed ||= hasChange(result);
        results.push(result);
      }
    } catch (error) {
      if (changed) {
        session.backend.rollback();
        // Back to the pre-batch history, minus a redo stack the batch's first successful
        // dispatch already cleared — see `Document::rollback`.
        session.canUndo = couldUndo;
        session.canRedo = false;
      }
      throw new ApiError(400, "commandRejected", messageOf(error));
    }
    if (changed) session.revision += 1;
    return { view: this.#view(session), results };
  }

  undo(id: string): ApplyResult {
    return this.#step(id, (backend) => backend.undo());
  }

  redo(id: string): ApplyResult {
    return this.#step(id, (backend) => backend.redo());
  }

  async importPath(id: string, given: string, mime?: string): Promise<string> {
    const path = await this.#resolveForReading(given);
    const bytes = await readFile(path);
    return this.importBytes(id, basename(given), mime ?? mimeFor(given), bytes);
  }

  importBytes(id: string, name: string, mime: string, bytes: Uint8Array): string {
    const session = this.#session(id);
    try {
      const { id: mediaId } = session.backend.importMedia(name, mime, mediaKind(mime), bytes);
      session.revision += 1;
      return mediaId;
    } catch (error) {
      throw new ApiError(400, "importRejected", messageOf(error));
    }
  }

  archive(id: string): Uint8Array {
    const session = this.#session(id);
    try {
      return session.backend.save(
        {
          appVersion: APP_VERSION,
          created: session.created,
          modified: new Date().toISOString(),
          locale: this.#locale,
        },
        new Map(),
      );
    } catch (error) {
      throw new ApiError(400, "saveFailed", messageOf(error));
    }
  }

  async savePath(id: string, given: string): Promise<ProjectView> {
    const bytes = this.archive(id);
    const path = await this.#resolveForWriting(given);
    await writeAtomic(path, bytes);
    const session = this.#session(id);
    session.source = given;
    return this.#view(session);
  }

  describe(id: string): string {
    return describeProject(this.state(id));
  }

  validate(id: string): readonly Finding[] {
    return validateProject(this.state(id));
  }

  // The one tool that lets an agent see its work rather than assert it. Nothing here decides what
  // is on screen: the archive carries the project the core normalised, and the renderer walks the
  // same draw list the editor draws. What the server owns is how big the answer may get.
  async frames(id: string, times: readonly number[], width?: number): Promise<Uint8Array[]> {
    const settings = this.state(id).settings;
    const size = fit(settings.width, settings.height, width);
    try {
      return await renderStills({ archive: this.archive(id), times: instants(times), ...size });
    } catch (error) {
      if (error instanceof RenderError) {
        throw new ApiError(RENDER_STATUS[error.code], error.code, error.message);
      }
      throw error;
    }
  }

  #step(id: string, run: (backend: DocumentBackend) => DispatchResult): ApplyResult {
    const session = this.#session(id);
    try {
      const result = session.absorb(run(session.backend));
      session.revision += 1;
      return { view: this.#view(session), results: [result] };
    } catch (error) {
      throw new ApiError(400, "historyEmpty", messageOf(error));
    }
  }

  async #openArchive(bytes: Uint8Array): Promise<DocumentBackend> {
    try {
      return await openBackend(bytes);
    } catch (error) {
      throw new ApiError(400, "notAProject", messageOf(error));
    }
  }

  #adopt(backend: DocumentBackend, source: string | null): ProjectView {
    if (this.#sessions.size >= this.#maxProjects) {
      throw new ApiError(
        429,
        "tooManyProjects",
        `${this.#maxProjects} projects are already open; close one first`,
      );
    }
    const session = new Session(`prj_${randomBytes(8).toString("hex")}`, backend);
    session.source = source;
    this.#sessions.set(session.id, session);
    return this.#view(session);
  }

  #session(id: string): Session {
    const session = this.#sessions.get(id);
    if (session === undefined) throw new ApiError(404, "noSuchProject", `unknown project: ${id}`);
    return session;
  }

  #requireRevision(session: Session, expected?: number): void {
    if (expected !== undefined && expected !== session.revision) {
      throw new ApiError(
        409,
        "revisionMismatch",
        `project is at revision ${session.revision}, not ${expected}`,
      );
    }
  }

  #view(session: Session): ProjectView {
    return {
      id: session.id,
      revision: session.revision,
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      warnings: session.backend.warnings(),
      source: session.source,
      title: session.backend.state().meta.title,
    };
  }

  async #resolveForReading(given: string): Promise<string> {
    return this.#guardPath(() => this.#storage.forReading(given));
  }

  async #resolveForWriting(given: string): Promise<string> {
    return this.#guardPath(() => this.#storage.forWriting(given));
  }

  async #guardPath(resolve: () => Promise<string>): Promise<string> {
    try {
      return await resolve();
    } catch (error) {
      if (error instanceof PathOutsideRoot) throw new ApiError(403, "pathDenied", error.message);
      throw new ApiError(404, "noSuchFile", messageOf(error));
    }
  }
}

const RENDER_STATUS: Record<RenderCode, number> = {
  rendererUnavailable: 503,
  renderFailed: 500,
  renderTimeout: 504,
};

// Small enough that a picture costs an agent a fraction of what a frame of the project would, big
// enough to see a cut, a title and a colour grade in. The project's own aspect ratio decides the
// height, so a still is never a letterboxed lie about the shape of the timeline.
export const DEFAULT_FRAME_WIDTH = 640;
const MIN_FRAME_WIDTH = 16;
const MAX_FRAME_WIDTH = 1920;
const MAX_FRAMES_PER_CALL = 8;

function fit(
  projectWidth: number,
  projectHeight: number,
  width?: number,
): { width: number; height: number } {
  if (width !== undefined && !Number.isSafeInteger(width)) {
    throw new ApiError(400, "badWidth", "width must be a whole number of pixels");
  }
  const chosen = Math.min(MAX_FRAME_WIDTH, Math.max(MIN_FRAME_WIDTH, width ?? DEFAULT_FRAME_WIDTH));
  return { width: chosen, height: Math.max(1, Math.round((chosen * projectHeight) / projectWidth)) };
}

function instants(times: readonly number[]): number[] {
  if (times.length === 0) throw new ApiError(400, "noTimes", "give at least one time in flicks");
  if (times.length > MAX_FRAMES_PER_CALL) {
    throw new ApiError(400, "tooManyFrames", `at most ${MAX_FRAMES_PER_CALL} times per call`);
  }
  return times.map((at) => {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new ApiError(400, "badTime", `not a time in flicks: ${at}`);
    }
    return at;
  });
}

function hasChange(result: DispatchResult): boolean {
  return Array.isArray(result.patch) && result.patch.length > 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function basename(given: string): string {
  const parts = given.split(/[\\/]/);
  return parts[parts.length - 1] ?? given;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
};

// The core decides what a medium *is* from its MIME type (`mediaKind`), and a file on disk carries
// no MIME type. Guessing from the extension is the whole of it: an unknown extension is refused
// here rather than turned into `application/octet-stream`, which would fail one layer deeper with
// a message about a kind the caller never mentioned.
export function mimeFor(given: string): string {
  const mime = MIME_BY_EXTENSION[extname(given).toLowerCase()];
  if (mime === undefined) {
    throw new ApiError(
      400,
      "unknownMediaType",
      `cannot tell the media type of ${given}; pass mime explicitly`,
    );
  }
  return mime;
}
