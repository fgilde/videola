import { createWasmBackend, timeToSeconds } from "@videola/core";
import { AudioGraph } from "@videola/engine/src/audio/graph";
import { AudioSource } from "@videola/engine/src/decode/audio-source";
import { renderStills } from "@videola/engine/src/render/still";
import { mediaHash, peaks, putMedia } from "@videola/media";

import type { DocumentBackend, Project, Time } from "@videola/core";

// The page the server drives in headless Chrome. Everything below is the running application's own
// code -- the wasm core over the same boundary the editor uses, the same OPFS store, the same
// compositor, the same audio graph -- so an answer here cannot differ from what the editor shows.
type Job =
  | { kind: "stills"; times: readonly Time[]; width: number; height: number }
  | { kind: "peaks"; from: Time; to: Time; buckets: number };

const base = new URL(".", import.meta.url);

function at(path: string): string {
  return new URL(path, base).href;
}

async function post(path: string, body: BodyInit): Promise<void> {
  await fetch(at(path), { method: "POST", body });
}

// The decoders and the audio graph read from OPFS by content hash, and the core is the only thing
// here that holds the bytes -- an archive carries every medium the project uses. A library entry
// the core cannot back is left out rather than faked: its clip then renders without a picture,
// which is what the editor shows for a missing medium too.
async function unpack(backend: DocumentBackend, project: Project): Promise<void> {
  for (const asset of project.library) {
    const hash = mediaHash(asset.id);
    const bytes = hash === undefined ? undefined : backend.mediaBytes(asset.id);
    if (hash !== undefined && bytes !== undefined) await putMedia(hash, bytes);
  }
}

async function stills(backend: DocumentBackend, project: Project, job: Job): Promise<void> {
  if (job.kind !== "stills") return;
  const pictures = await renderStills({
    project,
    sourceTimes: backend.sourceTimesAt,
    effectParams: backend.effectParamsAt,
    transforms: backend.transformsAt,
    times: job.times,
    width: job.width,
    height: job.height,
  });
  for (const picture of pictures) await post("part", picture);
}

// Rendered offline through the graph the export uses, then reduced to two extremes per bucket the
// way the timeline draws its strips. Anything that reads these numbers is reading the sound that
// would be written, mixed and levelled, not one clip's file.
async function audioPeaks(project: Project, job: Job): Promise<void> {
  if (job.kind !== "peaks") return;
  const sampleRate = project.settings.sampleRate;
  const length = Math.max(1, Math.round(timeToSeconds(job.to - job.from) * sampleRate));
  const context = new OfflineAudioContext(2, length, sampleRate);
  const graph = new AudioGraph(context, new AudioSource());
  await graph.prepare(project);
  graph.startAt(0, job.from);
  const rendered = await context.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, channel) => {
    const plane = new Float32Array(rendered.length);
    rendered.copyFromChannel(plane, channel);
    return plane;
  });
  const measured = peaks(channels, job.buckets);
  await post(
    "part",
    JSON.stringify({ min: round(measured.min), max: round(measured.max) }),
  );
}

// Three decimals is a thousandth of full scale. Full precision would triple the size of an answer
// an agent reads as a shape.
function round(values: Float32Array): number[] {
  return Array.from(values, (value) => Math.round(value * 1000) / 1000);
}

async function run(): Promise<void> {
  const job = (await (await fetch(at("job"))).json()) as Job;
  const archive = new Uint8Array(await (await fetch(at("archive"))).arrayBuffer());
  const backend = await createWasmBackend(archive);
  const project = backend.state();
  await unpack(backend, project);
  await stills(backend, project, job);
  await audioPeaks(project, job);
}

// A failure has to travel as a failure. Reporting nothing would leave the caller waiting for its
// timeout and then guessing, and reporting success would hand an agent an answer about nothing.
void run().then(
  () => post("done", JSON.stringify({ ok: true })),
  (error: unknown) => post("done", JSON.stringify({ ok: false, reason: String(error) })),
);
