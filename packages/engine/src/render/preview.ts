import { previewValues } from "../effects/registry";
import { SCREEN_VERTEX_SOURCE } from "./compositor";
import { createContext } from "./context";
import { compileProgram, setUniforms } from "./program";
import { RenderTarget } from "./target";

import type { EffectManifest, Uniform } from "../effects/registry";
import type { GlContext } from "./context";

/**
 * The picture a tile falls back to when the timeline has no frame to offer, and the second input
 * every transition tile mixes towards.
 *
 * Generated rather than shipped, and generated to be worked on: a hue sweep across so temperature
 * and saturation have colour to move, a fall in brightness down so contrast and the vignette have
 * range, hard vertical bars so the two kernels have an edge to find, and a full green somewhere
 * along the sweep so the chroma key has something to cut. A picture that lacked any of those would
 * give one of the effects a tile that shows nothing and blame the effect.
 */
export function referencePicture(width: number, height: number, hueShift = 0): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("error.canvas2dUnavailable");
  const image = context.createImageData(width, height);
  const barWidth = Math.max(1, Math.round(width / 14));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const across = width === 1 ? 0 : x / (width - 1);
      const down = height === 1 ? 0 : y / (height - 1);
      const bar = Math.floor(x / barWidth) % 2 === 0 ? 1 : 0.68;
      const [r, g, b] = fromHue((across * 300 + hueShift) % 360, 0.85, (1 - 0.6 * down) * bar);
      const at = (y * width + x) * 4;
      image.data[at] = Math.round(r * 255);
      image.data[at + 1] = Math.round(g * 255);
      image.data[at + 2] = Math.round(b * 255);
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function fromHue(hue: number, saturation: number, value: number): [number, number, number] {
  const sector = hue / 60;
  const rise = value * saturation * (1 - Math.abs((sector % 2) - 1));
  const peak = value;
  const floor = value * (1 - saturation);
  const wheel: [number, number, number][] = [
    [peak, floor + rise, floor],
    [floor + rise, peak, floor],
    [floor, peak, floor + rise],
    [floor, floor + rise, peak],
    [floor + rise, floor, peak],
    [peak, floor, floor + rise],
  ];
  return wheel[Math.floor(sector) % 6] ?? [value, value, value];
}

/**
 * One effect over one still picture, at the size of a tile.
 *
 * The point of it is that a tile is not a drawing of what the effect is supposed to do: it is the
 * effect's own fragment shader, over a real frame, through the same screen quad and the same uniform
 * convention the editor uses. What the browser promises is therefore what the timeline delivers,
 * and an effect whose shader stops working stops having a tile.
 *
 * The cost is why this is a class rather than a function: the context, the compiled programs and the
 * scratch target are what a tile is expensive to set up and cheap to draw into. A 192x108 tile is
 * twenty thousand fragments, so the whole library together stays under a fifth of one 1080p frame.
 * The decode that produces the source picture is the expensive half, and there is one of those for
 * the whole grid.
 */
export class EffectPreview {
  #canvas: OffscreenCanvas;
  #context: GlContext;
  #gl: WebGL2RenderingContext;
  #pipelines = new Map<string, { program: WebGLProgram; vao: WebGLVertexArrayObject }>();
  #buffer: WebGLBuffer;
  #textures: [WebGLTexture, WebGLTexture];
  // One, not the compositor's pair: `passes` is at most two, so the second sweep already draws onto
  // the canvas and never needs somewhere else to land.
  #target: RenderTarget | undefined;
  #disposed = false;

  constructor(width: number, height: number) {
    this.#canvas = new OffscreenCanvas(width, height);
    // `readable`, because convertToBlob and a pixel check are both reads, and without it the
    // browser is free to have cleared the buffer by the time either happens.
    this.#context = createContext(this.#canvas, { readable: true });
    const gl = this.#context.gl;
    this.#gl = gl;
    // A still picture arrives with straight alpha and rows running down, and both are turned here
    // rather than in a shader: the chain downstream of this expects premultiplied texels, and
    // `v_uv` runs UP the picture, so an unflipped upload draws every tile on its head. The
    // compositor premultiplies in its clip shader instead only because a VideoFrame upload has its
    // own colour conversion to keep out of the way of.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.#buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.#textures = [this.#makeTexture(), this.#makeTexture()];
  }

