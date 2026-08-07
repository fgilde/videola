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

interface Resources {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
}

// Walks the draw list and nothing else. It never decides which clips are visible, never asks for
// a frame and never reads one -- the frames belong to the FrameCache, which is free to close them
// the moment this call returns. texImage2D copies the pixels, so a texture outlives the frame it
// came from; holding the frame instead, or measuring it, is what breaks.
export class Compositor {
  #gl: WebGL2RenderingContext;
  #textures = new Map<string, WebGLTexture>();
  #resources: Resources | undefined;
  #width: number;
  #height: number;
  #unsubscribe: () => void;

  constructor(context: GlContext) {
    this.#gl = context.gl;
    this.#width = context.gl.drawingBufferWidth;
    this.#height = context.gl.drawingBufferHeight;
    this.#unsubscribe = context.onLost(() => this.#forget());
  }

  render(project: Project, at: Time, frames: ReadonlyMap<string, VideoFrame>): void {
    if (this.#gl.isContextLost()) return;
    const list = drawList(project, at);
    const program = this.#begin(list.background);
    const drawn = new Set<string>();
    for (const item of list.items) {
      const frame = frames.get(item.clip);
      if (frame === undefined) continue;
      this.#draw(program, item, frame);
      drawn.add(item.clip);
    }
    this.#release(drawn);
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    const canvas = this.#gl.canvas as { width: number; height: number };
    canvas.width = width;
    canvas.height = height;
  }

  // Rows come back bottom-up, the way GL stores them. Anything that hashes or encodes this has to
  // agree on that with whatever it compares against.
  readPixels(): Uint8Array {
    const pixels = new Uint8Array(this.#width * this.#height * 4);
    const gl = this.#gl;
    gl.readPixels(0, 0, this.#width, this.#height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  dispose(): void {
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
    gl.viewport(0, 0, this.#width, this.#height);
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
    gl.blendEquation(blend.equation);
    gl.blendFunc(blend.src, blend.dst);
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
  // timeline would fill the GPU by scrubbing through it once.
  #release(drawn: ReadonlySet<string>): void {
    for (const [clip, texture] of this.#textures) {
      if (drawn.has(clip)) continue;
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
