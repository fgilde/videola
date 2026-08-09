import { getMedia, mediaHash, parseCube } from "@videola/media";

import type { LutTable } from "@videola/media";
import type { Clip, Project, Track } from "@videola/core";

import { effect } from "../effects/registry";

/** `GL_TEXTURE_3D`. Spelt out here like every other enum in this package, so the type stays a
 * plain WebGL2RenderingContext and a test can drive it with a recording stub. */
export const TEXTURE_3D = 0x806f;

/**
 * The texture unit a lookup table lives on: after the clip's picture on 0 and a transition's second
 * input on 1.
 *
 * One constant, imported by all three paths that draw -- the compositor, the browser's tiles and,
 * through the compositor, the export worker. A second spelling of this number is exactly how a tile
 * would come to show a grade the file does not have.
 */
export const LUT_UNIT = 2;

const TEXTURE_WRAP_R = 0x8072;

/**
 * The table an unset -- or unloadable -- LUT parameter draws through.
 *
 * Two entries an axis, which is all an identity needs: trilinear interpolation between the eight
 * corners of the unit cube reproduces its own coordinates exactly. It exists so that the shader
 * has no branch and the sampler has no empty unit: a `sampler3D` bound to nothing samples as
 * opaque black, which is a clip painted black rather than a clip left alone.
 */
export const IDENTITY_LUT: LutTable = identity();

function identity(): LutTable {
  const rgba = new Uint8Array(2 * 2 * 2 * 4);
  for (let index = 0; index < 8; index += 1) {
    const at = index * 4;
    rgba[at] = (index & 1) * 255;
    rgba[at + 1] = ((index >> 1) & 1) * 255;
    rgba[at + 2] = ((index >> 2) & 1) * 255;
    rgba[at + 3] = 255;
  }
  return { size: 2, rgba };
}

/**
 * Puts a table into a 3D texture. The one place any of the three drawing paths does this, which is
 * the whole point of it being a function: the preview tile, the editor and the export worker each
 * build their own GL objects, and a second copy of these six lines is how the tile comes to filter
 * one way and the file another.
 *
 * RGBA8 rather than RGB8 because a row of a 33-cube is 99 bytes, which is not a multiple of four,
 * and an RGB upload would need the unpack alignment changed underneath every other texture in the
 * context. The quantisation costs nothing that survives: the target the grade lands in is RGBA8
 * as well.
 *
 * LINEAR is what makes this a lookup *table* rather than a posterising palette -- the hardware's
 * trilinear filter is the interpolation between grid points, and NEAREST would snap every pixel
 * to one of 33 tones an axis. CLAMP_TO_EDGE on all three axes, including the one WebGL1 never had.
 *
 * The two unpack flags are turned off around the upload and put back afterwards, and that is not
 * defensiveness: WebGL applies `UNPACK_FLIP_Y_WEBGL` to an ArrayBufferView as readily as to a
 * picture, and the browser's tiles keep it *on* because a still image has to be turned to match
 * `v_uv`. A table flipped that way has its green axis reversed -- a grade wrong in one channel,
 * which reads as a wrong table rather than as a bug. Measured rather than reasoned about: the tile
 * check below caught exactly this.
 */
export function uploadLut(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  table: LutTable,
): void {
  const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
  const premultiplied = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.bindTexture(TEXTURE_3D, texture);
  gl.texParameteri(TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(TEXTURE_3D, TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texImage3D(
    TEXTURE_3D,
    0,
    gl.RGBA8,
    table.size,
    table.size,
    table.size,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    table.rgba,
  );
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
}

/**
 * Every media id a LUT parameter names anywhere in the project.
 *
 * Keyframe tracks are read as well as the resting values. A table cannot be interpolated and the
 * core will not try, but a keyframe track still *holds* one, and a grade that changes table
 * halfway through a clip would otherwise be loaded for its first half only.
 */
export function lutIds(project: Project): string[] {
  const ids = new Set<string>();
  walk(project.timeline.tracks, 0, (clip) => {
    for (const authored of clip.effects) {
      const manifest = effect(authored.effectType);
      for (const param of manifest?.params ?? []) {
        if (param.kind !== "lut") continue;
        take(ids, authored.params[param.key]?.value);
        for (const key of authored.keyframes[param.key] ?? []) take(ids, key.value.value);
      }
    }
  });
  return [...ids];
}

function take(ids: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.length > 0) ids.add(value);
}

// Compound clips are walked *and* visited: a grade on the group is an effect like any other, and
// `leafClips` deliberately drops the group itself.
function walk(
  tracks: readonly Track[],
  depth: number,
  visit: (clip: Clip) => void,
): void {
  if (depth > 8) return;
  for (const track of tracks) {
    for (const clip of track.clips) {
      visit(clip);
      if (clip.source.kind === "compound") walk(clip.source.timeline.tracks, depth + 1, visit);
    }
  }
}

/**
 * The tables a project's grades need, read from OPFS and parsed once each.
 *
 * The same store serves the editor and the export worker, and both reach the bytes the same way
 * every medium is reached -- `media/<hash>` in OPFS. That is what makes the third texture unit
 * arrive in the worker without anything new crossing `postMessage`: the worker already opens video
 * files out of the same store, and a LUT is a file in it like the rest.
 *
 * A table that cannot be read or cannot be parsed is left out rather than thrown over: one broken
 * grade costs its own clip the look and the rest of the timeline nothing, and the clip is drawn
 * through the identity table -- the untouched picture, not a black rectangle.
 */
export class LutStore {
  #tables = new Map<string, LutTable>();
  // A failed read is remembered so a per-frame `ensure` does not hammer OPFS sixty times a second
  // for a file that is not coming back. `Playback.forget` is the counterpart for media; a LUT has
  // no such door yet, and reloading the project builds a new store.
  #missing = new Set<string>();

  async ensure(project: Project): Promise<void> {
    const wanted = lutIds(project);
    await Promise.all(wanted.map((id) => this.#read(id)));
    // Dropped as soon as no parameter names them any more, the same measure the compositor uses
    // for clip textures: a timeline somebody tried six looks on would otherwise hold all six.
    for (const id of this.#tables.keys()) {
      if (!wanted.includes(id)) this.#tables.delete(id);
    }
  }

  tables(): ReadonlyMap<string, LutTable> {
    return this.#tables;
  }

  async #read(id: string): Promise<void> {
    if (this.#tables.has(id) || this.#missing.has(id)) return;
    const hash = mediaHash(id);
    try {
      const bytes = hash === undefined ? undefined : await getMedia(hash);
      if (bytes === undefined) throw new Error("error.mediaMissing");
      this.#tables.set(id, parseCube(new TextDecoder().decode(bytes)));
    } catch (error) {
      console.error(error);
      this.#missing.add(id);
    }
  }
}
