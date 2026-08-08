import { clipHashes } from "../playback";
import { gatherPictures, SourcePool } from "../export/encode";
import { GeneratorFrames } from "../generate/generator";
import { VideoSource } from "../decode/video-source";
import { Compositor } from "./compositor";
import { createContext } from "./context";

import type { EffectParams, Project, SourceTimes, Time } from "@videola/core";
import type { FrameSource } from "../playback";

export interface StillRequest {
  project: Project;
  sourceTimes: SourceTimes;
  effectParams: EffectParams;
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
  const canvas = new OffscreenCanvas(request.width, request.height);
  // Readable, or `convertToBlob` hands back a cleared buffer: the browser is free to drop the
  // drawing buffer once it has composited it, and there is an await between the render and the
  // encode of every picture here.
  const context = createContext(canvas, { readable: true });
  const compositor = new Compositor(context);
  const pass = {
    sources: new SourcePool(request.createFrameSource ?? ((): FrameSource => new VideoSource())),
    generated: new GeneratorFrames(),
  };
  const hashes = clipHashes(request.project);
  try {
    const stills: Blob[] = [];
    for (const at of request.times) {
      const frame = {
        at,
        sources: request.sourceTimes(at),
        params: request.effectParams(at),
      };
      const pictures = await gatherPictures(pass, hashes, request.project, frame);
      compositor.render(request.project, at, pictures, frame.params);
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
