import { blendState, drawList } from "./draw-list";
import { compileProgram, setUniforms } from "./program";

import type { Project, Time } from "@videola/core";
import type { GlContext } from "./context";
import type { DrawItem } from "./draw-list";

const VERTEX_SOURCE = `#version 300 es
in vec2 a_quad;
uniform mat3 u_matrix;
uniform vec4 u_uv;
out vec2 v_uv;

void main() {
  v_uv = u_uv.xy + a_quad * u_uv.zw;
  gl_Position = vec4((u_matrix * vec3(a_quad, 1.0)).xy, 0.0, 1.0);
}
`;

// The texture holds straight alpha, the blend state expects premultiplied, and the multiplication
// happens here rather than on upload: a straight source through ONE_MINUS_SRC_ALPHA mixes the
// edge of a clip towards the background twice, which is the grey seam around every overlay.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_opacity;
out vec4 color;

void main() {
  vec4 texel = texture(u_source, v_uv);
  float alpha = texel.a * u_opacity;
  color = vec4(texel.rgb * alpha, alpha);
}
`;

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

const ONE = 1;
const ONE_MINUS_SRC_ALPHA = 0x0303;
const FUNC_ADD = 0x8006;

// `format` is null on a closed frame and the one property that stays defined there, so it is the
// liveness probe; the coded size is only meaningful once that passed. A frame past the driver's
// limit uploads as INVALID_VALUE and leaves an incomplete texture, which samples as opaque black
// -- 8K from a phone camera is not an exotic input.
function uploadable(frame: VideoFrame, maxTextureSize: number): boolean {
  if (frame.format === null) return false;
  return frame.codedWidth <= maxTextureSize && frame.codedHeight <= maxTextureSize;
}

interface Resources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
}

// Walks the draw list and nothing else. It never decides which clips are visible and never asks
// for a frame.
//
// The contract on `frames`: every frame must stay open for the duration of the call. The
// FrameCache owns them and is free to close one at any time, and an upload from a closed frame
// fails as an INVALID_OPERATION that nothing throws on -- the texture then keeps the previous
// frame, or, if it never had one, samples as opaque black over everything below it. `#draw`
// therefore checks each frame before uploading. That check is the last line of defence, not the
// contract: a caller that lets frames die mid-render loses the clip for that frame either way.
//
// Nothing here keeps a frame past the call. texImage2D copies the pixels, so the texture outlives
// the frame it came from -- and a closed frame reports zero for its size, which is why the size
// is only ever read after `format` has confirmed the frame is alive.
export class Compositor {
  #gl: WebGL2RenderingContext;
  #maxTextureSize: number;
  #textures = new Map<string, WebGLTexture>();
  #resources: Resources | undefined;
  #disposed = false;
  #unsubscribe: () => void;

  constructor(context: GlContext) {
    this.#gl = context.gl;
    this.#maxTextureSize = context.maxTextureSize;
    this.#unsubscribe = context.onLost(() => this.#forget());
  }

  render(project: Project, at: Time, frames: ReadonlyMap<string, VideoFrame>): void {
    if (this.#disposed || this.#gl.isContextLost()) return;
    const list = drawList(project, at);
    const program = this.#begin(list.background);
    for (const item of list.items) {
      const frame = frames.get(item.clip);
      if (frame !== undefined && uploadable(frame, this.#maxTextureSize)) {
        this.#draw(program, item, frame);
      }
    }
    this.#release(new Set(list.items.map((item) => item.clip)));
  }

  resize(width: number, height: number): void {
    const canvas = this.#gl.canvas as { width: number; height: number };
    canvas.width = width;
    canvas.height = height;
  }

  // Rows come back bottom-up, the way GL stores them. Anything that hashes or encodes this has to
  // agree on that with whatever it compares against.
  readPixels(): Uint8Array {
    const gl = this.#gl;
    if (this.#disposed) return new Uint8Array(0);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  // Final. A preview component that unmounts still has an animation frame in flight, and without
  // the flag the next render would rebuild everything this just deleted -- and leak it, because
  // the subscription that would have dropped the handles is gone.
  dispose(): void {
    this.#disposed = true;
    const gl = this.#gl;
    for (const texture of this.#textures.values()) gl.deleteTexture(texture);
    this.#textures.clear();
    if (this.#resources !== undefined) {
      gl.deleteProgram(this.#resources.program);
      gl.deleteBuffer(this.#resources.buffer);
      gl.deleteVertexArray(this.#resources.vao);
      this.#resources = undefined;
    }
    this.#unsubscribe();
  }

  #begin(background: readonly [number, number, number, number]): WebGLProgram {
    const gl = this.#gl;
    const resources = this.#resources ?? this.#build();
    // Asked for per frame: a devicePixelRatio change resizes the canvas without anyone calling
    // resize, and a remembered size would leave the viewport on part of the buffer.
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(background[0], background[1], background[2], background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.useProgram(resources.program);
    gl.bindVertexArray(resources.vao);
    return resources.program;
  }

  #draw(program: WebGLProgram, item: DrawItem, frame: VideoFrame): void {
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture(item.clip));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    const blend = blendState(item.blend);
    // The alpha channel is always a plain over-operator, whatever the colours do. Letting the
    // colour equation touch alpha lets subtract compute 1 - 1 = 0, and a transparent hole in a
    // premultiplied canvas is the page shining through the picture.
    gl.blendEquationSeparate(blend.equation, FUNC_ADD);
    gl.blendFuncSeparate(blend.src, blend.dst, ONE, ONE_MINUS_SRC_ALPHA);
    setUniforms(gl, program, { u_matrix: item.matrix, u_uv: item.uv, u_opacity: item.opacity });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  #texture(clip: string): WebGLTexture {
    const existing = this.#textures.get(clip);
    if (existing !== undefined) return existing;
    const gl = this.#gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.#textures.set(clip, texture);
    return texture;
  }

  // A texture per clip that was ever visible adds up to eight megabytes each at 1080p, so a long
  // timeline would fill the GPU by scrubbing through it once. The measure is the draw list, not
  // what was drawn: a clip whose frame is late for one tick is still in the picture.
  #release(visible: ReadonlySet<string>): void {
    for (const [clip, texture] of this.#textures) {
      if (visible.has(clip)) continue;
      this.#gl.deleteTexture(texture);
      this.#textures.delete(clip);
    }
  }

  #build(): Resources {
    const gl = this.#gl;
    // The frame arrives as BT.709 with a limited range far more often than not. Converting it in
    // a shader of our own would compete with the conversion the browser already performs from the
    // frame's own VideoColorSpace on upload, and two conversions are worse than the one that
    // knows the metadata. BROWSER_DEFAULT_WEBGL is that one; NONE would hand us raw YUV.
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // The unit quad runs top-down and so does the texture, so nothing needs flipping here.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const program = compileProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    gl.useProgram(program);
    // The sampler is the one uniform that never changes, so it is bound once and stays out of the
    // per-frame uniform path, where every value is a float.
    gl.uniform1i(gl.getUniformLocation(program, "u_source"), 0);
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    const quad = gl.getAttribLocation(program, "a_quad");
    gl.enableVertexAttribArray(quad);
    gl.vertexAttribPointer(quad, 2, gl.FLOAT, false, 0, 0);
    this.#resources = { program, buffer, vao };
    return this.#resources;
  }

  // Everything the driver held is gone with the context, so the handles are dropped rather than
  // deleted -- deleting them would address objects of whatever context comes next.
  #forget(): void {
    this.#textures.clear();
    this.#resources = undefined;
  }
}
