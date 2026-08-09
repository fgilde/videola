// Integrated loudness to ITU-R BS.1770 / EBU R128, in LUFS.
//
// Ported from Audiola's `LoudnessMeter` and `Biquad`. The K-weighting parameters are recomputed per
// sample rate from the RBJ cookbook formulas rather than taken from the 48 kHz coefficient table
// printed in BS.1770, so a 44.1 kHz project measures as correctly as a 48 kHz one -- which the
// tests hold it to.
//
// Not `BiquadFilterNode` and an OfflineAudioContext, although the filters are the same ones: a
// measurement that needs an audio context cannot run in a worker, and the whole reason to have this
// as arithmetic is that a value read from a rendered graph is a value nothing can check.

// The K-weighting, as BS.1770 specifies it and pyloudnorm implements it. Round numbers, and that is
// the point: with these the recomputed coefficients reproduce the 48 kHz table printed in the
// standard to five decimal places.
//
// Audiola carries a fitted-looking set here instead (shelf 1681.974/0.707175/3.999844, high-pass
// 38.135/0.500327). Those do not reproduce the table: they put only +0.44 dB of K-weighting at
// 1 kHz where the standard has +0.70, and a meter built on them reads 0.25 LU too quiet at every
// level. Measured, not assumed -- the first three compliance cases all failed by that same 0.253.
const SHELF_FC = 1500;
const SHELF_Q = Math.SQRT1_2;
const SHELF_GAIN_DB = 4;
const HIGHPASS_FC = 38;
const HIGHPASS_Q = 0.5;

const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
// The offset that makes a 1 kHz sine at -23 dBFS read -23.0 LUFS: it cancels the K-weighting's gain
// at 1 kHz. BS.1770 prints it to three places and so does this.
const OFFSET = -0.691;

export const LOUDNESS_BLOCK_SECONDS = BLOCK_SECONDS;

// ponytail: channel weights are 1.0 throughout, which is BS.1770 for mono and stereo and wrong for
// surround -- Ls and Rs weigh 1.41 there. Nothing in the project model carries a channel layout to
// tell a rear channel from a front one, so there is nothing to key the weight off yet.
export function integratedLufs(
  channels: readonly Float32Array[],
  sampleRate: number,
): number {
  const frames = channels[0]?.length ?? 0;
  const blockSize = Math.round(BLOCK_SECONDS * sampleRate);
  const hop = Math.round(HOP_SECONDS * sampleRate);
  // The only guard that carries anything: a rate low enough to round the hop to zero would leave the
  // block loop below advancing by nothing. Signals shorter than a block need no guard of their own --
  // the loop's own bound finds no block in them and the gates then have nothing to average, which is
  // the same "no reading" by a shorter route. R128 has nothing to say about 300 ms of audio.
  if (hop < 1) return Number.NEGATIVE_INFINITY;

  const weighted = channels.map((plane) => kWeighted(plane, sampleRate));
  // Kept per block so the two gates can be applied to the same energies rather than to a second
  // pass over the samples.
  const energies: number[] = [];
  for (let start = 0; start + blockSize <= frames; start += hop) {
    let z = 0;
    for (const plane of weighted) {
      let sum = 0;
      for (let i = start; i < start + blockSize; i += 1) sum += plane[i]! * plane[i]!;
      z += sum / blockSize;
    }
    energies.push(z);
  }

  const loud = (z: number): number => OFFSET + 10 * Math.log10(z + 1e-12);
  const aboveAbsolute = energies.filter((z) => loud(z) >= ABSOLUTE_GATE_LUFS);
  if (aboveAbsolute.length === 0) return Number.NEGATIVE_INFINITY;

  // The relative gate is measured against the mean of what survived the absolute one, which is why
  // this cannot be one pass: the threshold does not exist until the first mean does.
  const threshold = loud(mean(aboveAbsolute)) + RELATIVE_GATE_LU;
  const gated = aboveAbsolute.filter((z) => loud(z) >= threshold);
  if (gated.length === 0) return Number.NEGATIVE_INFINITY;
  return loud(mean(gated));
}

