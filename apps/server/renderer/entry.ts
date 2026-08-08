import { createWasmBackend } from "@videola/core";
import { renderStills } from "@videola/engine/src/render/still";
import { mediaHash, putMedia } from "@videola/media";

import type { Time } from "@videola/core";

// The page the server drives in headless Chrome. Everything below is the running application's own
// code -- the wasm core over the same boundary the editor uses, the same OPFS store, the same
// compositor -- so a still cannot show anything the preview would not.
interface Job {
  times: readonly Time[];
  width: number;
  height: number;
}

const base = new URL(".", import.meta.url);

function at(path: string): string {
  return new URL(path, base).href;
}

async function render(): Promise<void> {
  const job = (await (await fetch(at("job"))).json()) as Job;
  const archive = new Uint8Array(await (await fetch(at("archive"))).arrayBuffer());
  const backend = await createWasmBackend(archive);
  const project = backend.state();

  // The decoders read from OPFS by content hash, and the core is the only thing here that holds
  // the bytes -- an archive carries every medium the project uses. A library entry the core cannot
  // back is left out rather than faked: its clip then renders without a picture, which is what the
  // editor shows for a missing medium too.
  for (const asset of project.library) {
    const hash = mediaHash(asset.id);
    const bytes = hash === undefined ? undefined : backend.mediaBytes(asset.id);
    if (hash !== undefined && bytes !== undefined) await putMedia(hash, bytes);
  }

  const stills = await renderStills({
    project,
    sourceTimes: backend.sourceTimesAt,
    effectParams: backend.effectParamsAt,
    times: job.times,
    width: job.width,
    height: job.height,
  });
  for (const still of stills) {
    await fetch(at("still"), { method: "POST", body: still });
  }
}

async function report(body: unknown): Promise<void> {
  await fetch(at("done"), { method: "POST", body: JSON.stringify(body) });
}

// A failure has to travel as a failure. Reporting nothing would leave the caller waiting for its
// timeout and then guessing, and reporting success would hand an agent a picture of nothing.
void render().then(
  () => report({ ok: true }),
  (error: unknown) => report({ ok: false, reason: String(error) }),
);
