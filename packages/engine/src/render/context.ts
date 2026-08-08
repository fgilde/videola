export interface GlContext {
  gl: WebGL2RenderingContext;
  maxTextureSize: number;
  onLost(cb: () => void): () => void;
  onRestored(cb: () => void): () => void;
  dispose(): void;
}

const MAX_TEXTURE_SIZE = 0x0d33;

// premultipliedAlpha is true, against the plan's `false`. The compositor blends premultiplied --
// straight alpha through ONE_MINUS_SRC_ALPHA darkens every edge pixel of a clip towards the
// background, which is the grey fringe. Telling the page compositor `false` while handing it
// premultiplied pixels would undo that correctness at the last step.
const ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: "high-performance",
};

export function createContext(canvas: HTMLCanvasElement | OffscreenCanvas): GlContext {
  const gl = canvas.getContext("webgl2", ATTRIBUTES) as WebGL2RenderingContext | null;
  if (gl === null) throw new Error("error.webglUnavailable");
  const target = canvas as unknown as EventTarget;
  const lost = new Set<() => void>();
  const restored = new Set<() => void>();

  // A lost context is only ever restored if the loss event is cancelled. Without this line every
  // recovery path below is dead code, and the tab stays black after the driver hiccup that a
  // phone produces by switching apps.
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    emit(lost);
  };
  const onContextRestored = (): void => emit(restored);
  target.addEventListener("webglcontextlost", onContextLost);
  target.addEventListener("webglcontextrestored", onContextRestored);

  return {
    gl,
    maxTextureSize: gl.getParameter(MAX_TEXTURE_SIZE) as number,
    onLost: (cb) => subscribe(lost, cb),
    onRestored: (cb) => subscribe(restored, cb),
    dispose(): void {
      target.removeEventListener("webglcontextlost", onContextLost);
      target.removeEventListener("webglcontextrestored", onContextRestored);
      // Dropping the reference does not free the GPU memory; a browser keeps a limited number of
      // contexts alive and starts killing the oldest ones once that number is reached.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

function subscribe(listeners: Set<() => void>, cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// One consumer that throws while rebuilding its resources must not keep the others from
// rebuilding theirs -- the whole point of the notification is that everyone recovers.
function emit(listeners: ReadonlySet<() => void>): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch (error) {
      console.error(error);
    }
  }
}
