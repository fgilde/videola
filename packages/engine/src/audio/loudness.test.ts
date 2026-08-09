import { describe, expect, it } from "vitest";

import { integratedLufs, levelFrom, peakDbfs, SILENT_LEVEL } from "./loudness";

const RATE = 48_000;

// EBU Tech 3341 states its compliance cases in dBFS peak and the reading it expects in LUFS, so the
// tests are written the same way round: build the signal the document describes, read the number the
// document names.
function sine(dbfs: number, seconds: number, rate = RATE, hz = 1000): Float32Array {
  const amplitude = Math.pow(10, dbfs / 20);
  const frames = Math.round(seconds * rate);
  const plane = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) plane[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return plane;
}

const stereo = (plane: Float32Array): Float32Array[] => [plane, plane];

function join(...planes: Float32Array[]): Float32Array {
  const total = planes.reduce((sum, plane) => sum + plane.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const plane of planes) {
    out.set(plane, offset);
    offset += plane.length;
  }
  return out;
}

describe("integratedLufs against the EBU Tech 3341 compliance cases", () => {
  // Case 1. This is the whole calibration of the thing: the -0.691 offset exists to cancel the
  // K-weighting's gain at 1 kHz, and if either is wrong this reading is not -23.
  it("reads -23.0 LUFS for a 1 kHz stereo sine at -23 dBFS", () => {
    expect(integratedLufs(stereo(sine(-23, 1)), RATE)).toBeCloseTo(-23, 1);
  });

  // Case 2, which catches a meter that happens to be calibrated at one level only.
  it("reads -33.0 LUFS for the same sine 10 dB down", () => {
    expect(integratedLufs(stereo(sine(-33, 1)), RATE)).toBeCloseTo(-33, 1);
  });

  it("reads -20.0 LUFS at -20 dBFS", () => {
    expect(integratedLufs(stereo(sine(-20, 1)), RATE)).toBeCloseTo(-20, 1);
  });
});

describe("integratedLufs gating", () => {
  // Case 3, at its stated length. The segment lengths are not decoration: the gates work on 400 ms
  // blocks at a 100 ms hop, so how far a quiet stretch pulls the ungated mean -- and therefore
  // whether the relative gate reaches down to it at all -- depends on how long it runs. A shortened
  // version of this signal reads about -24 and is right to.
  it("gates out ten-second quiet stretches around a minute of programme", () => {
    const signal = join(sine(-36, 10), sine(-23, 60), sine(-36, 10));

    expect(integratedLufs(stereo(signal), RATE)).toBeCloseTo(-23, 1);
  });

  // Case 4. The -72 LUFS stretches fall below the absolute gate and the -36 ones below the relative
  // gate, so two different gates have to fire for this to read the same as case 3.
  it("gates out stretches below the absolute gate as well", () => {
    const signal = join(sine(-72, 10), sine(-36, 10), sine(-23, 60), sine(-36, 10), sine(-72, 10));

    expect(integratedLufs(stereo(signal), RATE)).toBeCloseTo(-23, 1);
  });

  // Without the relative gate this reads about -24.2: the whole point of gating is that the quiet
  // parts of a programme do not decide its loudness.
  it("would read lower if the quiet stretches counted", () => {
    const signal = join(sine(-36, 10), sine(-23, 60), sine(-36, 10));
    const gated = integratedLufs(stereo(signal), RATE);
    const ungated = integratedLufs(stereo(sine(-23, 60)), RATE);

    expect(gated).toBeGreaterThan(-23.5);
    expect(gated).toBeCloseTo(ungated, 1);
  });

  // BS.1770 computes the relative threshold from the blocks that survived the absolute gate, not
  // from all of them. With this much digital silence the difference decides the reading: silence
  // counted into the mean drags it down by five LU, the threshold follows it down, and the -36 dBFS
  // stretch then slips through a gate that should have stopped it.
  it("measures the relative threshold against the blocks the absolute gate kept", () => {
    const signal = join(sine(-23, 20), sine(-36, 5), new Float32Array(RATE * 60));

    expect(integratedLufs(stereo(signal), RATE)).toBeCloseTo(-23, 1);
  });

  // The 100 ms hop is what puts a block boundary near enough to the end of a clip that a loud tail
  // is measured at all. Stepping a whole block at a time leaves the last 400 ms unreachable, and a
  // short clip that ends loud then measures as the quiet part it opened with.
  it("measures a loud tail at the end of a short clip", () => {
    const signal = join(sine(-50, 0.4), sine(-20, 0.35));

    expect(integratedLufs(stereo(signal), RATE)).toBeGreaterThan(-30);
  });

  // A block that straddles the edge between silence and programme is half as loud and counts as
  // written: R128 gates on level, not on where an edit happens to be.
  it("counts a block that straddles an edit rather than dropping it", () => {
    const signal = join(new Float32Array(RATE), sine(-23, 1), new Float32Array(RATE));

    const reading = integratedLufs(stereo(signal), RATE);
    expect(reading).toBeLessThan(-23);
    expect(reading).toBeGreaterThan(-25);
  });

  it("has no reading for silence", () => {
    expect(integratedLufs(stereo(new Float32Array(RATE)), RATE)).toBe(Number.NEGATIVE_INFINITY);
  });
});

