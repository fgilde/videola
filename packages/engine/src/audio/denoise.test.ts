import { describe, expect, it } from "vitest";

import { denoiseChannel, DENOISE_DEFAULTS, noiseFloor } from "./denoise";
import { fft, hann, ifft, isPowerOfTwo } from "./fft";

const RATE = 48_000;

// A deterministic noise source. `Math.random` would make every failure a different failure, and a
// denoiser is exactly the kind of code whose test has to be able to run twice.
function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function tone(length: number, frequency: number, amplitude = 0.5): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE);
  }
  return out;
}

/**
 * A tone in bursts with pauses between them, which is what makes it stand in for a voice: the pauses
 * are where the noise is alone, and every denoiser there has ever been learns its floor from them.
 * Half a second on, half a second off.
 */
function bursts(seconds: number, frequency: number, amplitude = 0.5): Float32Array<ArrayBuffer> {
  const out = tone(RATE * seconds, frequency, amplitude);
  for (let i = 0; i < out.length; i += 1) {
    if (Math.floor(i / (RATE / 2)) % 2 === 1) out[i] = 0;
  }
  return out;
}

function withNoise(
  signal: Float32Array<ArrayBuffer>,
  level: number,
  seed = 7,
): Float32Array<ArrayBuffer> {
  const random = noise(seed);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) out[i] = signal[i]! + level * random();
  return out;
}

