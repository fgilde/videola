/**
 * A radix-2 FFT, in place, on separate real and imaginary planes.
 *
 * Written here rather than taken from a library because it is forty lines and the alternative is a
 * dependency in the one package that already carries the decoders: what it computes is checked
 * against a discrete transform written out by hand in the tests, which is the only real answer to
 * "is this transform the transform".
 *
 * Separate planes rather than interleaved pairs: every caller here holds audio as `Float32Array`
 * channels and wants magnitudes per bin, and interleaving would mean a copy in and a copy out.
 */

/** Whether a length can be transformed at all. Radix-2 needs a power of two, and says so. */
export function isPowerOfTwo(length: number): boolean {
  return length > 0 && (length & (length - 1)) === 0;
}

/**
 * In-place Cooley-Tukey. `sign` is -1 for the forward transform and +1 for the inverse, which is the
 * only difference between them apart from the scaling the inverse leaves to the caller.
 */
function transform(re: Float64Array, im: Float64Array, sign: -1 | 1): void {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error("error.fftLength");
  // Bit-reversal permutation. Without it the butterflies below would combine the wrong pairs; doing
  // it as a swap loop keeps the transform in place, which is what makes an STFT of a long file a
  // handful of allocations rather than one per window.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (sign * 2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = start + k;
        const b = a + len / 2;
        const bRe = re[b]! * curRe - im[b]! * curIm;
        const bIm = re[b]! * curIm + im[b]! * curRe;
        re[b] = re[a]! - bRe;
        im[b] = im[a]! - bIm;
        re[a] = re[a]! + bRe;
        im[a] = im[a]! + bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export function fft(re: Float64Array, im: Float64Array): void {
  transform(re, im, -1);
}

/** The inverse, scaled by 1/n, so `ifft(fft(x)) === x` rather than `n * x`. */
export function ifft(re: Float64Array, im: Float64Array): void {
  transform(re, im, 1);
  const n = re.length;
  for (let i = 0; i < n; i += 1) {
    re[i]! /= n;
    im[i]! /= n;
  }
}

/**
 * A periodic Hann window.
 *
 * Periodic and not symmetric: with a hop of a quarter of the window, four overlapping periodic Hann
 * windows sum to a constant, which is what lets an overlap-add resynthesis put the signal back
 * unchanged where nothing was altered. The symmetric spelling — `size - 1` in the denominator —
 * misses that by one sample and leaves a slow ripple through everything it reconstructs.
 */
export function hann(size: number): Float64Array {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }
  return window;
}
