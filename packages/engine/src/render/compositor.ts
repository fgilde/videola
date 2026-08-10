import { effect } from "../effects/registry";
import { blendState, drawList, drawnClips, isGroup } from "./draw-list";
import { IDENTITY_LUT, LUT_UNIT, TEXTURE_3D, uploadLut } from "./lut";
import { compileProgram, setUniforms } from "./program";
import { RenderTarget } from "./target";

import type { EffectParamSnapshot, Project, Time, TransformSnapshot } from "@videola/core";
import type { LutTable } from "@videola/media";
import type { Uniform } from "../effects/registry";
import type { GlContext } from "./context";
import type { DrawGroup, DrawItem, DrawNode } from "./draw-list";
import type { Smear } from "./motion-blur";

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

// A group's picture is already in a render target, so it arrives premultiplied and must not be
// multiplied a second time -- and the target stores it the way the framebuffer holds it, first row
// at the bottom, which is upside down from everything `u_uv` describes. Flipping `v` here is what
// puts an isolated group back the right way up; every effect written so far was symmetric in y and
// would have hidden it.
const ISOLATED_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_opacity;
out vec4 color;

void main() {
  color = texture(u_source, vec2(v_uv.x, 1.0 - v_uv.y)) * u_opacity;
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
const NO_SMEAR: ReadonlyMap<string, readonly Smear[]> = new Map();

export class Compositor {
  #gl: WebGL2RenderingContext;
  #maxTextureSize: number;
  #textures = new Map<string, WebGLTexture>();
  #effects = new Map<string, Pipeline>();
  #screen: Pipeline | undefined;
  #place: Pipeline | undefined;
  #chain: (RenderTarget | undefined)[] = [];
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
    smear: ReadonlyMap<string, readonly Smear[]> = NO_SMEAR,
  ): void {
    if (this.#disposed || this.#gl.isContextLost()) return;
    const list = drawList(project, at, params, transforms);
    const resources = this.#resources ?? this.#build();
    this.#lutSlots(luts);
    this.#begin(list.background);
    this.#paint(resources, list.items, frames, undefined, 0, smear);
    this.#release(new Set(drawnClips(list)));
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
    for (const target of this.#chain) target?.dispose();
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
    if (this.#place !== undefined) this.#discard(this.#place);
    this.#place = undefined;
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

  // One level of the draw list onto one surface. `surface` is the drawing buffer at the top and an
  // isolated group's own target below that; `level` is how deep the recursion has come, and it is
  // what keeps two groups from taking turns in the same scratch target.
  #paint(
    resources: Resources,
    nodes: readonly DrawNode[],
    frames: ReadonlyMap<string, VideoFrame>,
    surface: RenderTarget | undefined,
    level: number,
    smear: ReadonlyMap<string, readonly Smear[]> = NO_SMEAR,
  ): void {
    for (const node of nodes) {
      if (isGroup(node)) {
        this.#isolate(resources, node, frames, surface, level, smear);
        continue;
      }
      const frame = frames.get(node.clip);
      const fresh = frame !== undefined && uploadable(frame, this.#maxTextureSize);
      // A smeared clip brings its pictures with its samples rather than in `frames`, so it counts as
      // having one: without this a clip that is only ever drawn from its exposure would be dropped
      // here for having no frame of its own.
      //
      // A smeared clip always takes the chained path. Its samples are averaged into a target of its
      // own and composited once: accumulated straight onto the surface, eight copies at an eighth of
      // the opacity would leave seven eighths of the background showing through an opaque clip.
      const exposure = smear.get(node.clip);
      const smeared = exposure !== undefined && exposure.length > 0;
      // A frame that is late must not blank the clip. texImage2D copied the last one into the
      // texture, so redrawing without an upload holds the picture instead of punching a hole for
      // one tick -- and a clip that never had a frame is still left out, because its texture would
      // sample as opaque black.
      if (!fresh && !smeared && !this.#textures.has(node.clip)) continue;
      const source = fresh ? frame : undefined;
      if (exposure === undefined && node.effects.length === 0 && node.mix === undefined) {
        this.#surface(surface);
        this.#blend(node);
        this.#drawQuad(resources, node, source, node.opacity);
        continue;
      }
      this.#chained(resources, node, source, surface, level, exposure);
    }
  }

  // The frame graph for one clip: source texture, effect chain into an intermediate target, then
  // opacity and blend onto the surface -- or, while a transition runs, a mix with the picture the
  // surface already holds.
  #chained(
    resources: Resources,
    item: DrawItem,
    frame: VideoFrame | undefined,
    surface: RenderTarget | undefined,
    level: number,
    exposure?: readonly Smear[],
  ): void {
    const gl = this.#gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const first = this.#slot(level * 2);
    const second = this.#slot(level * 2 + 1);
    gl.disable(gl.BLEND);
    first.bind(width, height);
    if (exposure === undefined || exposure.length === 0) {
      this.#drawQuad(resources, item, frame, 1);
    } else {
      this.#expose(resources, item, exposure);
    }

    let source = first;
    let spare = second;
    for (const pass of item.effects) {
      spare.bind(width, height);
      this.#pass(this.#pipeline(pass.effect), source.texture, undefined, pass.values, pass.lut);
      [source, spare] = [spare, source];
    }
    this.#finish(resources, item, source, surface);
  }

  // The composed group, once. Its items go onto a target of their own, and only then does the
  // group's placement, crop, chain, opacity and blend meet the picture they made -- which is the
  // whole of the difference to drawing the same items straight onto the surface.
  #isolate(
    resources: Resources,
    group: DrawGroup,
    frames: ReadonlyMap<string, VideoFrame>,
    surface: RenderTarget | undefined,
    level: number,
    smear: ReadonlyMap<string, readonly Smear[]> = NO_SMEAR,
  ): void {
    const gl = this.#gl;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const content = this.#slot(level * 2);
    content.bind(width, height);
    this.#paint(resources, group.items, frames, content, level + 1, smear);

    const matrix = group.matrix;
    // Nothing between the group and the surface but its own placement: one quad, no scratch target
    // and no pass to fill it.
    if (matrix !== undefined && group.effects.length === 0 && group.mix === undefined) {
      this.#surface(surface);
      this.#blend(group);
      this.#quad(this.#placement(resources.buffer), content.texture, matrix, group.uv, group.opacity);
      return;
    }
    let source = content;
    let spare = this.#slot(level * 2 + 1);
    gl.disable(gl.BLEND);
    // A chain and a mix both run over the whole surface, so the placement has to be baked in first
    // -- an effect applied before the group is placed would be an effect at the wrong scale.
    if (matrix !== undefined) {
      spare.bind(width, height);
      this.#quad(this.#placement(resources.buffer), content.texture, matrix, group.uv, 1);
      [source, spare] = [spare, source];
    }
    for (const pass of group.effects) {
      spare.bind(width, height);
      this.#pass(this.#pipeline(pass.effect), source.texture, undefined, pass.values);
      [source, spare] = [spare, source];
    }
    this.#finish(resources, group, source, surface);
  }

  // The last step both paths share: what the chain produced, onto the surface.
  #finish(
    resources: Resources,
    node: DrawItem | DrawGroup,
    source: RenderTarget,
    surface: RenderTarget | undefined,
  ): void {
    this.#surface(surface);
    const mix = node.mix;
    if (mix === undefined) {
      this.#blend(node);
      const screen = this.#screenPass(resources.buffer);
      this.#pass(screen, source.texture, undefined, { opacity: node.opacity });
      return;
    }
    // The transition's second input is what is already on the surface, so it has to be copied off
    // it: a pass cannot sample the buffer it draws into. Blending stays off -- the mix already
    // carries the picture underneath, and blending it over that picture would count it twice.
    this.#gl.disable(this.#gl.BLEND);
    this.#pass(this.#pipeline(mix.effect), source.texture, this.#copy(), mix.values, mix.lut);
  }

  // Bound without clearing: a surface is drawn onto many times over one frame, and the drawing
  // buffer was cleared once in `#begin`.
  #surface(target: RenderTarget | undefined): void {
    const gl = this.#gl;
    if (target !== undefined) {
      target.attach();
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
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

  #blend(node: DrawItem | DrawGroup): void {
    const gl = this.#gl;
    const blend = blendState(node.blend);
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

  /**
   * One clip, averaged over its exposure: the same quad drawn once per sample, each carrying that
   * sample's own picture and its own placement, added together at a matching fraction of the opacity.
   *
   * Additive rather than a chain of overs, because an average is a sum: `ONE, ONE` on a target the
   * bind cleared to zero leaves exactly the mean of the samples, and premultiplied values make that
   * mean a colour rather than an arithmetic accident. A run of `over` operations would instead weigh
   * the last sample most and the first least, which is a trail rather than a smear.
   *
   * One texture, uploaded per sample. The samples are drawn one at a time and each upload replaces
   * the last, so eight pictures cost one texture and eight uploads -- and the frames themselves are
   * the caller's, closed by whoever opened them.
   *
   * ponytail: the target is 8-bit, so each sample rounds by up to half a level and a full exposure can
   * be four levels out of 255 from the true mean. Below what anybody sees in a smear; an RGBA16F
   * target behind `EXT_color_buffer_float` is the fix if a grade ever has to be graded off one.
   */
  #expose(resources: Resources, item: DrawItem, exposure: readonly Smear[]): void {
    const gl = this.#gl;
    const share = 1 / exposure.length;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const sample of exposure) {
      // The same liveness check the ordinary path makes: a frame closed between the gather and here
      // reports zero for its size, and uploading one is a driver error rather than a missing picture.
      const picture =
        sample.frame !== undefined && uploadable(sample.frame, this.#maxTextureSize)
          ? sample.frame
          : undefined;
      this.#drawQuad(
        resources,
        { ...item, matrix: sample.matrix, uv: sample.uv },
        picture,
        share,
      );
    }
    gl.disable(gl.BLEND);
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

  // Two full-size targets per level of isolation, allocated the first time a level is reached and
  // held until the context goes. A project without a compound or an adjustment layer never leaves
  // level zero and pays for two, the same as before isolation existed.
  //
  // ponytail: nothing hands a target back. A group that only fades takes one target of its level;
  // one that also grades or dissolves takes the second as well, so eight levels of nesting with a
  // chain at every one reaches eighteen full-frame targets -- 149 MB at 1080p, held for the life of
  // the compositor even after the playhead has left the deepest compound. A pool keyed by "in use
  // this frame" is the upgrade.
  #slot(index: number): RenderTarget {
    const existing = this.#chain[index];
    if (existing !== undefined) return existing;
    const target = new RenderTarget(this.#gl);
    this.#chain[index] = target;
    return target;
  }

  // The one pipeline that draws a texture the compositor itself produced: placed by a matrix like
  // a clip, but read as the premultiplied, bottom-up picture a render target holds.
  #placement(buffer: WebGLBuffer): Pipeline {
    this.#place ??= this.#link(buffer, VERTEX_SOURCE, ISOLATED_SOURCE, 1);
    return this.#place;
  }

  #quad(
    pipeline: Pipeline,
    texture: WebGLTexture,
    matrix: readonly number[],
    uv: readonly [number, number, number, number],
    opacity: number,
  ): void {
    const gl = this.#gl;
    gl.useProgram(pipeline.program);
    gl.bindVertexArray(pipeline.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    setUniforms(gl, pipeline.program, { u_matrix: matrix, u_uv: uv, u_opacity: opacity });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
    this.#place = undefined;
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
