/**
 * The measuring instruments: what a waveform, a histogram and a vectorscope are, as numbers.
 *
 * One pass over the pixels fills all three. They ask three different questions of the same pixel --
 * how bright, how often, what colour -- and reading the buffer three times to answer them would
 * cost three times the only expensive thing here, which is walking the picture.
 *
 * Nothing in this file touches a GPU or a canvas. A scope is countable, so it is testable without
 * either, and what is left for the driver to prove is only that the pixels handed in are the
 * pixels that were drawn.
 */

/** How many steps a reading is divided into, for the histogram and up the waveform. */
export const SCOPE_LEVELS = 256;

/** The colour plane is square, and this is its side. */
export const VECTOR_SIZE = 128;

export interface Histogram {
  readonly red: Uint32Array;
  readonly green: Uint32Array;
  readonly blue: Uint32Array;
  readonly luma: Uint32Array;
}

export interface ScopeReading {
  /** How often each level occurs, per channel and for brightness. */
  readonly histogram: Histogram;
  /** `column * SCOPE_LEVELS + level`, level 0 at black. One column per column of the sample. */
  readonly waveform: Uint32Array;
  readonly columns: number;
  /** `row * VECTOR_SIZE + column`, row 0 at the top -- the way a picture of it is drawn. */
  readonly vectorscope: Uint32Array;
  /**
   * How many pixels carried any colour at all. Zero on a frame nothing was drawn into, which is
   * the reading that has to come out empty rather than out of a division by nought.
   */
  readonly measured: number;
  /** The brightest level anything reached, and the darkest. Undefined when nothing was measured. */
  readonly range: readonly [number, number] | undefined;
}

// Rec.709, on the non-linear values the pipeline mixes in. That is luma and not luminance, and it
// is what every waveform monitor in an editing suite shows -- see the note on the colour space in
// the guide. A colorimetric reading needs the linear-light pipeline the compositor does not have.
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// The two chroma axes, scaled so each runs from -0.5 to 0.5 over the whole gamut.
const CB_SCALE = 1.8556;
const CR_SCALE = 1.5748;

/**
 * One pass over an RGBA buffer.
 *
 * The buffer carries premultiplied colour, because everything downstream of the clip shader does.
 * A scope is about the colour and not about the coverage, so each pixel is divided back out by its
 * own alpha -- and a pixel with no coverage has no colour to report and is left out entirely
 * rather than counted as black. Counting it as black is what makes an empty frame look like a
 * perfectly exposed one with the lens cap on.
 *
 * Row order does not matter and is not corrected: a histogram and a vectorscope do not care, and a
 * waveform is indexed by column. The caller may hand over the rows either way up.
 */
export function measure(pixels: Uint8Array, width: number, height: number): ScopeReading {
  const columns = Math.max(width, 0);
  const histogram: Histogram = {
    red: new Uint32Array(SCOPE_LEVELS),
    green: new Uint32Array(SCOPE_LEVELS),
    blue: new Uint32Array(SCOPE_LEVELS),
    luma: new Uint32Array(SCOPE_LEVELS),
  };
  const waveform = new Uint32Array(columns * SCOPE_LEVELS);
  const vectorscope = new Uint32Array(VECTOR_SIZE * VECTOR_SIZE);
  let measured = 0;
  let low = SCOPE_LEVELS;
  let high = -1;

  const pixelCount = Math.min(columns * Math.max(height, 0), pixels.length >> 2);
  for (let i = 0; i < pixelCount; i += 1) {
    const at = i * 4;
    const alpha = pixels[at + 3]!;
    if (alpha === 0) continue;
    // Back to the colour that was there before the coverage was multiplied in. The rounding is
    // deliberate: a scope reports levels, and a level is what an 8-bit picture actually holds.
    const r = alpha === 255 ? pixels[at]! : level(pixels[at]! / alpha);
    const g = alpha === 255 ? pixels[at + 1]! : level(pixels[at + 1]! / alpha);
    const b = alpha === 255 ? pixels[at + 2]! : level(pixels[at + 2]! / alpha);
    const y = Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b);

    histogram.red[r]! += 1;
    histogram.green[g]! += 1;
    histogram.blue[b]! += 1;
    histogram.luma[y]! += 1;
    waveform[(i % columns) * SCOPE_LEVELS + y]! += 1;

    const cb = (b - y) / CB_SCALE;
    const cr = (r - y) / CR_SCALE;
    vectorscope[plot(cb, cr)]! += 1;

    measured += 1;
    if (y < low) low = y;
    if (y > high) high = y;
  }

  return {
    histogram,
    waveform,
    columns,
    vectorscope,
    measured,
    range: measured === 0 ? undefined : [low, high],
  };
}

/**
 * Where the six colour bars sit on the plane, at the three-quarter amplitude a bar generator uses.
 *
 * The graticule is what turns a cloud of dots into a reading: a face that leans towards the box
 * marked R is a face with too much red in it, and without the boxes it is a cloud that leans.
 * Derived from the same transform the measurement uses rather than drawn from memory, so the two
 * cannot come apart.
 */
export const VECTOR_TARGETS: readonly { readonly name: string; readonly x: number; readonly y: number }[] =
  ([
    ["R", 1, 0, 0],
    ["Y", 1, 1, 0],
    ["G", 0, 1, 0],
    ["C", 0, 1, 1],
    ["B", 0, 0, 1],
    ["M", 1, 0, 1],
  ] as const).map(([name, r, g, b]) => {
    const amplitude = 0.75 * 255;
    const [red, green, blue] = [r * amplitude, g * amplitude, b * amplitude];
    const y = LUMA_R * red + LUMA_G * green + LUMA_B * blue;
    return { name, x: fraction((blue - y) / CB_SCALE), y: 1 - fraction((red - y) / CR_SCALE) };
  });

function plot(cb: number, cr: number): number {
  const column = Math.min(VECTOR_SIZE - 1, Math.max(0, Math.round(fraction(cb) * (VECTOR_SIZE - 1))));
  // Row nought at the top, so the array is already in the order a picture of it is drawn -- and so
  // red, which is a high Cr, lands above the middle where a vectorscope puts it.
  const row = Math.min(VECTOR_SIZE - 1, Math.max(0, Math.round((1 - fraction(cr)) * (VECTOR_SIZE - 1))));
  return row * VECTOR_SIZE + column;
}

// The chroma axes run from -0.5 to 0.5 of the full range; this puts them on 0..1.
function fraction(chroma: number): number {
  return chroma / 255 + 0.5;
}

function level(value: number): number {
  return Math.min(SCOPE_LEVELS - 1, Math.max(0, Math.round(value * 255)));
}
