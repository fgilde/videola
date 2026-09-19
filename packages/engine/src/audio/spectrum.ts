import { AudioGraph, type AudioBufferSource } from "./graph";
import { fft, hann } from "./fft";

import type { EffectParams, Project } from "@videola/core";

/**
 * What the sound looks like, frame by frame, so a picture can be drawn from it.
 *
 * Computed once from the mixed audio rather than read off a live `AnalyserNode`, and that is the
 * whole point: an analyser answers "what is coming out of the speakers right now", which depends on
 * when the browser got round to asking. A visualiser drawn from that is a different picture in the
 * preview and in the exported file, on every machine, every time. This is a table -- one row per
 * hop, the same rows for everybody -- and the export reads the very same table the preview drew
 * from, because both are handed the same mix.
 *
 * Bands are spaced logarithmically, because hearing is: sixty-four linear bins would spend fifty of
 * them above 5 kHz, where a mix has almost nothing to show, and crush the bass everybody wants to
 * see into two.
 */
export interface SpectrumOptions {
  /** How often the picture can change. 60 rows a second is one per frame at the usual rates. */
  hopSeconds?: number;
  /** How many bands the picture is drawn from. */
  bands?: number;
  /** The window, in samples. A power of two, because the transform is radix-2. */
  window?: number;
  /** The quietest thing worth drawing, in dBFS. Below it a band reads as nothing. */
  floorDb?: number;
  /** How quickly a band falls back. 0 holds forever, 1 follows the sound exactly. */
  release?: number;
}

export interface SoundFrame {
  /** The instant this row stands for, in seconds from the start of the timeline. */
  at: number;
  /** One number per band, 0 to 1. */
  bands: Float32Array;
  /** How loud the whole thing is right now, 0 to 1. */
  level: number;
  /** How much louder it just got: 0 most of the time, 1 on a hit. */
  beat: number;
}

const DEFAULTS = {
  hopSeconds: 1 / 60,
  bands: 64,
  window: 2048,
  floorDb: -62,
  release: 0.22,
} satisfies Required<SpectrumOptions>;

export class Spectrum {
  readonly hopSeconds: number;
  readonly bandCount: number;
  readonly rows: number;
  /** `rows * bandCount`, row-major: the flat array is one allocation instead of a row per hop. */
  readonly #values: Float32Array;
  readonly #level: Float32Array;
  readonly #beat: Float32Array;
  #frame: SoundFrame;

  constructor(
    values: Float32Array,
    level: Float32Array,
    beat: Float32Array,
    bandCount: number,
    hopSeconds: number,
  ) {
    this.#values = values;
    this.#level = level;
    this.#beat = beat;
    this.bandCount = bandCount;
    this.hopSeconds = hopSeconds;
    this.rows = level.length;
    this.#frame = { at: 0, bands: new Float32Array(bandCount), level: 0, beat: 0 };
  }