/** The power in one band, which is how much of the signal survives where the signal is. */
function bandPower(channel: Float32Array<ArrayBuffer>, from: number, to: number): number {
  const size = 4096;
  const window = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let total = 0;
  let windows = 0;
  for (let start = 0; start + size <= channel.length; start += size) {
    for (let i = 0; i < size; i += 1) {
      re[i] = channel[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const low = Math.max(1, Math.round((from * size) / RATE));
    const high = Math.min(size / 2, Math.round((to * size) / RATE));
    for (let bin = low; bin <= high; bin += 1) total += re[bin]! ** 2 + im[bin]! ** 2;
    windows += 1;
  }
  return windows === 0 ? 0 : total / windows;
}

const asDb = (ratio: number): number => 10 * Math.log10(Math.max(ratio, 1e-12));

describe("the transform underneath", () => {
  it("takes a power of two and refuses anything else", () => {
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(1000)).toBe(false);
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
  });

  // Against a discrete transform written out by hand: the fast one is an optimisation of exactly this
  // sum, and comparing it to itself would prove nothing.
  it("computes what the discrete transform computes", () => {
    const size = 16;
    const input = Array.from({ length: size }, (_, i) => Math.sin(i) + 0.3 * Math.cos(3 * i));
    const re = Float64Array.from(input);
    const im = new Float64Array(size);
    fft(re, im);

    for (const bin of [0, 1, 5, 8]) {
      let sumRe = 0;
      let sumIm = 0;
      for (let n = 0; n < size; n += 1) {
        const angle = (-2 * Math.PI * bin * n) / size;
        sumRe += input[n]! * Math.cos(angle);
        sumIm += input[n]! * Math.sin(angle);
      }
      expect(re[bin]).toBeCloseTo(sumRe, 8);
      expect(im[bin]).toBeCloseTo(sumIm, 8);
    }
  });

  it("comes back to where it started", () => {
    const size = 64;
    const input = Array.from({ length: size }, (_, i) => Math.cos(i / 3) * 0.7);
    const re = Float64Array.from(input);
    const im = new Float64Array(size);

    fft(re, im);
    ifft(re, im);

    for (let i = 0; i < size; i += 1) expect(re[i]).toBeCloseTo(input[i]!, 10);
  });

  // Four of these at a quarter-window hop have to sum to a constant, or an overlap-add resynthesis
  // puts a slow ripple through everything it reconstructs.
  it("uses the periodic window, which four of overlap to a constant", () => {
    const size = 256;
    const window = hann(size);
    const hop = size / 4;
    const sums: number[] = [];
    for (let at = size; at < size * 2; at += 1) {
      let total = 0;
      for (let offset = 0; offset <= size * 2; offset += hop) {
        const index = at - offset;
        if (index >= 0 && index < size) total += window[index]!;
      }
      sums.push(total);
    }
    for (const total of sums) expect(total).toBeCloseTo(2, 10);
  });
});

describe("what the noise floor is taken to be", () => {
  // What the estimate is *for*: the level in the pauses, not the level of what is being said.
  it("measures the noise in the pauses and not the signal over it", () => {
    const random = noise(11);
    const hiss = new Float32Array(RATE * 4);
    for (let i = 0; i < hiss.length; i += 1) hiss[i] = 0.05 * random();
    const speech = bursts(4, 1000, 0.6);
    const mixed = new Float32Array(hiss.length);
    for (let i = 0; i < mixed.length; i += 1) mixed[i] = hiss[i]! + speech[i]!;

    const bin = Math.round((1000 * 2048) / RATE);
    const overSpeech = noiseFloor(mixed)[bin]!;
    const overHissAlone = noiseFloor(hiss)[bin]!;

    // At the tone's own bin the estimate is the hiss there and not the tone: within a few decibels of
    // what the same measurement makes of the hiss on its own. Contaminated by the tone it would be
    // twenty decibels higher, and subtracting that would take the voice out with the fan.
    expect(Math.abs(asDb((overSpeech / overHissAlone) ** 2))).toBeLessThan(4);
  });
});

describe("spectral noise reduction", () => {
  // The claim the whole thing exists for, and the one a filter cannot make: the noise *inside* the
  // band the tone sits in goes away while the tone stays.
  it("takes away noise sharing a band with the signal and keeps the signal", () => {
    const clean = bursts(4, 1000);
    const dirty = withNoise(clean, 0.08);

    const cleaned = denoiseChannel(dirty, DENOISE_DEFAULTS);

    const toneBefore = bandPower(dirty, 950, 1050);
    const toneAfter = bandPower(cleaned, 950, 1050);
    // Beside the tone and well inside the band a low or high cut would have to keep: this is the
    // noise no filter can reach without taking the voice with it.
    const noiseBefore = bandPower(dirty, 1500, 3000);
    const noiseAfter = bandPower(cleaned, 1500, 3000);

    expect(asDb(noiseAfter / noiseBefore)).toBeLessThan(-9);
    expect(asDb(toneAfter / toneBefore)).toBeGreaterThan(-2);
  });

  it("leaves a clean recording alone", () => {
    const clean = bursts(4, 440);

    const cleaned = denoiseChannel(clean, DENOISE_DEFAULTS);

    // A pass over a signal with no noise floor to speak of is a pass that returns the signal: the
    // resynthesis is exact where the gain is one, which is what the window sum above buys.
    const kept = bandPower(cleaned, 400, 480) / bandPower(clean, 400, 480);
    expect(asDb(kept)).toBeGreaterThan(-1.5);
    expect(asDb(kept)).toBeLessThan(1);
  });

  it("never gates a bin to silence", () => {
    const random = noise(3);
    const hiss = new Float32Array(RATE);
    for (let i = 0; i < hiss.length; i += 1) hiss[i] = 0.1 * random();

    const cleaned = denoiseChannel(hiss, { amount: 8, floorDb: -18 });

    // The floor is a floor: at -18 dB the remaining noise is a room rather than the digital silence
    // that warbles on and off between windows.
    const left = asDb(bandPower(cleaned, 500, 5000) / bandPower(hiss, 500, 5000));
    expect(left).toBeLessThan(-10);
    expect(left).toBeGreaterThan(-40);
  });

  it("does nothing at all at zero, and to material shorter than a window", () => {
    const dirty = withNoise(bursts(2, 1000), 0.05);
    expect(denoiseChannel(dirty, { amount: 0, floorDb: -18 })).toBe(dirty);

    const scrap = withNoise(tone(512, 1000), 0.05);
    expect(denoiseChannel(scrap, DENOISE_DEFAULTS)).toBe(scrap);
  });

  // What a ratio measured inside the file cannot see: the ends. Un-padded, the first and last samples
  // are covered by one window whose taper is nearly zero there, and dividing by that window sum made
  // the ends of every clip eighteen times louder than the material.
  it("never comes back louder than it went in", () => {
    const random = noise(19);
    const hiss = new Float32Array(RATE);
    for (let i = 0; i < hiss.length; i += 1) hiss[i] = 0.1 * random();

    const cleaned = denoiseChannel(hiss, DENOISE_DEFAULTS);
    const peak = (channel: Float32Array): number => Math.max(...Array.from(channel, Math.abs));

    expect(peak(cleaned)).toBeLessThan(peak(hiss));
    // And the ends in particular, which is where the fault was: the first and last thousand samples
    // are no louder than the whole.
    const ends = Math.max(
      peak(cleaned.subarray(0, 1000) as Float32Array<ArrayBuffer>),
      peak(cleaned.subarray(cleaned.length - 1000) as Float32Array<ArrayBuffer>),
    );
    expect(ends).toBeLessThanOrEqual(peak(cleaned));
  });

  // Aligned with what it was given, sample for sample. The padding is an implementation detail and
  // must stay one: shifted by a window, a cleaned clip would drift against its own picture -- and
  // every measurement that averages over the whole file would still look right.
  it("comes back where it was, not shifted by a window", () => {
    const speech = withNoise(bursts(2, 1000), 0.03);

    const cleaned = denoiseChannel(speech, DENOISE_DEFAULTS);

    // The first half second is a burst and the second is a pause. The loud half has to stay the loud
    // half, and a shift of one window (43 ms) would not change that -- so this is measured at the
    // boundary, where a shift of even a thousand samples shows.
    const rms = (from: number, to: number): number => {
      let total = 0;
      for (let i = from; i < to; i += 1) total += cleaned[i]! ** 2;
      return Math.sqrt(total / (to - from));
    };
    const loud = rms(0, RATE / 2 - 2000);
    const quiet = rms(RATE / 2 + 2000, RATE - 2000);
    expect(loud).toBeGreaterThan(quiet * 4);
    // Read *just inside* the end of the burst, closer to it than one window is long: shifted by a
    // window, this stretch would come from the pause that follows and read quiet. A slack of two
    // thousand samples either side would have let a shift of two thousand and forty-eight through,
    // and it did -- the mutation that puts the padding at the wrong end survived until this line.
    expect(rms(RATE / 2 - 1500, RATE / 2 - 100)).toBeGreaterThan(quiet * 3);
    // And the burst starts at the beginning rather than a window in.
    expect(rms(0, 1000)).toBeGreaterThan(quiet * 2);
  });

  it("comes back the length it was given", () => {
    const dirty = withNoise(tone(RATE + 137, 1000), 0.05);

    expect(denoiseChannel(dirty, DENOISE_DEFAULTS).length).toBe(dirty.length);
  });
});
