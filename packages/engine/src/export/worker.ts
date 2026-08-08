/// <reference lib="webworker" />

import { runExport } from "./encode";

import type { ExportRequest } from "./encode";
import type { ExportMessage } from "./run";

// The whole of the export's own thread. Everything below decodes, composites and encodes for
// minutes at a time, and on the main thread that is a frozen window rather than a busy one.
//
// Cancelling is the caller terminating this worker: the file exists only in this heap until the
// last message, so there is no half-written thing left behind to clean up.
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ExportRequest>): void => {
  void handle(event.data);
};

async function handle(request: ExportRequest): Promise<void> {
  try {
    const bytes = await runExport(request, {
      onProgress: (done, total) => post({ type: "progress", done, total }),
    });
    post(
      {
        type: "done",
        result: {
          bytes,
          mimeType: request.format.mimeType,
          extension: request.format.extension,
        },
      },
      [bytes.buffer],
    );
  } catch (error) {
    post({ type: "failed", reason: reasonOf(error) });
  }
}

function post(message: ExportMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

// The interface shows catalogue keys, and everything this package throws is one. A message from
// the browser or from mediabunny is not translatable, so it goes to the console for whoever
// debugs and the user is told the one thing that is true: the export failed.
function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("error.")) return error.message;
  console.error(error);
  return "error.exportFailed";
}
