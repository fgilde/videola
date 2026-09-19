import { VISUALIZER_STYLES, type VisualizerStyle } from "@videola/core";

import type { JsonValue } from "@videola/core";
import type { SoundFrame } from "../audio/spectrum";

/**
 * The sound, drawn.
 *
 * Eight styles, one canvas, and every one of them reads the same table: the bands, the level and
 * the beat that `analyseSpectrum` computed from the mix. Nothing here asks a live analyser what is
 * playing -- that is what makes the picture in the exported file the picture that was on screen.
 *
 * The options arrive as an untyped map from the model, and every one of them is clamped here. A
 * project written by a later version can carry an option this renderer has never heard of, and a
 * project written by hand can carry a bar count of nine million; neither may reach the canvas.
 *
 * The roster of styles lives in the model's own package, so the panel that offers them and the code
 * that paints them read one list.
 */
export { VISUALIZER_STYLES, type VisualizerStyle } from "@videola/core";

/** The palettes, by name. A custom one is two colours from the options instead. */
const PALETTES: Record<string, readonly string[]> = {
  videola: ["#a048f8", "#5b8cff", "#6bd6ff"],
  sunset: ["#ff5f6d", "#ffc371", "#fff1a8"],
  neon: ["#00f5d4", "#00bbf9", "#f15bb5"],
  ember: ["#ff2e00", "#ff8c00", "#ffd000"],
  ice: ["#caf0f8", "#90e0ef", "#0077b6"],
  mono: ["#ffffff", "#bfc6d4", "#7b8496"],
};

export interface VisualizerOptions {
  style: VisualizerStyle;
  palette: readonly string[];
  /** Behind the picture. Transparent by default, so it sits over whatever is underneath. */
  background: string | undefined;
  bars: number;
  sensitivity: number;
  glow: number;
  /** How far the picture reacts to a hit, 0 to 1. */
  punch: number;
  rotate: number;
  cap: boolean;
  fill: boolean;
}

interface Size {
  width: number;
  height: number;
}

export function visualizerOptions(
  style: string,
  raw: Readonly<Record<string, JsonValue>>,
): VisualizerOptions {
  const named = PALETTES[text(raw.palette, "videola")];
  const custom = [text(raw.color, ""), text(raw.colorTo, "")].filter((entry) => entry !== "");
  return {
    style: (VISUALIZER_STYLES as readonly string[]).includes(style)
      ? (style as VisualizerStyle)
      : "bars",
    palette: custom.length > 0 ? custom : (named ?? PALETTES.videola!),
    background: text(raw.background, "") === "" ? undefined : text(raw.background, ""),
    bars: Math.round(number(raw.bars, 48, 4, 160)),
    sensitivity: number(raw.sensitivity, 1, 0.1, 4),
    glow: number(raw.glow, 0.35, 0, 1),
    punch: number(raw.punch, 0.5, 0, 1),
    rotate: number(raw.rotate, 0, -4, 4),
    cap: raw.cap !== false,
    fill: raw.fill !== false,
  };
}

export function paintVisualizer(
  ctx: OffscreenCanvasRenderingContext2D,
  options: VisualizerOptions,
  size: Size,
  sound: SoundFrame,
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  if (options.background !== undefined) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  ctx.save();
  // The glow is a shadow on the strokes themselves rather than a second blurred pass: one draw, and
  // it follows whatever colour the gradient gave the bar it belongs to.
  if (options.glow > 0) {
    ctx.shadowBlur = options.glow * Math.min(size.width, size.height) * 0.05;
  }
  const bands = resample(sound.bands, options.bars, options.sensitivity);
  const paint = {
    bars: paintBars,
    mirror: paintMirror,
    wave: paintWave,
    radial: paintRadial,
    tunnel: paintTunnel,
    floor: paintFloor,
    particles: paintParticles,
    orb: paintOrb,
  }[options.style];
  paint(ctx, options, size, bands, sound);
  ctx.restore();
}

type Painter = (
  ctx: OffscreenCanvasRenderingContext2D,
  options: VisualizerOptions,
  size: Size,
  bands: Float32Array,
  sound: SoundFrame,
) => void;

/** The classic: one bar per band, standing on the floor of the frame. */
const paintBars: Painter = (ctx, options, size, bands) => {
  const gap = Math.max(1, size.width / bands.length / 6);
  const width = size.width / bands.length - gap;
  const ink = vertical(ctx, options, size);
  for (let band = 0; band < bands.length; band += 1) {
    const value = bands[band] ?? 0;
    const height = value * size.height * 0.92;
    const x = band * (width + gap) + gap / 2;
    ctx.fillStyle = ink;
    ctx.shadowColor = options.palette[0] ?? "#ffffff";
    rounded(ctx, x, size.height - height, width, height, Math.min(width / 2, 8));
    ctx.fill();
    if (options.cap && value > 0.02) {
      ctx.fillRect(x, size.height - height - width * 0.18, width, Math.max(2, width * 0.12));
    }
  }
};

