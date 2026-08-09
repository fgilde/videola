import { MAX_COMPOUND_DEPTH, readableSourceTimeAt } from "@videola/core";

import { effect, paramUniform } from "../effects/registry";
import { paintsGenerator } from "../generate/generator";
import { generatorMotion } from "../generate/motion";

import type {
  BlendMode,
  Clip,
  EffectParamSnapshot,
  MediaAsset,
  ParamValue,
  Project,
  Time,
  Timeline,
  Track,
  Transform,
  TransformSnapshot,
  Transition,
} from "@videola/core";
import type { EffectManifest, Uniform } from "../effects/registry";

// One entry per shader pass, with every uniform the shader declares already resolved, clamped and
// named the way the shader names it. The compositor looks nothing up.
export interface EffectPass {
  effect: string;
  values: Readonly<Record<string, Uniform>>;
}

export interface DrawItem {
  clip: string;
  matrix: readonly number[];
  uv: readonly [number, number, number, number];
  opacity: number;
  blend: BlendMode;
  effects: readonly EffectPass[];
  // Set while the clip's incoming transition is running. The clip is then mixed into the picture
  // the frame already holds rather than composited over it, and `opacity` is already part of
  // `progress` -- a transition at half opacity is a half transition, not a transition that is
  // afterwards faded.
  mix?: EffectPass;
}

export interface DrawList {
  background: readonly [number, number, number, number];
  items: DrawItem[];
}

export interface BlendState {
  equation: number;
  src: number;
  dst: number;
}

interface Size {
  width: number;
  height: number;
}

// What the compositor draws for one moment, as a value. Every decision that does not need a GPU
// lives here -- which clips are visible, in which order, where each one lands, which part of it
// is sampled and how it mixes with what is below. The GL side is the executor that walks this
// list, so everything above it can be tested in a runtime that has no WebGL at all.
//
// Coordinates this file defines, because the core model leaves the units open:
//   transform.x/y   project pixels from the centre of the frame, y running down the picture
//   rotation        degrees, positive turns clockwise on screen
//   anchor          fraction of the uncropped source, so cropping does not move the pivot
//   crop            fraction cut off each side
export function drawList(
  project: Project,
  at: Time,
  params: EffectParamSnapshot,
  transforms: TransformSnapshot,
): DrawList {
  const frame = { width: project.settings.width, height: project.settings.height };
  const scene: Scene = { library: project.library, frame, params, transforms };
  const items: DrawItem[] = [];
  collect(project.timeline, at, scene, NO_ENCLOSURE, 0, items);
  return { background: parseColor(project.settings.background), items };
}

// Everything a walk over one timeline needs that does not change with depth. A compound clip is
// composited against the project's own frame, which is the only size it has -- so the frame is one
// of them.
interface Scene {
  library: readonly MediaAsset[];
  frame: Size;
  params: EffectParamSnapshot;
  // Keyframes already resolved by the core. It travels with the scene rather than being looked up
  // per clip, because a nested timeline is walked at its own instant and would otherwise need a
  // second batch query for every level it descends.
  transforms: TransformSnapshot;
}

// What the compound clips above a clip contribute to how it is drawn: where the group is placed,
// how far it has been faded, what it is blended with and which effects run over it.
interface Enclosure {
  matrix?: readonly number[];
  opacity: number;
  effects: readonly EffectPass[];
  blend: BlendMode;
}

const NO_ENCLOSURE: Enclosure = { opacity: 1, effects: [], blend: "normal" };

// A compound clip is flattened into the clips inside it rather than composited to a surface of its
// own: the group's placement is a matrix and composes exactly, and so does the instant it shows of
// its own timeline. A compound whose transform, opacity and speed are untouched therefore produces
// byte for byte the draw list its clips produced before they were folded -- which is the whole
// claim `clip.nest` makes, and what the pixel harness checks on a driver.
//
// ponytail: the group is not isolated. Opacity multiplies into each nested clip (visible where two
// of them overlap), the group's effects run per clip rather than once over the composed picture,
// its blend mode only reaches clips that do not carry one of their own, and a crop on a compound
// is ignored -- a rectangle in group space cannot be expressed as a cut in each clip's own. All
// four want the sub-list rendered into a RenderTarget and drawn as one quad, which is the same
// machinery `#chained` already runs for the effect chain, one level deeper. A transition on a
// compound is the one case that would be actively wrong rather than merely different, and the core
// refuses it (see `transition_source_allowed`).
function collect(
  timeline: Timeline,
  at: Time,
  scene: Scene,
  enclosure: Enclosure,
  depth: number,
  into: DrawItem[],
): void {
  if (depth > MAX_COMPOUND_DEPTH) return;
  for (const track of timeline.tracks) {
    if (!paints(track)) continue;
    for (const clip of track.clips) {
      if (clip.source.kind === "compound") {
        const inner = enclose(clip, at, scene, enclosure);
        if (inner === undefined) continue;
        collect(clip.source.timeline, inner.at, scene, inner.enclosure, depth + 1, into);
        continue;
      }
      const item = drawItem(clip, at, scene, enclosure);
      if (item !== undefined) into.push(item);
    }
  }
}