  get canvas(): OffscreenCanvas {
    return this.#canvas;
  }

  /**
   * Draws `manifest` over `source` with the settings the manifest itself nominates. A transition
   * also samples `second`, which is the picture it is coming from -- the outgoing clip in the
   * timeline, the reference picture in the browser.
   */
  render(manifest: EffectManifest, source: TexImageSource, second?: TexImageSource): void {
    if (this.#disposed) return;
    const gl = this.#gl;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    this.#upload(this.#textures[0], source);
    if (manifest.inputs === 2) {
      // A transition with nothing to come from would mix the picture with an empty texture, which
      // samples as transparent black -- a tile that fades to nothing and claims that is the effect.
      this.#upload(this.#textures[1], second ?? source);
    }
    const values = previewValues(manifest);
    const sweeps = manifest.passes ?? 1;
    // No blending anywhere: a pass replaces what it draws over. Blending the output onto the canvas
    // would composite the tile with itself and turn every half-transparent mask opaque.
    gl.disable(gl.BLEND);
    let input = this.#textures[0];
    for (let sweep = 0; sweep < sweeps; sweep += 1) {
      const last = sweep === sweeps - 1;
      if (last) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else {
        this.#scratch().bind(width, height);
      }
      this.#pass(manifest, input, sweeps === 1 ? values : { ...values, pass: sweep });
      if (!last) input = this.#scratch().texture;
    }
  }

  /** The tile as a picture. PNG, because a mask's transparency is the point and JPEG has none. */
  async toBlob(): Promise<Blob> {
    return await this.#canvas.convertToBlob({ type: "image/png" });
  }

  /** Rows bottom-up, the way GL stores them -- the same reading as `Compositor.readPixels`. */
  readPixels(): Uint8Array {
    const gl = this.#gl;
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    return pixels;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const gl = this.#gl;
    for (const pipeline of this.#pipelines.values()) {
      gl.deleteProgram(pipeline.program);
      gl.deleteVertexArray(pipeline.vao);
    }
    this.#pipelines.clear();
    for (const texture of this.#textures) gl.deleteTexture(texture);
    this.#target?.dispose();
    this.#target = undefined;
    gl.deleteBuffer(this.#buffer);
    this.#context.dispose();
  }

  #pass(
    manifest: EffectManifest,
    source: WebGLTexture,
    values: Readonly<Record<string, Uniform>>,
  ): void {
    const gl = this.#gl;
    const pipeline = this.#pipeline(manifest);
    gl.useProgram(pipeline.program);
    gl.bindVertexArray(pipeline.vao);
    if (manifest.inputs === 2) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.#textures[1]);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    const uniforms: Record<string, Uniform> = {};
    for (const [key, value] of Object.entries(values)) uniforms[`u_${key}`] = value;
    setUniforms(gl, pipeline.program, uniforms);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  #pipeline(manifest: EffectManifest): { program: WebGLProgram; vao: WebGLVertexArrayObject } {
    const existing = this.#pipelines.get(manifest.id);
    if (existing !== undefined) return existing;
    const gl = this.#gl;
    const program = compileProgram(gl, SCREEN_VERTEX_SOURCE, manifest.fragmentSource);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_source"), 0);
    if (manifest.inputs === 2) gl.uniform1i(gl.getUniformLocation(program, "u_second"), 1);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer);
    const quad = gl.getAttribLocation(program, "a_quad");
    gl.enableVertexAttribArray(quad);
    gl.vertexAttribPointer(quad, 2, gl.FLOAT, false, 0, 0);
    const pipeline = { program, vao };
    this.#pipelines.set(manifest.id, pipeline);
    return pipeline;
  }

  #scratch(): RenderTarget {
    this.#target ??= new RenderTarget(this.#gl);
    return this.#target;
  }

  #upload(texture: WebGLTexture, picture: TexImageSource): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
  }

  #makeTexture(): WebGLTexture {
    const gl = this.#gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
}
