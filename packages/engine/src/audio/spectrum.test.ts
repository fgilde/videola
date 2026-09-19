import { describe, expect, it } from "vitest";

import { analyseSpectrum } from "./spectrum";

const RATE = 48000;

function tone(hz: number, seconds: number, gain = 0.8): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * gain;
  }
  return samples;
}

/** Which band came out loudest, which is the only question a bar chart really answers. */
function loudest(bands: Float32Array): number {
  let best = 0;
  for (let band = 1; band < bands.length; band += 1) {
    if ((bands[band] ?? 0) > (bands[best] ?? 0)) best = band;
  }
  return best;
}

describe("the spectrum a visualiser is drawn from", () => {
  // The whole reason this is a table and not an AnalyserNode: the same audio has to give the same
  // picture, in the preview and in the exported file, on every machine.
  it("gives the same rows for the same audio, every time", () => {
    const audio = [tone(440, 0.5)];

    const once = analyseSpectrum(audio, RATE);
    const twice = analyseSpectrum(audio, RATE);

    expect(once.rows).toBe(twice.rows);
    expect([...once.at(0.25).bands]).toEqual([...twice.at(0.25).bands]);
  });

  it("puts a low tone in a low band and a high tone in a high one", () => {
    const low = analyseSpectrum([tone(80, 0.4)], RATE).at(0.2);
    const high = analyseSpectrum([tone(6000, 0.4)], RATE).at(0.2);

    expect(loudest(low.bands)).toBeLessThan(12);
    expect(loudest(high.bands)).toBeGreaterThan(45);
  });

  // Logarithmic spacing is the point: linear bins spend most of the chart above 5 kHz, where a mix
  // has nothing to show, and crush everything anybody wants to see into the first two bars.
  it("spreads the bands over what a listener can tell apart", () => {
    const spectrum = analyseSpectrum([tone(440, 0.4)], RATE);

    const band = loudest(spectrum.at(0.2).bands);

    expect(band).toBeGreaterThan(14);
    expect(band).toBeLessThan(34);
  });

  it("reads silence as nothing at all", () => {
    const spectrum = analyseSpectrum([new Float32Array(RATE / 2)], RATE);

    const frame = spectrum.at(0.25);

    expect(frame.level).toBe(0);
    expect(Math.max(...frame.bands)).toBe(0);
  });

  // A bar that dropped as fast as it rose would be a strobe. The rise has to land on the frame the
  // hit happened on; the fall is what makes the chart readable.
  it("rises at once and falls back slowly", () => {
    const silence = new Float32Array(Math.round(0.2 * RATE));
    const hit = tone(440, 0.05);
    const after = new Float32Array(Math.round(0.3 * RATE));
    const audio = new Float32Array(silence.length + hit.length + after.length);
    audio.set(hit, silence.length);

    const spectrum = analyseSpectrum([audio], RATE);
    const band = loudest(spectrum.at(0.22).bands);
    const during = spectrum.at(0.22).bands[band] ?? 0;
    const justAfter = spectrum.at(0.28).bands[band] ?? 0;
    const later = spectrum.at(0.45).bands[band] ?? 0;

    expect(during).toBeGreaterThan(0.3);
    expect(justAfter).toBeGreaterThan(during * 0.2);
    expect(later).toBeLessThan(justAfter);
  });

  it("marks the instant the music hits", () => {
    const silence = new Float32Array(Math.round(0.3 * RATE));
    const hit = tone(120, 0.2, 1);
    const audio = new Float32Array(silence.length + hit.length);
    audio.set(hit, silence.length);

    const spectrum = analyseSpectrum([audio], RATE);

    expect(spectrum.at(0.15).beat).toBe(0);
    expect(spectrum.at(0.32).beat).toBeGreaterThan(0.3);
  });

  // Two channels are one picture. Averaged rather than summed, or a stereo mix would clip itself
  // before a single bar was drawn.
  it("mixes the channels down rather than adding them up", () => {
    const one = analyseSpectrum([tone(440, 0.3)], RATE).at(0.15);
    const two = analyseSpectrum([tone(440, 0.3), tone(440, 0.3)], RATE).at(0.15);

    expect(two.level).toBeCloseTo(one.level, 5);
  });

  it("answers for an instant past the end without falling over", () => {
    const spectrum = analyseSpectrum([tone(440, 0.1)], RATE);

    const frame = spectrum.at(9999);

    expect(frame.bands.length).toBe(spectrum.bandCount);
    expect(Number.isFinite(frame.level)).toBe(true);
  });

  it("has nothing to say about no audio at all", () => {
    const spectrum = analyseSpectrum([], RATE);

    expect(spectrum.rows).toBe(0);
    expect(spectrum.at(1).level).toBe(0);
  });
});