// The compound's own contribution, and the instant its timeline is showing. Project time towards
// the nested timeline, the same direction and the same clamp the core's batch query uses -- the
// two must agree on which clips are visible or a clip lands in the draw list with no frame behind
// it.
function enclose(
  clip: Clip,
  at: Time,
  scene: Scene,
  enclosure: Enclosure,
): { at: Time; enclosure: Enclosure } | undefined {
  const inner = readableSourceTimeAt(clip, at);
  if (inner === undefined) return undefined;
  const transform = clip.transform;
  const opacity = transform.opacity * enclosure.opacity;
  if (opacity <= 0) return undefined;
  const own = quadMatrix(transform, FULL, scene.frame, scene.frame);
  return {
    at: inner,
    enclosure: {
      matrix: concat(enclosure.matrix, own),
      opacity,
      effects: [...effectPasses(clip, scene.params), ...enclosure.effects],
      blend: clip.blend === "normal" ? enclosure.blend : clip.blend,
    },
  };
}

const FULL: readonly [number, number, number, number] = [0, 0, 1, 1];

// Clipspace back to the unit quad: a nested clip's matrix ends in the *inner* frame's clipspace,
// and the compound's own matrix starts from a unit quad covering that frame. `y` flips because
// `quadMatrix` runs the unit quad top-down and clipspace bottom-up.
const CLIP_TO_UNIT: readonly number[] = [0.5, 0, 0, 0, -0.5, 0, 0.5, 0.5, 1];

function concat(parent: readonly number[] | undefined, own: readonly number[]): readonly number[] {
  return parent === undefined ? own : multiply(multiply(parent, CLIP_TO_UNIT), own);
}

// Column-major throughout, the way uniformMatrix3fv wants it.
function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[k * 3 + row]! * b[column * 3 + k]!;
      out[column * 3 + row] = sum + 0;
    }
  }
  return out;
}

const ONE = 1;
const ONE_MINUS_SRC_COLOR = 0x0301;
const ONE_MINUS_SRC_ALPHA = 0x0303;
const DST_COLOR = 0x0306;
const FUNC_ADD = 0x8006;
const FUNC_REVERSE_SUBTRACT = 0x800b;
const MIN = 0x8007;
const MAX = 0x8008;

const OVER: BlendState = { equation: FUNC_ADD, src: ONE, dst: ONE_MINUS_SRC_ALPHA };

// Colour only. The alpha channel is composited as a plain over-operator in `Compositor.#draw`,
// where it is the same for every mode -- `subtract` here would otherwise reach 1 - 1 = 0 and cut
// a transparent hole through the picture.
//
// The source arrives premultiplied from the fragment shader, which is what makes `src: ONE` the
// over-operator and keeps a half-transparent edge from being mixed towards the background twice.
//
// ponytail: overlay and difference are not expressible as a fixed-function blend and fall back to
// normal. They need the destination as a texture, which means one more render target and a blend
// pass in GLSL -- the same machinery the effect chain of Task 16 introduces.
export function blendState(mode: BlendMode): BlendState {
  switch (mode) {
    case "multiply":
      return { equation: FUNC_ADD, src: DST_COLOR, dst: ONE_MINUS_SRC_ALPHA };
    case "screen":
      return { equation: FUNC_ADD, src: ONE, dst: ONE_MINUS_SRC_COLOR };
    case "add":
      return { equation: FUNC_ADD, src: ONE, dst: ONE };
    case "subtract":
      return { equation: FUNC_REVERSE_SUBTRACT, src: ONE, dst: ONE };
    case "lighten":
      return { equation: MAX, src: ONE, dst: ONE };
    case "darken":
      return { equation: MIN, src: ONE, dst: ONE };
    default:
      return OVER;
  }
}

// ponytail: adjustment tracks paint nothing yet. They apply their effects to everything below,
// which needs the track's intermediate target from the frame graph -- the seam is here, the
// machinery arrives with the effect chain in Task 16.
function paints(track: Track): boolean {
  if (track.hidden) return false;
  return track.kind === "video" || track.kind === "overlay" || track.kind === "text";
}