  /**
   * The row at an instant, interpolated between the two it falls between.
   *
   * Interpolated rather than nearest, because a hop is 16 ms and a frame is 16 ms: taking the
   * nearest row makes bars that jitter by a whole hop whenever the two clocks drift past each other.
   *
   * The frame handed back is reused. Every caller paints from it and forgets it, and one allocation
   * per drawn frame times sixty frames a second times the length of a song is a lot of garbage for
   * an array nobody keeps.
   */
  at(seconds: number): SoundFrame {
    const frame = this.#frame;
    frame.at = seconds;
    if (this.rows === 0) {
      frame.bands.fill(0);
      frame.level = 0;
      frame.beat = 0;
      return frame;
    }
    const position = Math.min(Math.max(seconds / this.hopSeconds, 0), this.rows - 1);
    const left = Math.floor(position);
    const right = Math.min(left + 1, this.rows - 1);
    const mix = position - left;
    for (let band = 0; band < this.bandCount; band += 1) {
      const a = this.#values[left * this.bandCount + band] ?? 0;
      const b = this.#values[right * this.bandCount + band] ?? 0;
      frame.bands[band] = a + (b - a) * mix;
    }
    frame.level = (this.#level[left] ?? 0) + ((this.#level[right] ?? 0) - (this.#level[left] ?? 0)) * mix;
    frame.beat = Math.max(this.#beat[left] ?? 0, this.#beat[right] ?? 0);
    return frame;
  }
}

/**
 * The table, from the mix.
 *
 * The channels are the ones the export writes and the preview plays -- mixed down to mono here,
 * because a bar chart of a stereo field is two pictures nobody asked for and the one thing a
 * visualiser has to agree with is the sound in the room.
 */
export function analyseSpectrum(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: SpectrumOptions = {},
): Spectrum {
  const { hopSeconds, bands, window, floorDb, release } = { ...DEFAULTS, ...options };
  const samples = mono(channels);
  const hop = Math.max(1, Math.round(hopSeconds * sampleRate));
  const rows = samples.length === 0 ? 0 : Math.max(1, Math.ceil(samples.length / hop));
  const edges = bandEdges(bands, window, sampleRate);
  const shape = hann(window);
  const re = new Float64Array(window);
  const im = new Float64Array(window);
  const values = new Float32Array(rows * bands);
  const level = new Float32Array(rows);
  const beat = new Float32Array(rows);
  const held = new Float32Array(bands);

  for (let row = 0; row < rows; row += 1) {
    const start = row * hop;
    // Centred on the hop rather than starting at it: a window that began at the instant would
    // report a hit a window's length after it happened, which on a kick drum is visibly late.
    const from = Math.max(0, start - (window >> 1));
    let sum = 0;
    for (let i = 0; i < window; i += 1) {
      const sample = samples[from + i] ?? 0;
      sum += sample * sample;
      re[i] = sample * (shape[i] ?? 0);
      im[i] = 0;
    }
    fft(re, im);
    level[row] = Math.min(1, Math.sqrt(sum / window) * 3);

    for (let band = 0; band < bands; band += 1) {
      const low = edges[band] ?? 0;
      const high = Math.max(low + 1, edges[band + 1] ?? low + 1);
      let peak = 0;
      for (let bin = low; bin < high; bin += 1) {
        const magnitude = Math.hypot(re[bin] ?? 0, im[bin] ?? 0) / (window / 4);
        if (magnitude > peak) peak = magnitude;
      }
      // dB, clamped to the floor and mapped to 0..1. Amplitude in a linear scale is a chart where
      // everything but the kick drum is a flat line.
      const db = 20 * Math.log10(Math.max(peak, 1e-7));
      const value = Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
      // Instant attack, slow release: the rise is the hit and has to land on the frame it happened
      // on, and the fall is what makes a bar chart readable rather than a strobe.
      const previous = held[band] ?? 0;
      const smoothed = value > previous ? value : previous + (value - previous) * release;
      held[band] = smoothed;
      values[row * bands + band] = smoothed;
    }
  }

  fillBeats(level, beat);
  return new Spectrum(values, level, beat, bands, hopSeconds);
}

/**
 * How much louder this row is than the recent past, 0 to 1.
 *
 * A whole beat tracker is a different feature -- the editor already has one, on the timeline, for
 * cutting to. What a visualiser needs is smaller: something that goes to one when the music hits so
 * a picture can flinch, and back to zero while nothing happens.
 */
function fillBeats(level: Float32Array, beat: Float32Array): void {
  const window = 24;
  for (let row = 0; row < level.length; row += 1) {
    let sum = 0;
    let counted = 0;
    for (let back = Math.max(0, row - window); back < row; back += 1) {
      sum += level[back] ?? 0;
      counted += 1;
    }
    const average = counted === 0 ? 0 : sum / counted;
    const rise = (level[row] ?? 0) - average * 1.25;
    beat[row] = Math.min(1, Math.max(0, rise * 6));
  }
}

/** Mono, because one picture is drawn. Averaged rather than summed, so a mix does not clip itself. */
function mono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (first === undefined) return new Float32Array();
  if (channels.length === 1) return first;
  const mixed = new Float32Array(first.length);
  for (const channel of channels) {
    for (let i = 0; i < mixed.length; i += 1) mixed[i] = (mixed[i] ?? 0) + (channel[i] ?? 0);
  }
  for (let i = 0; i < mixed.length; i += 1) mixed[i] = (mixed[i] ?? 0) / channels.length;
  return mixed;
}

/**
 * Where each band starts, as a bin index.
 *
 * Logarithmic from 30 Hz to the Nyquist limit, and every band at least one bin wide: the first
 * dozen bands of a 64-band log scale over a 2048-point window would otherwise share a single bin
 * and draw the same bar twelve times.
 */
function bandEdges(bands: number, window: number, sampleRate: number): number[] {
  const bins = window / 2;
  const lowest = 30;
  const highest = Math.min(sampleRate / 2, 18000);
  const edges: number[] = [];
  let previous = 0;
  for (let band = 0; band <= bands; band += 1) {
    const hz = lowest * Math.pow(highest / lowest, band / bands);
    const bin = Math.round((hz / (sampleRate / 2)) * bins);
    const placed = band === 0 ? Math.max(1, bin) : Math.max(previous + 1, bin);
    edges.push(Math.min(placed, bins));
    previous = edges[band] ?? 0;
  }
  return edges;
}

/**
 * The table, from a project.
 *
 * Renders the mix offline and analyses what comes out, which is the same pair of steps the loudness
 * reading takes -- and for the same reason: a picture drawn from the material rather than from the
 * mix would ignore every fader, every effect and every fade in the edit.
 *
 * The context is the caller's. The one driving playback is already running, and rendering into it
 * would have this fighting the transport for the same graph.
 */
export async function spectrumOf(
  ctx: OfflineAudioContext,
  project: Project,
  source: AudioBufferSource,
  params?: EffectParams,
  options: SpectrumOptions = {},
): Promise<Spectrum> {
  const graph = new AudioGraph(ctx as unknown as BaseAudioContext, source, params);
  await graph.prepare(project);
  graph.startAt(ctx.currentTime, 0);
  const rendered = await ctx.startRendering();
  const channels = Array.from({ length: rendered.numberOfChannels }, (_, channel) =>
    rendered.getChannelData(channel),
  );
  return analyseSpectrum(channels, rendered.sampleRate, options);
}
