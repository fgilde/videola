import { effect } from "../effects/registry";
import { blendState, drawList } from "./draw-list";
import { IDENTITY_LUT, LUT_UNIT, TEXTURE_3D, uploadLut } from "./lut";
import { compileProgram, setUniforms } from "./program";
import { RenderTarget } from "./target";

import type { EffectParamSnapshot, Project, Time, TransformSnapshot } from "@videola/core";
import type { LutTable } from "@videola/media";
import type { Uniform } from "../effects/registry";
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
//
// This is also where the effect chain gets its input, which is why everything downstream of this
// shader -- every pass, every intermediate target -- carries premultiplied alpha.
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

// The same unit quad, stretched over the whole target: what every pass of the effect chain draws.
// Exported because the browser's preview tiles run the same passes over a still picture, and a
// second copy of this is how `v_uv` would come to run one way in the editor and the other in the
// tile that claims to show it.
export const SCREEN_VERTEX_SOURCE = `#version 300 es
in vec2 a_quad;
out vec2 v_uv;

void main() {
  v_uv = a_quad;
  gl_Position = vec4(a_quad * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Closes the chain: opacity is applied here, after the effects and before the blend, which is the
// order the frame graph prescribes. A plain scale of all four channels is what opacity means on
// premultiplied colour.
const COMPOSITE_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_opacity;
out vec4 color;

void main() {
  color = texture(u_source, v_uv) * u_opacity;
}
`;

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

const NO_LUTS: ReadonlyMap<string, LutTable> = new Map();

// The key the identity table is held under. No media id is ever the empty string -- one is `med_`
// and sixty-four hex digits -- so it cannot collide with a table somebody loaded.
const IDENTITY = "";

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

interface Pipeline {
  program: WebGLProgram;
  // One per program rather than one shared: a vertex array remembers the attribute *index* it was
  // set up for, and two programs need not put `a_quad` in the same one.
  vao: WebGLVertexArrayObject;
}

interface Resources {
  buffer: WebGLBuffer;
  clip: Pipeline;
}

// Walks the draw list and nothing else. It never decides which clips are visible, never asks for a
// frame, and never works out a parameter value -- all three arrive decided.
//
// The contract on `frames`: every frame must stay open for the duration of the call. The
// FrameCache owns them and is free to close one at any time, and an upload from a closed frame
// fails as an INVALID_OPERATION that nothing throws on -- the texture then keeps the previous
// frame, or, if it never had one, samples as opaque black over everything below it. `#drawQuad`
// therefore checks each frame before uploading. That check is the last line of defence, not the
// contract: a caller that lets frames die mid-render gets the previous picture for that clip, and
// nothing at all if there was no previous one.
//
// Nothing here keeps a frame past the call. texImage2D copies the pixels, so the texture outlives
// the frame it came from -- and a closed frame reports zero for its size, which is why the size
// is only ever read after `format` has confirmed the frame is alive.
export class Compositor {
  #gl: WebGL2RenderingContext;
  #maxTextureSize: number;
  #textures = new Map<string, WebGLTexture>();
  #effects = new Map<string, Pipeline>();
  #screen: Pipeline | undefined;
  #chain: RenderTarget[] = [];
  // Built on first use, like everything else here: a project nobody is measuring never makes one.
  #scope: RenderTarget | undefined;
  #mirror: WebGLTexture | undefined;
  // Keyed by media id, plus one under the empty string for the identity. Uploaded on first sight
  // and kept until nothing names them, the same measure the clip textures are held by.
  #lutTextures = new Map<string, WebGLTexture>();
  #resources: Resources | undefined;
  #disposed = false;
  #unsubscribe: () => void;

  constructor(context: GlContext) {
    this.#gl = context.gl;
    this.#maxTextureSize = context.maxTextureSize;
    this.#unsubscribe = context.onLost(() => this.#forget());
  }

