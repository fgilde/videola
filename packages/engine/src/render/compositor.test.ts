import { describe, expect, it, vi } from "vitest";

import type { EffectParamSnapshot, Project } from "@videola/core";

import { Compositor } from "./compositor";
import { createContext } from "./context";
import { recordingGl } from "./recording-gl";
import type { Recording } from "./recording-gl";

const MEDIA = `med_${"a".repeat(64)}`;

interface Spot {
  id: string;
  opacity?: number;
  blend?: string;
  effects?: unknown[];
  transitionIn?: unknown;
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
          blend: spot.blend ?? "normal",
          effects: spot.effects ?? [],
          transitionIn: spot.transitionIn,
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

// The frame belongs to the FrameCache. Three properties may be read before the upload -- `format`
// says whether it is still alive, the coded size says whether the driver can take it -- and
// touching anything else, or keeping the frame past the call, is a bug. Everything else throws.
function opaqueFrame(over: Record<string, unknown> = {}): VideoFrame {
  const readable: Record<string, unknown> = {
    format: "RGBA",
    codedWidth: 640,
    codedHeight: 360,
    ...over,
  };
  return new Proxy(readable, {
    get(target, key) {
      if (key in target) return target[key as string];
      throw new Error(`the compositor read ${String(key)} off a frame it does not own`);
    },
  }) as unknown as VideoFrame;
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

// Most cases here are about clips with no effect at all, where the resolved parameters are an
// empty map. The ones that do carry an effect hand their own in.
function render(
  compositor: Compositor,
  scene: Project,
  at: number,
  frames: ReadonlyMap<string, VideoFrame>,
  params: EffectParamSnapshot = new Map(),
): void {
  compositor.render(scene, at, frames, params);
}

const uploads = (recording: Recording): unknown[] =>
  recording.named("texImage2D").map((call) => call.args[5]);

describe("Compositor", () => {
  it("draws one quad per visible clip, lower track first", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_lower", opacity: 0.25 }], [{ id: "clp_upper", opacity: 0.5 }]]);
    render(compositor, scene, 0, framesFor("clp_lower", "clp_upper"));
    expect(recording.named("drawArrays")).toHaveLength(2);
    expect(recording.named("uniform1f").map((call) => call.args[1])).toEqual([0.25, 0.5]);
    expect(new Set(recording.named("bindTexture").map((call) => call.args[1])).size).toBe(2);
  });

  it("hands the frame straight to the driver without looking at it", () => {
    const { compositor, recording } = attached();
    const frames = framesFor("clp_1");
    render(compositor, project([[{ id: "clp_1" }]]), 0, frames);
    expect(uploads(recording)[0]).toBe(frames.get("clp_1"));
  });

  it("skips a clip whose frame has not arrived rather than drawing a hole", () => {
    const { compositor, recording } = attached();
    render(compositor, project([[{ id: "clp_1" }, { id: "clp_2" }]]), 0, framesFor("clp_2"));
    expect(recording.named("drawArrays")).toHaveLength(1);
    expect(uploads(recording)).toHaveLength(1);
  });

  // The frame after a seek is not there yet, and a clip that vanishes for that one tick is a
  // black flash in the middle of the picture.
  it("redraws a clip from its own texture when the next frame is late", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);
    render(compositor, scene, 0, framesFor("clp_1"));

    render(compositor, scene, 0, new Map());

    expect(recording.named("drawArrays")).toHaveLength(2);
    expect(uploads(recording)).toHaveLength(1);
  });

  it("holds nothing for a clip whose frame died before it ever arrived", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);

    render(compositor, scene, 0, new Map([["clp_1", opaqueFrame({ format: null })]]));
    render(compositor, scene, 0, new Map());

