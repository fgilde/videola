/// <reference lib="webworker" />

import { buildProxy } from "./build";

import type { ProxyMessage, ProxyRequest } from "./queue";

// A thread of its own for the same reason the export has one: transcoding a medium is minutes of
// solid encoding, and on the main thread that is a frozen editor -- which is precisely the thing
// proxies exist to stop happening. OPFS is reachable from a worker, so the bytes are read and
// written here and nothing but a message crosses back.
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ProxyRequest>): void => {
  void handle(event.data);
};

async function handle(request: ProxyRequest): Promise<void> {
  try {
    const built = await buildProxy(request.hash, request.maxHeight);
    post({ type: "done", hash: request.hash, built });
  } catch (error) {
    // A proxy that could not be made is a speed that was not gained, never a broken medium: the
    // reason goes to the console and the preview carries on decoding the original.
    console.error(error);
    post({ type: "done", hash: request.hash, built: undefined });
  }
}

function post(message: ProxyMessage): void {
  scope.postMessage(message);
}