/** The same bars, met by their own reflection: the shape a mix makes on a club screen. */
const paintMirror: Painter = (ctx, options, size, bands) => {
  const gap = Math.max(1, size.width / bands.length / 6);
  const width = size.width / bands.length - gap;
  const middle = size.height / 2;
  const ink = vertical(ctx, options, size);
  for (let band = 0; band < bands.length; band += 1) {
    const height = (bands[band] ?? 0) * size.height * 0.46;
    const x = band * (width + gap) + gap / 2;
    ctx.fillStyle = ink;
    ctx.shadowColor = options.palette[0] ?? "#ffffff";
    rounded(ctx, x, middle - height, width, height * 2, Math.min(width / 2, 8));
    ctx.fill();
  }
};

/** An oscilloscope built from the bands, drawn as a line and filled underneath. */
const paintWave: Painter = (ctx, options, size, bands) => {
  const middle = size.height / 2;
  const step = size.width / Math.max(1, bands.length - 1);
  ctx.beginPath();
  ctx.moveTo(0, middle);
  for (let band = 0; band < bands.length; band += 1) {
    const value = (bands[band] ?? 0) * (band % 2 === 0 ? 1 : -1);
    const x = band * step;
    const y = middle - value * size.height * 0.42;
    if (band === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = horizontal(ctx, options, size);
  ctx.shadowColor = options.palette[1] ?? options.palette[0] ?? "#ffffff";
  ctx.lineWidth = Math.max(2, size.height * 0.008);
  ctx.lineJoin = "round";
  ctx.stroke();
  if (options.fill) {
    ctx.lineTo(size.width, middle);
    ctx.lineTo(0, middle);
    ctx.closePath();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = horizontal(ctx, options, size);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
};

/** A ring: every band a spoke, the whole thing turning and breathing with the level. */
const paintRadial: Painter = (ctx, options, size, bands, sound) => {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const inner = Math.min(size.width, size.height) * (0.18 + sound.level * 0.04 * options.punch);
  const reach = Math.min(size.width, size.height) * 0.3;
  ctx.translate(cx, cy);
  ctx.rotate(options.rotate * sound.at);
  const ink = radial(ctx, options, inner + reach);
  ctx.strokeStyle = ink;
  ctx.shadowColor = options.palette[0] ?? "#ffffff";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, ((Math.PI * 2 * inner) / bands.length) * 0.55);
  for (let band = 0; band < bands.length; band += 1) {
    const angle = (band / bands.length) * Math.PI * 2;
    const length = inner + (bands[band] ?? 0) * reach;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
    ctx.stroke();
  }
};

/**
 * Rings running away from the eye: the three-dimensional one, and it costs a perspective divide
 * rather than a scene graph. Each ring is one band, placed further back, so the loud end of the
 * spectrum arrives at the front and the quiet end disappears into the distance.
 */
const paintTunnel: Painter = (ctx, options, size, bands, sound) => {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const depth = bands.length;
  ctx.translate(cx, cy);
  ctx.rotate(options.rotate * sound.at * 0.35);
  ctx.lineWidth = Math.max(1.5, size.height * 0.004);
  ctx.shadowColor = options.palette[1] ?? options.palette[0] ?? "#ffffff";
  for (let ring = depth - 1; ring >= 0; ring -= 1) {
    const z = 1 + ring * 0.35;
    const scale = 1 / z;
    const value = bands[ring] ?? 0;
    const radius = Math.min(size.width, size.height) * (0.1 + value * 0.55) * scale;
    const sides = 6;
    ctx.beginPath();
    for (let corner = 0; corner <= sides; corner += 1) {
      const angle = (corner / sides) * Math.PI * 2 + ring * 0.08;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (corner === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = Math.max(0.05, scale) * (0.35 + value * 0.65);
    ctx.strokeStyle = options.palette[ring % options.palette.length] ?? "#ffffff";
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
};

/** Bars on a floor, seen from slightly above, with their own reflection under them. */
const paintFloor: Painter = (ctx, options, size, bands, sound) => {
  const horizon = size.height * 0.62;
  const spread = size.width * 0.9;
  const ink = vertical(ctx, options, size);
  ctx.shadowColor = options.palette[0] ?? "#ffffff";
  for (let band = 0; band < bands.length; band += 1) {
    const middle = (band + 0.5) / bands.length - 0.5;
    // The perspective: a bar in the middle of the row is nearer than one at the edge, so it is
    // wider and taller. One divide, and the row reads as a row rather than as a flat chart.
    const distance = 1 + Math.abs(middle) * 1.4;
    const scale = 1 / distance;
    const width = (spread / bands.length) * 0.7 * scale * 1.6;
    const height = (bands[band] ?? 0) * size.height * 0.5 * scale * (1 + sound.beat * 0.2 * options.punch);
    const x = size.width / 2 + middle * spread * scale * 1.6 - width / 2;
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.35 + scale * 0.65;
    ctx.fillRect(x, horizon - height, width, height);
    // The reflection, squashed and fading: the cheapest thing that turns a chart into a stage.
    ctx.globalAlpha = 0.12 * scale;
    ctx.fillRect(x, horizon, width, height * 0.55);
  }
  ctx.globalAlpha = 1;
};

/** Dots thrown outward by the beat, each band its own direction. */
const paintParticles: Painter = (ctx, options, size, bands, sound) => {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const reach = Math.min(size.width, size.height) * 0.45;
  ctx.shadowColor = options.palette[0] ?? "#ffffff";
  for (let band = 0; band < bands.length; band += 1) {
    const value = bands[band] ?? 0;
    // Deterministic, not random: the same instant has to draw the same dots in the export as it
    // did in the preview, and `Math.random` would make a different picture every pass.
    const angle = (band * 2.39996) + sound.at * options.rotate * 0.4;
    const distance = reach * (0.25 + value * 0.85);
    const radius = Math.max(1.5, value * size.height * 0.02 * (1 + sound.beat * options.punch));
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, radius, 0, Math.PI * 2);
    ctx.fillStyle = options.palette[band % options.palette.length] ?? "#ffffff";
    ctx.globalAlpha = 0.25 + value * 0.75;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

/** One breathing ball of light. The quiet one, for a lyric video that should not shout. */
const paintOrb: Painter = (ctx, options, size, bands, sound) => {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const base = Math.min(size.width, size.height) * 0.18;
  const radius = base * (1 + sound.level * 0.6 + sound.beat * 0.3 * options.punch);
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 2.2);
  glow.addColorStop(0, options.palette[0] ?? "#ffffff");
  glow.addColorStop(0.45, options.palette[1] ?? options.palette[0] ?? "#ffffff");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2.2, 0, Math.PI * 2);
  ctx.fill();
  // A rim built from the bands, so the ball has a shape that belongs to this second of music.
  ctx.beginPath();
  for (let band = 0; band <= bands.length; band += 1) {
    const value = bands[band % bands.length] ?? 0;
    const angle = (band / bands.length) * Math.PI * 2;
    const r = radius * (1.15 + value * 0.5);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (band === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = options.palette[options.palette.length - 1] ?? "#ffffff";
  ctx.lineWidth = Math.max(2, size.height * 0.004);
  ctx.stroke();
};

/**
 * The analysed bands, at the number of bars this picture wants.
 *
 * Averaged into buckets when there are fewer bars than bands and interpolated when there are more,
 * so the bar count is a look rather than a second analysis.
 */
function resample(bands: Float32Array, count: number, sensitivity: number): Float32Array {
  const out = new Float32Array(count);
  if (bands.length === 0) return out;
  for (let index = 0; index < count; index += 1) {
    const from = (index * bands.length) / count;
    const to = ((index + 1) * bands.length) / count;
    let sum = 0;
    let taken = 0;
    for (let band = Math.floor(from); band < Math.max(Math.ceil(to), Math.floor(from) + 1); band += 1) {
      sum += bands[Math.min(band, bands.length - 1)] ?? 0;
      taken += 1;
    }
    out[index] = Math.min(1, (taken === 0 ? 0 : sum / taken) * sensitivity);
  }
  return out;
}

function vertical(
  ctx: OffscreenCanvasRenderingContext2D,
  options: VisualizerOptions,
  size: Size,
): CanvasGradient {
  const ramp = ctx.createLinearGradient(0, size.height, 0, 0);
  stops(ramp, options.palette);
  return ramp;
}

function horizontal(
  ctx: OffscreenCanvasRenderingContext2D,
  options: VisualizerOptions,
  size: Size,
): CanvasGradient {
  const ramp = ctx.createLinearGradient(0, 0, size.width, 0);
  stops(ramp, options.palette);
  return ramp;
}

function radial(
  ctx: OffscreenCanvasRenderingContext2D,
  options: VisualizerOptions,
  reach: number,
): CanvasGradient {
  const ramp = ctx.createRadialGradient(0, 0, reach * 0.2, 0, 0, reach);
  stops(ramp, options.palette);
  return ramp;
}

function stops(ramp: CanvasGradient, palette: readonly string[]): void {
  const colours = palette.length === 1 ? [palette[0]!, palette[0]!] : palette;
  for (const [index, colour] of colours.entries()) {
    ramp.addColorStop(index / (colours.length - 1), colour);
  }
}

function rounded(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, Math.max(height / 2, 0));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function number(value: JsonValue | undefined, fallback: number, low: number, high: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, low), high)
    : fallback;
}

function text(value: JsonValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