function drawItem(
  clip: Clip,
  at: Time,
  scene: Scene,
  enclosure: Enclosure,
): DrawItem | undefined {
  if (at < clip.start || at >= clip.start + clip.duration) return undefined;
  // The core resolved the keyframes; `clip.transform` is the value at rest, reached only when the
  // caller supplied no snapshot at all, which no renderer does.
  //
  // A title's in, out and loop animation is a transform too, so it arrives here rather than in the
  // pixels -- which is also why a fade-in at its very first moment drops the clip from the list and
  // spares the decoder a frame nobody sees.
  const placed = scene.transforms.get(clip.id) ?? clip.transform;
  const transform = generatorMotion(clip, at, scene.frame, placed);
  const opacity = transform.opacity * enclosure.opacity;
  if (opacity <= 0) return undefined;
  const source = sourceSize(clip, scene.library, scene.frame);
  if (source === undefined) return undefined;
  const uv = croppedRect(transform);
  if (uv[2] <= 0 || uv[3] <= 0) return undefined;
  const mix = mixPass(clip, at, opacity);
  // A transition that has not started contributes nothing, and dropping it here also spares the
  // decoder a frame nobody will see -- playback asks for exactly the clips in this list.
  if (mix !== undefined && mix.values.progress === 0) return undefined;
  return {
    clip: clip.id,
    matrix: concat(enclosure.matrix, quadMatrix(transform, uv, source, scene.frame)),
    uv,
    opacity,
    blend: clip.blend === "normal" ? enclosure.blend : clip.blend,
    effects: [...effectPasses(clip, scene.params), ...enclosure.effects],
    ...(mix === undefined ? {} : { mix }),
  };
}

// An effect type nobody implements is skipped rather than refused: a project written by a later
// version must still play, minus what this one cannot draw.
//
// A separable effect becomes two entries with the same uniforms and a different `pass`. Expanding it
// here rather than in the compositor keeps the executor's rule intact -- one entry, one draw -- and
// puts the count where a test can read it off a value.
function effectPasses(clip: Clip, params: EffectParamSnapshot): EffectPass[] {
  const passes: EffectPass[] = [];
  for (const authored of clip.effects) {
    if (!authored.enabled) continue;
    const manifest = effect(authored.effectType);
    if (manifest === undefined || manifest.inputs !== 1) continue;
    const resolved = params.get(authored.id);
    const values = uniforms(manifest, (key) => resolved?.get(key));
    if (manifest.passes === undefined) {
      passes.push({ effect: manifest.id, values });
      continue;
    }
    for (let sweep = 0; sweep < manifest.passes; sweep += 1) {
      passes.push({ effect: manifest.id, values: { ...values, pass: sweep } });
    }
  }
  return passes;
}

// The incoming clip's transition, as far into it as `at` has come. Once the window is behind the
// moment the clip is composited the ordinary way again -- a mix at full progress would paint the
// whole frame, including where the clip itself is transparent.
//
// The transition's own parameters come from the model and go through the same clamp as an effect's:
// an angle a project file left out is the manifest's default rather than the zero an unset uniform
// would be, and the two are not the same for a wipe.
function mixPass(clip: Clip, at: Time, opacity: number): EffectPass | undefined {
  const transition = clip.transitionIn;
  if (transition == null || transition.duration <= 0) return undefined;
  const manifest = effect(transition.transitionType);
  if (manifest?.inputs !== 2) return undefined;
  const progress = (at - windowStart(clip.start, transition)) / transition.duration;
  if (progress >= 1) return undefined;
  const values = uniforms(manifest, (key) => transition.params[key]);
  values.progress = Math.max(progress, 0) * opacity;
  return { effect: manifest.id, values };
}

// ponytail: a centred or trailing transition reaches back before the clip starts, where the clip
// is not drawn at all -- so half of it is simply not seen. Playing it out needs handles, material
// past the cut that no command in M1 creates. Overlap the two clips and align the transition to
// `in`, which is what the guide describes.
function windowStart(start: Time, transition: Transition): Time {
  switch (transition.alignment) {
    case "in":
      return start;
    case "out":
      return start - transition.duration;
    default:
      return start - Math.round(transition.duration / 2);
  }
}