  /**
   * `luts` is the same kind of contract as `frames`: the tables arrive decided, keyed by the media
   * id a grade names, and this walks the list rather than fetching anything. Both callers that
   * draw a timeline -- the editor's playback and the export worker -- fill it from the same store
   * out of the same OPFS entries, which is what makes the file and the preview the same picture.
   * A grade whose table is missing draws through the identity, so a broken import is the untouched
   * clip rather than a black one.
   */
  render(
    project: Project,
    at: Time,
    frames: ReadonlyMap<string, VideoFrame>,
    params: EffectParamSnapshot,
    transforms: TransformSnapshot,
    luts: ReadonlyMap<string, LutTable> = NO_LUTS,
  ): void {
    if (this.#disposed || this.#gl.isContextLost()) return;
    const list = drawList(project, at, params, transforms);
    const resources = this.#resources ?? this.#build();
    this.#lutSlots(luts);
    this.#begin(list.background);
    for (const item of list.items) {
      const frame = frames.get(item.clip);
      const fresh = frame !== undefined && uploadable(frame, this.#maxTextureSize);
      // A frame that is late must not blank the clip. texImage2D copied the last one into the
      // texture, so redrawing without an upload holds the picture instead of punching a hole for
      // one tick -- and a clip that never had a frame is still left out, because its texture would
      // sample as opaque black.
      if (!fresh && !this.#textures.has(item.clip)) continue;
      const source = fresh ? frame : undefined;
      if (item.effects.length === 0 && item.mix === undefined) {
        this.#composite(resources, item, source);
      } else {
        this.#chained(resources, item, source);
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

  /**
   * The same picture, smaller: what a measuring instrument reads.
   *
   * A scope needs numbers about the frame, not the frame, and the frame is the expensive part.
   * `readPixels` stalls until the driver has finished and then copies the whole drawing buffer
   * across the bus -- eight megabytes at 1080p, thirty times a second if anything asks per frame.
   * The blit does the shrinking on the GPU and leaves a fraction of that to copy: at 256 by 144 it
   * is 147 kilobytes, one part in fifty-six.
   *
   * NEAREST and not LINEAR, and that is the whole difference between a measurement and a picture.
   * Averaging four neighbours invents values no pixel had: a single clipped highlight in a dark
   * field averages down into a midtone and the scope stops reporting the one thing it exists to
   * report. Nearest keeps real pixel values and simply reads fewer of them, which is a sample of
   * the picture rather than a smoothed version of it.
   *
   * ponytail: the read is still synchronous, so it waits for the GPU. A PIXEL_PACK_BUFFER with a
   * fence read a frame late would not wait at all -- worth it if a scope ever has to keep up with
   * playback rather than with a person looking at it.
   */
  sample(width: number, height: number): Uint8Array {
    const gl = this.#gl;
    if (this.#disposed || gl.isContextLost() || width <= 0 || height <= 0) return new Uint8Array(0);
    const target = (this.#scope ??= new RenderTarget(gl));
    target.bind(width, height);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      0,
      0,
      width,
      height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    // Back to the small target, or the read below would take its pixels from the drawing buffer
    // the blit just read -- which is the full-size copy this exists to avoid.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    for (const target of this.#chain) target.dispose();
    this.#scope?.dispose();
    this.#scope = undefined;
    for (const pipeline of this.#effects.values()) this.#discard(pipeline);
    if (this.#mirror !== undefined) gl.deleteTexture(this.#mirror);
    for (const texture of this.#lutTextures.values()) gl.deleteTexture(texture);
    this.#lutTextures.clear();
    this.#chain = [];
    this.#effects.clear();
    this.#mirror = undefined;
    if (this.#screen !== undefined) this.#discard(this.#screen);
    this.#screen = undefined;
    if (this.#resources !== undefined) {
      this.#discard(this.#resources.clip);
      gl.deleteBuffer(this.#resources.buffer);
      this.#resources = undefined;
    }
    this.#unsubscribe();
  }

  #begin(background: readonly [number, number, number, number]): void {
    const gl = this.#gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Asked for per frame: a devicePixelRatio change resizes the canvas without anyone calling
    // resize, and a remembered size would leave the viewport on part of the buffer.
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(background[0], background[1], background[2], background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // No effects and no transition: straight onto the picture, which is every clip in a project
  // nobody has touched yet and the path worth keeping cheap.
  #composite(resources: Resources, item: DrawItem, frame: VideoFrame | undefined): void {
    this.#blend(item);
    this.#drawQuad(resources, item, frame, item.opacity);
  }

  // The frame graph for one clip: source texture, effect chain into an intermediate target, then
  // opacity and blend onto the picture -- or, while a transition runs, a mix with the picture the
  // frame already holds.
  #chained(resources: Resources, item: DrawItem, frame: VideoFrame | undefined): void {
    const gl = this.#gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const [first, second] = this.#targets();
    gl.disable(gl.BLEND);
    first.bind(width, height);
    this.#drawQuad(resources, item, frame, 1);

    let source = first;
    let spare = second;
    for (const pass of item.effects) {
      spare.bind(width, height);
      this.#pass(this.#pipeline(pass.effect), source.texture, undefined, pass.values, pass.lut);
      [source, spare] = [spare, source];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    const mix = item.mix;
    if (mix === undefined) {
      this.#blend(item);
      const screen = this.#screenPass(resources.buffer);
      this.#pass(screen, source.texture, undefined, { opacity: item.opacity });
      return;
    }
    // The transition's second input is what is already on the screen, so it has to be copied off
    // it: a pass cannot sample the buffer it draws into. Blending stays off -- the mix already
    // carries the picture underneath, and blending it over that picture would count it twice.
    this.#pass(this.#pipeline(mix.effect), source.texture, this.#copy(), mix.values, mix.lut);
  }

  #pass(
    pipeline: Pipeline,
    source: WebGLTexture,
    second: WebGLTexture | undefined,
    values: Readonly<Record<string, Uniform>>,
    lut?: string,
  ): void {
    const gl = this.#gl;
    gl.useProgram(pipeline.program);
    gl.bindVertexArray(pipeline.vao);
    if (second !== undefined) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, second);
    }
    // Bound whenever the pass declares a table, whether or not one is loaded: a sampler left on an
    // empty unit reads as opaque black, so "nothing chosen" has to be the identity table rather
    // than no texture at all.
    if (lut !== undefined) {
      gl.activeTexture(gl.TEXTURE0 + LUT_UNIT);
      gl.bindTexture(TEXTURE_3D, this.#lutTexture(lut));
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    setUniforms(gl, pipeline.program, prefixed(values));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  #blend(item: DrawItem): void {
    const gl = this.#gl;
    const blend = blendState(item.blend);
    gl.enable(gl.BLEND);
    // The alpha channel is always a plain over-operator, whatever the colours do. Letting the
    // colour equation touch alpha lets subtract compute 1 - 1 = 0, and a transparent hole in a
    // premultiplied canvas is the page shining through the picture.
    gl.blendEquationSeparate(blend.equation, FUNC_ADD);
    gl.blendFuncSeparate(blend.src, blend.dst, ONE, ONE_MINUS_SRC_ALPHA);
  }

  #drawQuad(
    resources: Resources,
    item: DrawItem,
    frame: VideoFrame | undefined,
    opacity: number,
  ): void {
    const gl = this.#gl;
    gl.useProgram(resources.clip.program);
    gl.bindVertexArray(resources.clip.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.#texture(item.clip));
    if (frame !== undefined) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    }
    setUniforms(gl, resources.clip.program, {
      u_matrix: item.matrix,
      u_uv: item.uv,
      u_opacity: opacity,
    });
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

  // ponytail: two full-size targets for as long as any clip carries an effect, and they stay
  // allocated until the context goes. At 1080p that is sixteen megabytes; a pool that hands them
  // back when no clip needs one is what a timeline full of effects would want.
  #targets(): [RenderTarget, RenderTarget] {
    if (this.#chain.length === 0) {
      this.#chain = [new RenderTarget(this.#gl), new RenderTarget(this.#gl)];
    }
    return [this.#chain[0]!, this.#chain[1]!];
  }

  // Uploads the tables that are new and lets go of the ones nothing names any more. A media id is
  // the hash of the file's bytes, so an id that is already here cannot have come to mean a
  // different table -- which is what makes "have I seen this id" a sound test for "is this texture
  // current".
  #lutSlots(luts: ReadonlyMap<string, LutTable>): void {
    const gl = this.#gl;
    for (const [id, table] of luts) {
      if (this.#lutTextures.has(id)) continue;
      const texture = gl.createTexture();
      uploadLut(gl, texture, table);
      this.#lutTextures.set(id, texture);
    }
    for (const [id, texture] of this.#lutTextures) {
      if (id === IDENTITY || luts.has(id)) continue;
      gl.deleteTexture(texture);
      this.#lutTextures.delete(id);
    }
  }

  // The named table if it is loaded, the identity otherwise -- which covers both "nothing chosen"
  // and "the file behind this grade could not be read". Either way the clip comes out as it went
  // in, which is the honest answer; a black clip would not be.
  #lutTexture(id: string): WebGLTexture {
    const named = this.#lutTextures.get(id);
    if (named !== undefined) return named;
    const existing = this.#lutTextures.get(IDENTITY);
    if (existing !== undefined) return existing;
    const texture = this.#gl.createTexture();
    uploadLut(this.#gl, texture, IDENTITY_LUT);
    this.#lutTextures.set(IDENTITY, texture);
    return texture;
  }

  #copy(): WebGLTexture {
    const gl = this.#gl;
    this.#mirror ??= gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.#mirror);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Reallocating with the copy rather than sizing it separately: the drawing buffer is the only
    // size this can ever be, and asking for it twice is how the two drift apart.
    gl.copyTexImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      0,
    );
    return this.#mirror;
  }

  #pipeline(type: string): Pipeline {
    const existing = this.#effects.get(type);
    if (existing !== undefined) return existing;
    const manifest = effect(type);
    // The draw list only ever names an effect the registry answered for, so this is a broken
    // build rather than a broken project.
    if (manifest === undefined) throw new Error(`no such effect: ${type}`);
    const buffer = (this.#resources ?? this.#build()).buffer;
    const pipeline = this.#link(
      buffer,
      SCREEN_VERTEX_SOURCE,
      manifest.fragmentSource,
      manifest.inputs,
    );
    this.#effects.set(type, pipeline);
    return pipeline;
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
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    this.#resources = { buffer, clip: this.#link(buffer, VERTEX_SOURCE, FRAGMENT_SOURCE, 1) };
    return this.#resources;
  }

  // Built on first use like the effect programs themselves: a project without a single effect
  // never runs a pass and has no business compiling a shader for one.
  #screenPass(buffer: WebGLBuffer): Pipeline {
    this.#screen ??= this.#link(buffer, SCREEN_VERTEX_SOURCE, COMPOSITE_SOURCE, 1);
    return this.#screen;
  }

  // The samplers are the uniforms that never change, so they are bound once here and stay out of
  // the per-frame path, where every value is a float.
  #link(
    buffer: WebGLBuffer,
    vertexSource: string,
    fragmentSource: string,
    inputs: number,
  ): Pipeline {
    const gl = this.#gl;
    const program = compileProgram(gl, vertexSource, fragmentSource);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_source"), 0);
    if (inputs === 2) gl.uniform1i(gl.getUniformLocation(program, "u_second"), 1);
    // Unconditional, and it needs no flag on the manifest: a program that never declares `u_table`
    // has no location for it, `getUniformLocation` answers null, and a null location is a no-op
    // the specification promises rather than an error.
    gl.uniform1i(gl.getUniformLocation(program, "u_table"), LUT_UNIT);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const quad = gl.getAttribLocation(program, "a_quad");
    gl.enableVertexAttribArray(quad);
    gl.vertexAttribPointer(quad, 2, gl.FLOAT, false, 0, 0);
    return { program, vao };
  }

  #discard(pipeline: Pipeline): void {
    this.#gl.deleteProgram(pipeline.program);
    this.#gl.deleteVertexArray(pipeline.vao);
  }

  // Everything the driver held is gone with the context, so the handles are dropped rather than
  // deleted -- deleting them would address objects of whatever context comes next.
  #forget(): void {
    this.#textures.clear();
    this.#lutTextures.clear();
    this.#effects.clear();
    this.#chain = [];
    this.#scope = undefined;
    this.#mirror = undefined;
    this.#screen = undefined;
    this.#resources = undefined;
  }
}

// The shader names its uniforms `u_<key>`, and that prefix is the whole convention between a
// manifest's parameter list and its GLSL.
function prefixed(values: Readonly<Record<string, Uniform>>): Record<string, Uniform> {
  const uniforms: Record<string, Uniform> = {};
  for (const [key, value] of Object.entries(values)) uniforms[`u_${key}`] = value;
  return uniforms;
}
