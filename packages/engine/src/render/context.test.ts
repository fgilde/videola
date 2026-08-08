import { describe, expect, it, vi } from "vitest";

import { createContext } from "./context";
import { recordingGl } from "./recording-gl";

function canvasReturning(value: unknown): {
  canvas: HTMLCanvasElement;
  attributes: () => WebGLContextAttributes;
} {
  const canvas = document.createElement("canvas");
  const getContext = vi.spyOn(canvas, "getContext").mockReturnValue(value as never);
  return {
    canvas,
    attributes: () => getContext.mock.calls[0]?.[1] as WebGLContextAttributes,
  };
}

function lossEvent(): Event {
  return new Event("webglcontextlost", { cancelable: true });
}

describe("createContext", () => {
  it("asks for a context that can composite translucent clips over each other", () => {
    const { canvas, attributes } = canvasReturning(recordingGl().gl);
    createContext(canvas);
    expect(attributes()).toMatchObject({
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      antialias: false,
    });
  });

  it("reads the texture limit from the driver", () => {
    const recording = recordingGl({ getParameter: vi.fn(() => 8192) });
    const { canvas } = canvasReturning(recording.gl);
    const context = createContext(canvas);
    expect(context.maxTextureSize).toBe(8192);
    expect(recording.gl.getParameter).toHaveBeenCalledWith(0x0d33);
  });

  it("fails with a catalog key when the device has no WebGL2", () => {
    const { canvas } = canvasReturning(null);
    expect(() => createContext(canvas)).toThrow("error.webglUnavailable");
  });

  // Without preventDefault the browser never fires webglcontextrestored, and every recovery path
  // built on top is dead code on the device that needed it.
  it("cancels the loss event so that the browser will restore the context", () => {
    const { canvas } = canvasReturning(recordingGl().gl);
    createContext(canvas);
    const event = lossEvent();
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("notifies its listeners about loss and about restoration", () => {
    const { canvas } = canvasReturning(recordingGl().gl);
    const context = createContext(canvas);
    const lost = vi.fn();
    const restored = vi.fn();
    context.onLost(lost);
    context.onRestored(restored);
    canvas.dispatchEvent(lossEvent());
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(lost).toHaveBeenCalledTimes(1);
    expect(restored).toHaveBeenCalledTimes(1);
  });

  it("stops notifying a listener that unsubscribed", () => {
    const { canvas } = canvasReturning(recordingGl().gl);
    const context = createContext(canvas);
    const lost = vi.fn();
    context.onLost(lost)();
    canvas.dispatchEvent(lossEvent());
    expect(lost).not.toHaveBeenCalled();
  });

  it("keeps notifying the other listeners when one of them throws", () => {
    const { canvas } = canvasReturning(recordingGl().gl);
    const context = createContext(canvas);
    const second = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    context.onLost(() => {
      throw new Error("boom");
    });
    context.onLost(second);
    canvas.dispatchEvent(lossEvent());
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("detaches from the canvas and releases the driver context on dispose", () => {
    const loseContext = vi.fn();
    const recording = recordingGl({ getExtension: () => ({ loseContext }) });
    const { canvas } = canvasReturning(recording.gl);
    const context = createContext(canvas);
    const lost = vi.fn();
    context.onLost(lost);
    context.dispose();
    canvas.dispatchEvent(lossEvent());
    expect(lost).not.toHaveBeenCalled();
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