// The two filter stages are only visible through the reading, so this is where they get checked: a
// meter with the wrong corner frequency still reads -23 at 1 kHz if its offset absorbs the error.
describe("the K-weighting the reading is built on", () => {
  // Above the shelf's corner the weighting is its full +4 dB, against +0.70 dB at 1 kHz, so the same
  // amplitude at 10 kHz has to read about 3.3 LU louder.
  it("weights high frequencies up by the shelf's gain", () => {
    const high = integratedLufs(stereo(sine(-23, 1, RATE, 10_000)), RATE);
    const mid = integratedLufs(stereo(sine(-23, 1, RATE, 1000)), RATE);

    expect(high - mid).toBeCloseTo(3.3, 1);
  });

  // The high-pass is what stops a rumble or a DC offset from being counted as programme loudness.
  it("weights rumble down to nothing much", () => {
    const low = integratedLufs(stereo(sine(-23, 1, RATE, 10)), RATE);

    expect(low).toBeLessThan(-40);
  });

  it("leaves the shelf's plateau flat", () => {
    const at8k = integratedLufs(stereo(sine(-23, 1, RATE, 8000)), RATE);
    const at12k = integratedLufs(stereo(sine(-23, 1, RATE, 12_000)), RATE);

    expect(at12k).toBeCloseTo(at8k, 1);
  });
});

describe("integratedLufs across sample rates and channel counts", () => {
  // The reason the coefficients are recomputed from the formulas instead of read off the 48 kHz
  // table in BS.1770: a project at 44.1 kHz has to measure the same as the same programme at 48.
  it("reads the same at 44.1 kHz as at 48 kHz", () => {
    const at48 = integratedLufs(stereo(sine(-23, 1, 48_000)), 48_000);
    const at441 = integratedLufs(stereo(sine(-23, 1, 44_100)), 44_100);

    expect(at441).toBeCloseTo(at48, 1);
  });

  // Loudness sums energy over channels, so the same signal on one channel is 3 dB quieter than on
  // two. That is the standard's answer, not a bug to be normalised away.
  it("reads a mono signal 3 LU below the same signal in stereo", () => {
    const plane = sine(-23, 1);

    expect(integratedLufs([plane], RATE)).toBeCloseTo(integratedLufs(stereo(plane), RATE) - 3.01, 1);
  });
});

