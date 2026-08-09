import { hasProxy } from "@videola/media";

import type { ProxyBuilt } from "./build";

export interface ProxyRequest {
  hash: string;
  maxHeight?: number;
}

export type ProxyMessage = { type: "done"; hash: string; built: ProxyBuilt | undefined };

/** What the library shows against a medium. Absent means the question was never asked. */
export type ProxyState = "building" | "ready";

export interface ProxyQueueOptions {
  createWorker?: () => Worker;
  maxHeight?: number;
  onChange?: () => void;
}

/**
 * Makes the proxies for a project's media, one at a time.
 *
 * One at a time on purpose: every one of these saturates a CPU, and three at once would take three
 * times as long to deliver the first -- and the first is the one the person is waiting to scrub.
 *
 * ponytail: the order is the order the media arrive in, not the order they are needed in. The clip
 * under the playhead is the one to make first; that needs the queue to be told where the playhead
 * is, which is a wire nothing else in the editor has yet.
 */
export class ProxyQueue {
  #createWorker: () => Worker;
  #maxHeight?: number;
  #onChange: () => void;
  #state = new Map<string, ProxyState>();
  #waiting: string[] = [];
  #running = false;
  #disposed = false;

  constructor(options: ProxyQueueOptions = {}) {
    this.#createWorker = options.createWorker ?? spawnWorker;
    this.#maxHeight = options.maxHeight;
    this.#onChange = options.onChange ?? ((): void => undefined);
  }

  /** Which media have a proxy and which are being given one, keyed by content hash. */
  get states(): ReadonlyMap<string, ProxyState> {
    return this.#state;
  }

  get building(): string | undefined {
    return [...this.#state].find(([, state]) => state === "building")?.[0];
  }

  /**
   * Asks for proxies for these media. Hashes already known, queued or on disk are skipped, so this
   * can be called on every project change -- which is what an import looks like from here.
   */
  async want(hashes: Iterable<string>): Promise<void> {
    for (const hash of hashes) {
      if (this.#state.has(hash) || this.#waiting.includes(hash)) continue;
      if (await hasProxy(hash)) {
        this.#state.set(hash, "ready");
        this.#onChange();
        continue;
      }
      this.#waiting.push(hash);
    }
    this.#pump();
  }

  dispose(): void {
    this.#disposed = true;
    this.#waiting = [];
  }

  #pump(): void {
    if (this.#running || this.#disposed) return;
    const hash = this.#waiting.shift();
    if (hash === undefined) return;
    this.#running = true;
    this.#state.set(hash, "building");
    this.#onChange();
    const worker = this.#createWorker();
    const finish = (message: ProxyMessage | undefined): void => {
      worker.terminate();
      // A proxy that was not made leaves no mark: the medium simply has none, the preview decodes
      // the original, and the next session may try again on a machine that can encode.
      if (message?.built === undefined) this.#state.delete(hash);
      else this.#state.set(hash, "ready");
      this.#running = false;
      this.#onChange();
      this.#pump();
    };
    worker.onmessage = (event: MessageEvent<ProxyMessage>): void => finish(event.data);
    // A worker that dies of an out-of-memory kill sends no message at all, and without this the
    // queue would sit on "building" for ever and never start the next medium.
    worker.onerror = (): void => finish(undefined);
    worker.postMessage({ hash, maxHeight: this.#maxHeight } satisfies ProxyRequest);
  }
}

function spawnWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}