// Unpacking the `ParamValue` is the only thing TypeScript does to a parameter -- the value itself,
// keyframed or not, was decided in the core. What is usable as a uniform is `paramUniform`'s call,
// and it is the same call for a colour as for a float: a project may carry any kind on any key.
//
// Takes a lookup rather than a map because the two callers hold their values differently: an
// effect's arrive resolved from the core, a transition's straight off the model.
function uniforms(
  manifest: EffectManifest,
  lookup: (key: string) => ParamValue | undefined,
): Record<string, Uniform> {
  const values: Record<string, Uniform> = {};
  for (const param of manifest.params) {
    values[param.key] = paramUniform(param, lookup(param.key)?.value);
  }
  return values;
}

// A generator fills the frame, because that is the only size it has: text, a solid and a gradient are
// all authored against the output rather than against a source of their own, which is why every
// measurement in a text style is a fraction. A transform still moves and scales it from there.
//
// Compound clips never reach this: `collect` walks into them instead. Generators the renderer
// cannot paint are dropped, so nothing appears as an empty rectangle promising a picture that is
// not coming.
function sourceSize(clip: Clip, library: readonly MediaAsset[], frame: Size): Size | undefined {
  if (clip.source.kind === "generator") {
    return paintsGenerator(clip.source.generator) ? frame : undefined;
  }
  if (clip.source.kind !== "media") return undefined;
  const media = clip.source.media;
  // A scan beats an index here: a handful of clips are visible at a time, and building a map of
  // the whole library on every frame costs more than it saves.
  const asset = library.find((entry) => entry.id === media);
  if (asset?.width == null || asset.height == null) return undefined;
  return { width: asset.width, height: asset.height };
}

// The texture's first row is the frame's top row, and the unit quad runs top-down as well, so the
// sampled rectangle needs no flip -- the flip to clipspace happens once, in the matrix below.
//
// ponytail: the cut runs along a texel boundary, and LINEAR filtering reaches half a texel past
// it, so the first column of a cropped clip carries a trace of what was cut away. Insetting the
// rectangle by half a texel would fix it -- `sourceSize` knows the size it would need -- at the
// price of scaling every cropped clip by a sub-pixel amount. Which artefact is worse is a
// question for pixels on a screen, so it waits for the browser tests.
function croppedRect(transform: Transform): [number, number, number, number] {
  const { left, top, right, bottom } = transform.crop;
  return [left, top, 1 - left - right, 1 - top - bottom];
}

// Maps the unit quad onto the cropped part of the source, placed and turned about its anchor, and
// from there into clipspace. Column-major, ready for uniformMatrix3fv without transposing.
function quadMatrix(
  transform: Transform,
  uv: readonly [number, number, number, number],
  source: Size,
  frame: Size,
): number[] {
  const width = source.width * transform.scaleX;
  const height = source.height * transform.scaleY;
  const spanX = uv[2] * width;
  const spanY = uv[3] * height;
  const offsetX = (uv[0] - transform.anchorX) * width;
  const offsetY = (uv[1] - transform.anchorY) * height;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const toClipX = 2 / frame.width;
  const toClipY = -2 / frame.height;
  // `+ 0` and nothing else: an unrotated matrix produces a negative zero wherever a zero meets the
  // downward y axis, and a matrix that went through a compound clip's own placement produces a
  // positive one for the same picture. The GPU cannot tell them apart and a value comparison can,
  // so the one draw list has one spelling for zero.
  return [
    cos * spanX * toClipX + 0,
    sin * spanX * toClipY + 0,
    0,
    -sin * spanY * toClipX + 0,
    cos * spanY * toClipY + 0,
    0,
    (transform.x + cos * offsetX - sin * offsetY) * toClipX + 0,
    (transform.y + sin * offsetX + cos * offsetY) * toClipY + 0,
    1,
  ];
}

const HEX = /^#(?<digits>[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Comes out premultiplied, like everything else that reaches the drawing buffer: an eight digit
// background is written as straight alpha and would otherwise be composited far too bright.
//
// ponytail: the channels are taken as they are written, so blending happens in the non-linear
// sRGB space the textures arrive in. That is what canvas 2D and every preview window does; light
// adds up correctly only with sRGB texture formats and an sRGB draw buffer, which is a change of
// the whole pipeline rather than of this function.
function parseColor(hex: string): [number, number, number, number] {
  const digits = HEX.exec(hex)?.groups?.digits;
  if (digits === undefined) return [0, 0, 0, 1];
  const wide = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  const channel = (index: number): number =>
    Number.parseInt(wide.slice(index * 2, index * 2 + 2), 16) / 255;
  const alpha = wide.length === 8 ? channel(3) : 1;
  return [channel(0) * alpha, channel(1) * alpha, channel(2) * alpha, alpha];
}
