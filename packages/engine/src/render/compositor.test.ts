import { describe, expect, it, vi } from "vitest";

import type { Project } from "@videola/core";

import { Compositor } from "./compositor";
import { createContext } from "./context";
import { recordingGl } from "./recording-gl";
import type { Recording } from "./recording-gl";

const MEDIA = `med_${"a".repeat(64)}`;

interface Spot {
  id: string;
  opacity?: number;
}

// Only the fields the draw list reads. What it makes of them is settled in draw-list.test.ts;
// here the subject is what the compositor does with the list it gets back.
function project(tracks: Spot[][]): Project {
  return {
    settings: { width: 640, height: 360, background: "#000000" },
    library: [{ id: MEDIA, width: 640, height: 360 }],
    timeline: {
      tracks: tracks.map((clips, index) => ({
        id: `trk_${index}`,
        kind: "video",
        hidden: false,
        clips: clips.map((spot) => ({
          id: spot.id,
          source: { kind: "media", media: MEDIA },
          start: 0,
          duration: 1000,
          blend: "normal",
          transform: {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            anchorX: 0.5,
            anchorY: 0.5,
            opacity: spot.opacity ?? 1,
            crop: { left: 0, top: 0, right: 0, bottom: 0 },
          },
        })),
      })),
    },
  } as unknown as Project;
}

// Reading any property of a VideoFrame here is a bug: the frame belongs to the FrameCache, which
// may close it the moment this call returns, and a closed frame answers zero for its dimensions.
// The compositor is allowed to hand it to the driver and nothing else.
function opaqueFrame(): VideoFrame {
  return new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error(`the compositor read ${String(key)} off a frame it does not own`);
      },
    },
  ) as VideoFrame;
}

function framesFor(...ids: string[]): Map<string, VideoFrame> {
  return new Map(ids.map((id) => [id, opaqueFrame()]));
}

function attached(overrides: Record<string, unknown> = {}): {
  compositor: Compositor;
  recording: Recording;
  canvas: HTMLCanvasElement;
} {
  const recording = recordingGl(overrides);
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(recording.gl as never);
  return { compositor: new Compositor(createContext(canvas)), recording, canvas };
}

const uploads = (recording: Recording): unknown[] =>
  recording.named("texImage2D").map((call) => call.args[5]);

describe("Compositor", () => {
  it("draws one quad per visible clip, lower track first", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_lower", opacity: 0.25 }], [{ id: "clp_upper", opacity: 0.5 }]]);
    compositor.render(scene, 0, framesFor("clp_lower", "clp_upper"));
    expect(recording.named("drawArrays")).toHaveLength(2);
    expect(recording.named("uniform1f").map((call) => call.args[1])).toEqual([0.25, 0.5]);
    expect(new Set(recording.named("bindTexture").map((call) => call.args[1])).size).toBe(2);
  });

  it("hands the frame straight to the driver without looking at it", () => {
    const { compositor, recording } = attached();
    const frames = framesFor("clp_1");
    compositor.render(project([[{ id: "clp_1" }]]), 0, frames);
    expect(uploads(recording)[0]).toBe(frames.get("clp_1"));
  });

  it("skips a clip whose frame has not arrived rather than drawing a hole", () => {
    const { compositor, recording } = attached();
    compositor.render(project([[{ id: "clp_1" }, { id: "clp_2" }]]), 0, framesFor("clp_2"));
    expect(recording.named("drawArrays")).toHaveLength(1);
    expect(uploads(recording)).toHaveLength(1);
  });

  it("keeps a clip's texture across renders and releases it once the clip is gone", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);
    compositor.render(scene, 0, framesFor("clp_1"));
    compositor.render(scene, 0, framesFor("clp_1"));
    expect(recording.named("createTexture")).toHaveLength(1);
    expect(recording.named("deleteTexture")).toHaveLength(0);
    compositor.render(project([[{ id: "clp_2" }]]), 0, framesFor("clp_2"));
    expect(recording.named("deleteTexture")).toHaveLength(1);
  });

  it("builds its program once and reuses it", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);
    compositor.render(scene, 0, framesFor("clp_1"));
    compositor.render(scene, 0, framesFor("clp_1"));
    expect(recording.named("createProgram")).toHaveLength(1);
  });

  it("gives up on a lost context instead of drawing into dead handles", () => {
    const lost = { current: false };
    const { compositor, recording, canvas } = attached({ isContextLost: () => lost.current });
    compositor.render(project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    lost.current = true;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    compositor.render(project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    expect(recording.named("drawArrays")).toHaveLength(1);
    // The handles died with the context; deleting them would be a GL error on a foreign object.
    expect(recording.named("deleteTexture")).toHaveLength(0);
  });

  it("rebuilds everything once the context is back", () => {
    const lost = { current: false };
    const { compositor, recording, canvas } = attached({ isContextLost: () => lost.current });
    compositor.render(project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    lost.current = true;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    lost.current = false;
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    compositor.render(project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    expect(recording.named("createProgram")).toHaveLength(2);
    expect(recording.named("createTexture")).toHaveLength(2);
    expect(recording.named("drawArrays")).toHaveLength(2);
  });

  it("releases every handle it owns on dispose", () => {
    const { compositor, recording } = attached();
    compositor.render(project([[{ id: "clp_1" }, { id: "clp_2" }]]), 0, framesFor("clp_1", "clp_2"));
    compositor.dispose();
    expect(recording.named("deleteTexture")).toHaveLength(2);
    expect(recording.named("deleteProgram")).toHaveLength(1);
    expect(recording.named("deleteBuffer")).toHaveLength(1);
    expect(recording.named("deleteVertexArray")).toHaveLength(1);
  });

  it("reads back exactly the pixels of the size it was given", () => {
    const { compositor, recording } = attached();
    compositor.resize(4, 3);
    const pixels = compositor.readPixels();
    expect(pixels).toHaveLength(4 * 3 * 4);
    expect(recording.named("readPixels")[0]?.args.slice(0, 4)).toEqual([0, 0, 4, 3]);
  });
});
