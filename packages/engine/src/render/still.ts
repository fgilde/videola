import { clipHashes } from "../playback";
import { gatherPictures, SourcePool } from "../export/encode";
import { GeneratorFrames } from "../generate/generator";
import { VideoSource } from "../decode/video-source";
import { Compositor } from "./compositor";
import { createContext } from "./context";
import { LutStore } from "./lut";

import type { EffectParams, Project, SourceTimes, Time, Transforms } from "@videola/core";
import type { FrameSource } from "../playback";

export interface StillRequest {
  project: Project;
  sourceTimes: SourceTimes;
  effectParams: EffectParams;
  transforms: Transforms;
  times: readonly Time[];
  width: number;
  height: number;
  createFrameSource?: () => FrameSource;
}

// The export's picture without its encoder: same draw list, same decoders, same compositor, one
// instant at a time. An agent that asks what a moment looks like has to be shown the moment the
// editor would show, and the only way to guarantee that is to walk the same path.
export async function renderStills(request: StillRequest): Promise<Blob[]> {
  if (request.times.length === 0) throw new Error("error.stillNoTimes");
  // No `readable`: an OffscreenCanvas with no placeholder is never composited, so nothing clears
  // its drawing buffer between the render and `convertToBlob`. Asking for preserveDrawingBuffer
  // here costs a copy per picture and changed nothing when it was taken away -- measured, not
  // assumed.
  const canvas = new OffscreenCanvas(request.width, request.height);
  const context = createContext(canvas);
  const compositor = new Compositor(context);
  const pass = {
    // `master` like the export: a still is a picture that leaves the program as a file.
    sources: new SourcePool(
      request.createFrameSource ?? ((): FrameSource => new VideoSource("master")),
    ),
    generated: new GeneratorFrames(),
  };
  const hashes = clipHashes(request.project);
  // The same store the editor and the export worker fill, out of the same OPFS entries: a still an
  // agent asks for has to be the picture the editor shows, and a grade left out of it here would
  // be exactly the divergence this whole path exists to rule out.
  const luts = new LutStore();
  await luts.ensure(request.project);
  try {
    const stills: Blob[] = [];
    for (const at of request.times) {
      const frame = {
        at,
        sources: request.sourceTimes(at),
        params: request.effectParams(at),
        transforms: request.transforms(at),
      };
      const pictures = await gatherPictures(pass, hashes, request.project, frame);
      compositor.render(
        request.project,
        at,
        pictures,
        frame.params,
        frame.transforms,
        luts.tables(),
      );
      stills.push(await canvas.convertToBlob({ type: "image/png" }));
    }
    return stills;
  } finally {
    pass.sources.close();
    pass.generated.close();
    compositor.dispose();
    context.dispose();
  }
}