// Sample peak, not true peak: an inter-sample peak needs oversampling, and a mixer meter is read by
// eye at a glance. Silence falls out as -Infinity on its own, because log10(0) already is.
export function peakDbfs(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const plane of channels) {
    for (const sample of plane) {
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return 20 * Math.log10(peak);
}

/**
 * What one strip of a meter shows, all three in dBFS. Peak is the loudest sample in the window and
 * says whether anything clipped; `rms` is the effective value and is what the eye reads as loudness;
 * `hold` is the falling marker that keeps a transient visible long enough to be seen.
 */
export interface Level {
  peak: number;
  rms: number;
  hold: number;
}

export const SILENT_LEVEL: Level = {
  peak: Number.NEGATIVE_INFINITY,
  rms: Number.NEGATIVE_INFINITY,
  hold: Number.NEGATIVE_INFINITY,
};

// How fast the hold marker gives up the peak under it. A marker that never falls is a high-water
// line for the session rather than a meter, and one that falls with the signal is not a hold at all;
// twenty a second puts a full-scale hit back on the floor in the three seconds an eye needs.
const HOLD_FALL_DB_PER_SECOND = 20;

/**
 * One reading, from one window of samples. Pure arithmetic on purpose: where the samples came from
 * -- an `AnalyserNode` on a live bus or a plane out of an offline render -- decides nothing about
 * what the numbers mean, which is what makes a running meter checkable at all.
 *
 * `elapsed` is the wall time since `previous` was taken and is the only thing the hold's fall is
 * measured in, so a meter driven at thirty frames and one driven at sixty decay at the same rate.
 */
export function levelFrom(
  channels: readonly Float32Array[],
  previous: Level = SILENT_LEVEL,
  elapsed = 0,
): Level {
  const peak = peakDbfs(channels);
  const fallen = previous.hold - HOLD_FALL_DB_PER_SECOND * elapsed;
  return { peak, rms: rmsDbfs(channels), hold: Math.max(peak, fallen) };
}

// Across all channels at once rather than per channel and averaged: the meter shows what the bus
// carries, and two channels of the same signal are as loud as one of it.
function rmsDbfs(channels: readonly Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const plane of channels) {
    for (const sample of plane) sum += sample * sample;
    count += plane.length;
  }
  if (count === 0 || sum === 0) return Number.NEGATIVE_INFINITY;
  return 10 * Math.log10(sum / count);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

// The two stages of the K-weighting: a high shelf standing in for the head's response, then a
// high-pass that stops rumble from being counted as loudness.
function kWeighted(plane: Float32Array, sampleRate: number): Float32Array {
  const shelved = filter(plane, highShelf(sampleRate, SHELF_FC, SHELF_Q, SHELF_GAIN_DB));
  return filter(shelved, highPass(sampleRate, HIGHPASS_FC, HIGHPASS_Q), shelved);
}

// Direct Form I. Written into `into` when the caller has a scratch buffer to spare, because the two
// stages otherwise allocate a second copy of the whole signal for nothing.
function filter(plane: Float32Array, c: Coefficients, into?: Float32Array): Float32Array {
  const out = into ?? new Float32Array(plane.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < plane.length; i += 1) {
    const x0 = plane[i]!;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

// Normalised by a0 once here rather than divided by it per sample, which is the same filter and one
// division instead of five per sample.
function normalize(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// The numerator stays [1, -2, 1] and only the denominator is divided by a0. The RBJ cookbook would
// scale the numerator by (1 + cos)/2 as well, and that is a filter with unity gain in its passband
// rather than the one BS.1770 tabulates -- worth another 0.043 dB off every reading.
function highPass(fs: number, fc: number, q: number): Coefficients {
  const w0 = (2 * Math.PI * fc) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: 1, b1: -2, b2: 1, a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0 };
}

function highShelf(fs: number, fc: number, q: number, gainDb: number): Coefficients {
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const sloped = 2 * Math.sqrt(a) * alpha;
  return normalize(
    a * (a + 1 + (a - 1) * cos + sloped),
    -2 * a * (a - 1 + (a + 1) * cos),
    a * (a + 1 + (a - 1) * cos - sloped),
    a + 1 - (a - 1) * cos + sloped,
    2 * (a - 1 - (a + 1) * cos),
    a + 1 - (a - 1) * cos - sloped,
  );
}