describe("integratedLufs on what R128 has nothing to say about", () => {
  // Under one 400 ms block there is no gating window at all. A shorter window invented for the
  // occasion would answer a question the standard does not ask.
  it("refuses to measure less than one block", () => {
    expect(integratedLufs(stereo(sine(-23, 0.3)), RATE)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("measures exactly one block", () => {
    expect(integratedLufs(stereo(sine(-23, 0.4)), RATE)).toBeCloseTo(-23, 1);
  });

  it("has no reading for no channels", () => {
    expect(integratedLufs([], RATE)).toBe(Number.NEGATIVE_INFINITY);
  });

  // A rate this low rounds the 100 ms hop to zero, and a loop that advances by zero does not come
  // back. Unreachable from an AudioBuffer and reachable from a caller with a number, so it is a hang
  // rather than a wrong answer -- which is why the guard is worth its line. This test hangs without it.
  it("refuses a sample rate too low to form a hop", () => {
    expect(integratedLufs([new Float32Array(1000)], 1)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("peakDbfs", () => {
  it("reads full scale as zero", () => {
    expect(peakDbfs([Float32Array.from([0.5, -1, 0.2])])).toBeCloseTo(0, 6);
  });

  it("reads the loudest channel, not the first", () => {
    expect(peakDbfs([Float32Array.from([0.1]), Float32Array.from([1])])).toBeCloseTo(0, 6);
  });

  it("reads a half-scale signal as -6 dBFS", () => {
    expect(peakDbfs([Float32Array.from([0.5])])).toBeCloseTo(-6.02, 1);
  });

  // Negative infinity rather than a large negative number, so a silent channel prints the same way
  // an absent measurement does instead of as a very quiet one.
  it("has no reading for silence", () => {
    expect(peakDbfs([new Float32Array(8)])).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("levelFrom", () => {
  // The two numbers a meter shows are not the same number: a sine's peak stands 3.01 dB above its
  // own effective value, and a meter that drew one bar for both would be lying about one of them.
  it("reads a full-scale sine as 0 dBFS peak and -3 dBFS effective", () => {
    const level = levelFrom(stereo(sine(0, 0.1)));

    expect(level.peak).toBeCloseTo(0, 1);
    expect(level.rms).toBeCloseTo(-3.01, 1);
  });

  it("follows the signal down", () => {
    const level = levelFrom(stereo(sine(-20, 0.1)));

    expect(level.peak).toBeCloseTo(-20, 1);
    expect(level.rms).toBeCloseTo(-23.01, 1);
  });

  // A square wave has no crest factor at all, which is what separates this from a scaled sine: any
  // implementation that derived one reading from the other by a fixed 3 dB gets this one wrong.
  it("reads a half-scale square wave the same peak and effective value", () => {
    const plane = Float32Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? 0.5 : -0.5));
    const level = levelFrom([plane]);

    expect(level.peak).toBeCloseTo(-6.02, 1);
    expect(level.rms).toBeCloseTo(-6.02, 1);
  });

  it("has no reading for silence", () => {
    expect(levelFrom([new Float32Array(64)])).toEqual(SILENT_LEVEL);
  });

  it("has no reading for no channels", () => {
    expect(levelFrom([])).toEqual(SILENT_LEVEL);
  });
});

describe("the peak hold marker", () => {
  const loud = (): readonly Float32Array[] => [Float32Array.from([1])];
  const quiet = (): readonly Float32Array[] => [Float32Array.from([0.1])];

  it("takes the peak when the peak is the higher of the two", () => {
    expect(levelFrom(loud(), SILENT_LEVEL, 0.016).hold).toBeCloseTo(0, 6);
  });

  // The whole point of a hold: the peak has gone and the marker is still where it was, because a
  // transient that lasts one buffer is a transient nobody sees without one.
  it("stays above a peak that has already fallen away", () => {
    const first = levelFrom(loud(), SILENT_LEVEL, 0.016);
    const second = levelFrom(quiet(), first, 0.016);

    expect(second.peak).toBeCloseTo(-20, 1);
    expect(second.hold).toBeCloseTo(-0.32, 2);
  });

  // 20 dB a second, so a full-scale hit is back at the floor inside four seconds rather than
  // standing there for the rest of the session.
  it("falls at twenty decibels a second", () => {
    const held = { peak: 0, rms: 0, hold: 0 };

    expect(levelFrom(quiet(), held, 0.5).hold).toBeCloseTo(-10, 6);
    expect(levelFrom(quiet(), held, 1).hold).toBeCloseTo(-20, 6);
  });

  // Falling past the signal underneath it would leave the marker below the bar it marks.
  it("never falls below the peak it is marking", () => {
    const held = { peak: 0, rms: 0, hold: 0 };

    expect(levelFrom(quiet(), held, 10).hold).toBeCloseTo(-20, 1);
  });
});
