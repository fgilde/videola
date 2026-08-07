import type { BlendMode, Clip, MediaAsset, Project, Time, Track, Transform } from "@videola/core";

export interface DrawItem {
  clip: string;
  matrix: readonly number[];
  uv: readonly [number, number, number, number];
  opacity: number;
  blend: BlendMode;
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
export function drawList(project: Project, at: Time): DrawList {
  const library = new Map(project.library.map((entry) => [entry.id, entry]));
  const frame = { width: project.settings.width, height: project.settings.height };
  const items: DrawItem[] = [];
  for (const track of project.timeline.tracks) {
    if (!paints(track)) continue;
    for (const clip of track.clips) {
      const item = drawItem(clip, at, library, frame);
      if (item !== undefined) items.push(item);
    }
  }
  return { background: parseColor(project.settings.background), items };
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

// The source arrives premultiplied from the fragment shader, which is what makes `src: ONE` the
// over-operator and keeps a half-transparent edge from being mixed towards the background twice.
//
// ponytail: overlay and difference are not expressible as a fixed-function blend and fall back to
// normal; MIN and MAX ignore the factors entirely, so darken and lighten also touch the alpha
// channel. Both need the destination as a texture, which means one more render target and a
// blend pass in GLSL -- the same machinery the effect chain of Task 16 introduces.
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
  library: ReadonlyMap<string, MediaAsset>,
  frame: Size,
): DrawItem | undefined {
  if (at < clip.start || at >= clip.start + clip.duration) return undefined;
  const transform = clip.transform;
  if (transform.opacity <= 0) return undefined;
  const source = sourceSize(clip, library);
  if (source === undefined) return undefined;
  const uv = croppedRect(transform);
  if (uv[2] <= 0 || uv[3] <= 0) return undefined;
  return {
    clip: clip.id,
    matrix: quadMatrix(transform, uv, source, frame),
    uv,
    opacity: transform.opacity,
    blend: clip.blend,
  };
}

// ponytail: generators and compound clips have no size and are dropped. Solids and text are M3,
// and a compound clip needs its own pass over a nested timeline.
function sourceSize(clip: Clip, library: ReadonlyMap<string, MediaAsset>): Size | undefined {
  if (clip.source.kind !== "media") return undefined;
  const asset = library.get(clip.source.media);
  if (asset?.width == null || asset.height == null) return undefined;
  return { width: asset.width, height: asset.height };
}

// The texture's first row is the frame's top row, and the unit quad runs top-down as well, so the
// sampled rectangle needs no flip -- the flip to clipspace happens once, in the matrix below.
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
  return [
    cos * spanX * toClipX,
    sin * spanX * toClipY,
    0,
    -sin * spanY * toClipX,
    cos * spanY * toClipY,
    0,
    (transform.x + cos * offsetX - sin * offsetY) * toClipX,
    (transform.y + sin * offsetX + cos * offsetY) * toClipY,
    1,
  ];
}

const HEX = /^#(?<digits>[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

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
  return [channel(0), channel(1), channel(2), wide.length === 8 ? channel(3) : 1];
}
