import { fft, hann, ifft } from "./fft";

/**
 * Spectral noise reduction: the thing a "denoise" button is actually asked for, and the thing the two
 * cut filters beside it cannot do.
 *
 * A low cut takes away a band. That handles rumble under a voice and hiss above it, and it is useless
 * against the noise a voice shares a band with — a fan, a hard drive, a room. What separates those is
 * that noise is *steady* while speech is not: over a few seconds a noisy bin sits at roughly the same
 * level the whole time, and a bin carrying a voice swings by tens of decibels. So the noise floor can
 * be learned per bin from the recording itself, and each bin can then be turned down by however much
 * of it is floor.
 *
 * This is spectral subtraction with a gain floor, which is what Audacity's noise reduction is and what
 * every broadcast denoiser starts from. It runs over the decoded buffer once rather than as a live
 * insert: the analysis wants the whole recording, and a fan that is measured over four seconds is
 * measured better than one estimated from the last 512 samples.
 */

/** The transform size, and the hop between windows. */
const WINDOW = 2048;
const HOP = WINDOW / 4;

/**
 * Which windows the floor is learned from: the quietest fifth of them.
 *
 * The pauses, in other words -- and that is the whole trick. Between words, between notes, between
 * takes, the only thing left in the signal is the noise, so those windows *are* a measurement of it. A
 * per-bin percentile over every window would instead be contaminated by the voice itself in exactly
 * the bins the voice occupies, and subtracting that estimate would take the voice out along with the
 * fan.
 *
 * A recording with no pause anywhere -- a sustained tone, an unbroken drone -- has no window where the
 * noise is alone, and no measurement can tell a steady signal from steady noise. That is what
 * stationarity means rather than a shortcoming of this estimate, and it is why the amount is a knob.
 */
const QUIET_SHARE = 0.2;

export interface DenoiseSettings {
  /**
   * How much of the floor to take away, as a multiple of it. At 1 the estimated noise is subtracted
   * once, which leaves an audible remainder; at 2 to 3 the noise goes and the artefacts start.
   */
  amount: number;
  /**
   * How far down a bin may be pushed, in decibels. Never to silence: a bin gated to zero and back on
   * again in the next window is the warble that gives cheap noise reduction away, and leaving a floor
   * of noise under the signal is what keeps it sounding like a room rather than like a phone line.
   */
  floorDb: number;
}

export const DENOISE_DEFAULTS: DenoiseSettings = { amount: 1.5, floorDb: -18 };

/**
 * The noise floor of one channel, per bin, in linear magnitude.
 *
 * Exported because it is the honest half of the operation to be able to look at: a caller that wants
 * to know what this thinks the noise is can ask, and the test does exactly that.
 */