    expect(recording.named("drawArrays")).toHaveLength(0);
    expect(recording.named("createTexture")).toHaveLength(0);
  });

  it("keeps a clip's texture across renders and releases it once the clip is gone", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);
    render(compositor, scene, 0, framesFor("clp_1"));
    render(compositor, scene, 0, framesFor("clp_1"));
    expect(recording.named("createTexture")).toHaveLength(1);
    expect(recording.named("deleteTexture")).toHaveLength(0);
    render(compositor, project([[{ id: "clp_2" }]]), 0, framesFor("clp_2"));
    expect(recording.named("deleteTexture")).toHaveLength(1);
  });

  it("builds its program once and reuses it", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);
    render(compositor, scene, 0, framesFor("clp_1"));
    render(compositor, scene, 0, framesFor("clp_1"));
    expect(recording.named("createProgram")).toHaveLength(1);
  });

  it("gives up on a lost context instead of drawing into dead handles", () => {
    const lost = { current: false };
    const { compositor, recording, canvas } = attached({ isContextLost: () => lost.current });
    render(compositor, project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    lost.current = true;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    render(compositor, project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    expect(recording.named("drawArrays")).toHaveLength(1);
    // The handles died with the context; deleting them would be a GL error on a foreign object.
    expect(recording.named("deleteTexture")).toHaveLength(0);
  });

  it("rebuilds everything once the context is back", () => {
    const lost = { current: false };
    const { compositor, recording, canvas } = attached({ isContextLost: () => lost.current });
    render(compositor, project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    lost.current = true;
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    lost.current = false;
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    render(compositor, project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    expect(recording.named("createProgram")).toHaveLength(2);
    expect(recording.named("createTexture")).toHaveLength(2);
    expect(recording.named("drawArrays")).toHaveLength(2);
  });

  it("releases every handle it owns on dispose", () => {
    const { compositor, recording } = attached();
    render(compositor, project([[{ id: "clp_1" }, { id: "clp_2" }]]), 0, framesFor("clp_1", "clp_2"));
    compositor.dispose();
    expect(recording.named("deleteTexture")).toHaveLength(2);
    expect(recording.named("deleteProgram")).toHaveLength(1);
    expect(recording.named("deleteBuffer")).toHaveLength(1);
    expect(recording.named("deleteVertexArray")).toHaveLength(1);
  });

  it("reads back exactly the pixels the drawing buffer holds", () => {
    const { compositor, recording } = attached({ drawingBufferWidth: 4, drawingBufferHeight: 3 });
    const pixels = compositor.readPixels();
    expect(pixels).toHaveLength(4 * 3 * 4);
    expect(recording.named("readPixels")[0]?.args.slice(0, 4)).toEqual([0, 0, 4, 3]);
  });

  // The canvas can change size without anyone calling resize -- a devicePixelRatio change does
  // it. Asking the drawing buffer every frame costs one query and cannot go stale.
  it("takes the viewport from the drawing buffer, not from a remembered size", () => {
    const buffer = { width: 8, height: 8 };
    const { compositor, recording } = attached({
      get drawingBufferWidth() {
        return buffer.width;
      },
      get drawingBufferHeight() {
        return buffer.height;
      },
    });
    buffer.width = 320;
    buffer.height = 180;
    render(compositor, project([[{ id: "clp_1" }]]), 0, framesFor("clp_1"));
    expect(recording.named("viewport")[0]?.args).toEqual([0, 0, 320, 180]);
  });

  // A frame the FrameCache closed between the tick and this call uploads as an INVALID_OPERATION
  // that nothing throws on: the texture keeps the previous frame, or -- if it never had one --
  // samples as opaque black over everything below it.
  it("leaves a clip out rather than uploading a frame that is already closed", () => {
    const { compositor, recording } = attached();
    const frames = new Map([["clp_1", opaqueFrame({ format: null })]]);
    render(compositor, project([[{ id: "clp_1" }]]), 0, frames);
    expect(recording.named("texImage2D")).toHaveLength(0);
    expect(recording.named("drawArrays")).toHaveLength(0);
  });

  it("leaves out a frame the driver cannot hold, instead of a black rectangle", () => {
    const { compositor, recording } = attached({ getParameter: () => 4096 });
    const frames = new Map([["clp_1", opaqueFrame({ codedWidth: 7680, codedHeight: 4320 })]]);
    render(compositor, project([[{ id: "clp_1" }]]), 0, frames);
    expect(recording.named("texImage2D")).toHaveLength(0);
    expect(recording.named("drawArrays")).toHaveLength(0);
  });

  // subtract computes 1 - 1 on the alpha channel as readily as on the colour channels, and an
  // alpha of zero on a premultiplied canvas is a hole the page shows through.
  it("composites the alpha channel as a plain over-operator whatever the colours do", () => {
    for (const blend of ["normal", "multiply", "screen", "add", "subtract", "lighten", "darken"]) {
      const { compositor, recording } = attached();
      render(compositor, project([[{ id: "clp_1", blend }]]), 0, framesFor("clp_1"));
      expect(recording.named("blendFuncSeparate")[0]?.args.slice(2)).toEqual([1, 0x0303]);
      expect(recording.named("blendEquationSeparate")[0]?.args[1]).toBe(0x8006);
    }
  });

  // Task 14 unmounts the preview and a queued animation frame arrives afterwards. Without this,
  // render rebuilds everything it just deleted and leaks it, deaf to the next context loss.
  it("stays disposed", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);
    render(compositor, scene, 0, framesFor("clp_1"));
    compositor.dispose();
    render(compositor, scene, 0, framesFor("clp_1"));
    compositor.dispose();
    expect(recording.named("createProgram")).toHaveLength(1);
    expect(recording.named("drawArrays")).toHaveLength(1);
    expect(recording.named("deleteProgram")).toHaveLength(1);
    expect(compositor.readPixels()).toHaveLength(0);
  });

  // A clip whose frame is late for one tick must not cost eight megabytes of reallocation.
  it("keeps the texture of a clip that is still in the picture but had no frame this tick", () => {
    const { compositor, recording } = attached();
    const scene = project([[{ id: "clp_1" }]]);
    render(compositor, scene, 0, framesFor("clp_1"));
    render(compositor, scene, 0, new Map());
    render(compositor, scene, 0, framesFor("clp_1"));
    expect(recording.named("deleteTexture")).toHaveLength(0);
    expect(recording.named("createTexture")).toHaveLength(1);
  });
});
