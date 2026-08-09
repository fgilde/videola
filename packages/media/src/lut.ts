import { cmd } from "@videola/core";

import type { MediaAsset, MediaId, VideolaDocument } from "@videola/core";

import { contentHash } from "./hash";
import { hasMedia, putMedia } from "./opfs";

/**
 * A three-dimensional colour lookup table, read from a `.cube` file.
 *
 * The table is what the shader samples and nothing else: `size` texels along each axis, red on x,
 * green on y, blue on z, laid out the way `texImage3D` wants them. Everything the file said about
 * itself -- its title, its comments, the order it wrote its rows in -- has been spent by the time
 * one of these exists.
 */
export interface LutTable {
  /** Entries along one edge of the cube. Between 2 and `MAX_LUT_SIZE`. */
  size: number;
  /** `size ** 3` texels, RGBA8, red varying fastest. Alpha is 255 throughout and unread. */
  rgba: Uint8Array;
}

/**
 * Browsers guess nothing for a `.cube` file -- `File.type` comes back empty -- so the importer
 * stamps this one on. It is what the library shows and what the `.videola` carries.
 */
export const LUT_MIME = "application/x-cube-lut";

/**
 * The largest grid this reads. The format allows far more, and nothing in grading does: 33 is what
 * every camera manufacturer ships and 64 is the largest anyone sells. At 64 the texture is a
 * megabyte, at 256 it would be sixty-four -- uploaded per effect, on a budget shared with every
 * frame on the timeline.
 */
export const MAX_LUT_SIZE = 64;

const MIN_LUT_SIZE = 2;

// A 64-cube is 262144 rows of about thirty characters, so eight megabytes is already twice the
// largest legitimate file. The cap is here rather than at the row count because the row count is
// only known after the whole text has been split, and splitting a gigabyte of text is the part
// that hangs the tab.
const MAX_TEXT_LENGTH = 8 * 1024 * 1024;

const INVALID = "error.lutInvalid";

/**
 * Reads a `.cube` file. Untrusted input throughout: this text arrives from a file somebody
 * dragged in, so every number, every count and the size of the thing itself is checked rather
 * than believed.
 *
 * What is deliberately refused rather than guessed at:
 *
 * - **A one-dimensional table.** `LUT_1D_SIZE` is a tone curve per channel, and this editor has a
 *   curves effect that edits exactly that with control points somebody can drag afterwards.
 *   Expanding one into a 3D grid would spend a megabyte of texture to say what four splines say.
 * - **A domain other than 0 to 1.** `DOMAIN_MIN`/`DOMAIN_MAX` say what input range the table is
 *   indexed by. The shader indexes it over the unit range, so a wider domain silently grades the
 *   wrong tones -- a quiet wrong picture instead of a refusal anybody can act on.
 *
 * Values outside 0 to 1 in the *output* are clamped rather than refused: an HDR-authored table is
 * still a usable look on an 8-bit pipeline, and this is the one place the clamp is ours.
 */
export function parseCube(text: string): LutTable {
  if (text.length > MAX_TEXT_LENGTH) throw new RangeError(INVALID, { cause: "size" });
  let size: number | undefined;
  const rgba: number[] = [];

  for (const raw of text.split("\n")) {
    // A comment runs to the end of the line, and a stray carriage return from a file written on
    // another platform is whitespace like any other.
    const line = raw.split("#")[0]!.trim();
    if (line.length === 0) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    switch (keyword) {
      case "TITLE":
        continue;
      case "LUT_1D_SIZE":
        throw new RangeError(INVALID, { cause: "oneDimensional" });
      case "LUT_3D_SIZE":
        if (size !== undefined) throw new RangeError(INVALID, { cause: "repeatedSize" });
        size = gridSize(rest[0]);
        continue;
      case "DOMAIN_MIN":
        requireDomain(rest, 0);
        continue;
      case "DOMAIN_MAX":
        requireDomain(rest, 1);
        continue;
      default:
        rgba.push(...entry(line.split(/\s+/)));
    }
  }

  if (size === undefined) throw new RangeError(INVALID, { cause: "noSize" });
  // Both directions. Too few rows would leave the tail of the table black, and too many mean the
  // file says something other than its own header does -- neither is a table anybody authored.
  if (rgba.length !== size ** 3 * 4) throw new RangeError(INVALID, { cause: "rowCount" });
  return { size, rgba: new Uint8Array(rgba) };
}

/**
 * A `.cube` file into the library, by the same road every other medium takes: hashed, stored in
 * OPFS under that hash, then named to the core. So a LUT is deduplicated across projects, packed
 * into the `.videola` by the writer that already walks the library, and gone from OPFS by the same
 * cleanup that reaches everything else. Nothing here is new machinery -- that is the point of
 * putting a table in the library rather than in the project file.
 *
 * Parsed before any of that, and the order matters: a library entry whose bytes are not a lookup
 * table is an effect that promises a grade it can never draw, which is the one failure this
 * feature had to avoid. A file that does not parse is refused here and the library never hears of
 * it.
 */
export async function importLut(file: File, doc: VideolaDocument): Promise<MediaId> {
  // Asked of the handle before the text is pulled into the heap: `File.text()` on a file somebody
  // renamed to `.cube` would otherwise decode however many gigabytes it really is.
  if (file.size > MAX_TEXT_LENGTH) throw new RangeError(INVALID, { cause: "size" });
  parseCube(await file.text());
  const hash = await contentHash(file);
  const asset: MediaAsset = {
    id: `med_${hash}`,
    originalName: file.name,
    mime: LUT_MIME,
    kind: "lut",
    sizeBytes: BigInt(file.size),
    duration: null,
    width: null,
    height: null,
    fps: null,
    sampleRate: null,
    channels: null,
  };
  if (!(await hasMedia(hash))) await putMedia(hash, file);
  doc.dispatch(cmd.mediaImport(asset));
  return asset.id;
}

function gridSize(word: string | undefined): number {
  const size = Number(word);
  if (!Number.isInteger(size) || size < MIN_LUT_SIZE || size > MAX_LUT_SIZE) {
    throw new RangeError(INVALID, { cause: "gridSize" });
  }
  return size;
}

// Written out per channel in every file that carries it at all, and the same value in all three in
// every file worth reading. Anything else is a table indexed over a range this shader does not
// walk, so it is refused rather than applied to the wrong tones.
function requireDomain(words: readonly string[], expected: number): void {
  if (words.length !== 3 || words.some((word) => Number(word) !== expected)) {
    throw new RangeError(INVALID, { cause: "domain" });
  }
}

// `Number("")` is 0 and `Number("nought")` is NaN, so the emptiness and the finiteness are both
// checked: a row of blanks would otherwise read as black and pass.
function entry(words: readonly string[]): [number, number, number, number] {
  if (words.length !== 3) throw new RangeError(INVALID, { cause: "row" });
  const [r, g, b] = words.map((word) => {
    const value = word.length === 0 ? Number.NaN : Number(word);
    if (!Number.isFinite(value)) throw new RangeError(INVALID, { cause: "row" });
    return Math.round(Math.min(Math.max(value, 0), 1) * 255);
  }) as [number, number, number];
  return [r, g, b, 255];
}