export function noiseFloor(channel: Float32Array<ArrayBuffer>): Float64Array {
  const bins = WINDOW / 2 + 1;
  const window = hann(WINDOW);
  const spectra: Float64Array[] = [];
  const energies: number[] = [];
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  for (let start = 0; start + WINDOW <= channel.length; start += HOP) {
    for (let i = 0; i < WINDOW; i += 1) {
      re[i] = channel[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const magnitudes = new Float64Array(bins);
    let energy = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      const magnitude = Math.hypot(re[bin]!, im[bin]!);
      magnitudes[bin] = magnitude;
      energy += magnitude * magnitude;
    }
    spectra.push(magnitudes);
    energies.push(energy);
  }
  const floor = new Float64Array(bins);
  if (spectra.length === 0) return floor;
  // The quietest windows by total energy, averaged bin by bin. Averaged rather than taken as the one
  // quietest: a window is 43 ms and its spectrum is noisy in the statistical sense, so a floor built
  // from a single one would have its own peaks and troughs -- and every trough lets that bin's noise
  // straight through.
  const order = energies
    .map((energy, index) => ({ energy, index }))
    .sort((a, b) => a.energy - b.energy);
  const quiet = order.slice(0, Math.max(1, Math.round(order.length * QUIET_SHARE)));
  for (const { index } of quiet) {
    const magnitudes = spectra[index]!;
    for (let bin = 0; bin < bins; bin += 1) floor[bin]! += magnitudes[bin]! / quiet.length;
  }
  return floor;
}

/**
 * One channel, denoised.
 *
 * Overlap-add at a quarter-window hop, so four periodic Hann windows cover every sample and sum to a
 * constant — which is what makes a pass with the gain left at 1 return the input rather than a version
 * of it with a ripple through it. The gain per bin is smoothed across its two neighbours before it is
 * applied: a gain that jumps from bin to bin rings, and the ringing is heard as a metallic edge on
 * every consonant.
 *
 * A recording shorter than one window comes back untouched. There is nothing to learn a floor from,
 * and a guess over 40 ms of audio would be the loudest thing in it.
 */
export function denoiseChannel(
  channel: Float32Array<ArrayBuffer>,
  settings: DenoiseSettings = DENOISE_DEFAULTS,
): Float32Array<ArrayBuffer> {
  if (channel.length < WINDOW) return channel;
  const amount = Math.max(0, settings.amount);
  if (amount === 0) return channel;
  const gainFloor = 10 ** (Math.min(0, settings.floorDb) / 20);
  const floor = noiseFloor(channel);
  const bins = WINDOW / 2 + 1;
  const window = hann(WINDOW);

  // A window of silence at each end, and the real samples in the middle.
  //
  // Without it the first and last samples of a clip are covered by one window instead of four, and
  // that window's own taper is nearly zero there. Dividing what the resynthesis produced by a window
  // sum of nearly zero is a division by nearly zero: the ends of every clip came out eighteen times
  // too loud, which a test on ratios inside the file did not see and a peak reading did at once.
  // Padded, every real sample is covered the same number of times and the sum is a constant.
  const padded = new Float32Array(channel.length + 2 * WINDOW);
  padded.set(channel, WINDOW);

  const out = new Float64Array(padded.length);
  const weight = new Float64Array(padded.length);
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  const gain = new Float64Array(bins);

  for (let start = 0; start + WINDOW <= padded.length; start += HOP) {
    for (let i = 0; i < WINDOW; i += 1) {
      re[i] = padded[start + i]! * window[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let bin = 0; bin < bins; bin += 1) {
      const magnitude = Math.hypot(re[bin]!, im[bin]!);
      // Spectral subtraction, expressed as a gain rather than as a new magnitude: a gain leaves the
      // phase of the bin untouched, and phase is what makes a reconstruction sound like the original
      // rather than like a vocoder.
      const kept = magnitude - amount * floor[bin]!;
      gain[bin] = magnitude <= 0 ? 1 : Math.max(gainFloor, kept / magnitude);
    }
    for (let bin = 0; bin < bins; bin += 1) {
      const low = gain[Math.max(0, bin - 1)]!;
      const high = gain[Math.min(bins - 1, bin + 1)]!;
      const smooth = (low + 2 * gain[bin]! + high) / 4;
      re[bin]! *= smooth;
      im[bin]! *= smooth;
      // The upper half of the spectrum is the conjugate of the lower one, and a real signal only
      // comes back out of the inverse transform if it stays that way.
      const mirror = WINDOW - bin;
      if (bin > 0 && mirror > bins - 1 && mirror < WINDOW) {
        re[mirror]! *= smooth;
        im[mirror]! *= smooth;
      }
    }
    ifft(re, im);
    for (let i = 0; i < WINDOW; i += 1) {
      out[start + i]! += re[i]! * window[i]!;
      weight[start + i]! += window[i]! * window[i]!;
    }
  }

  const cleaned = new Float32Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) {
    const at = i + WINDOW;
    // The window sum is a constant across every real sample now, so this is a normalisation and not
    // a rescue. The guard is what a sample the loop never reached would fall back to.
    cleaned[i] = weight[at]! > 1e-3 ? out[at]! / weight[at]! : channel[i]!;
  }
  return cleaned;
}
