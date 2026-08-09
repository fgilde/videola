import { useEffect, useRef, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import "./Scopes.css";

/**
 * What the panel needs of a reading to draw it. `ScopeReading` from `@videola/engine` satisfies
 * this structurally, which is how the surface shows a measurement of the picture without this
 * package depending on the renderer -- the same seam `EffectDescriptor` uses for effects.
 *
 * Nothing here is a constant this file declares: the number of levels is the length of a histogram
 * and the side of the colour plane is the square root of its area. A reading that says how big it
 * is cannot be drawn at the wrong size.
 */
export interface ScopeReadingLike {
  histogram: {
    red: ArrayLike<number>;
    green: ArrayLike<number>;
    blue: ArrayLike<number>;
    luma: ArrayLike<number>;
  };
  waveform: ArrayLike<number>;
  columns: number;
  vectorscope: ArrayLike<number>;
  measured: number;
  range: readonly [number, number] | undefined;
}

export interface VectorTarget {
  name: string;
  /** Where the box sits on the plane, 0 to 1 across and down. */
  x: number;
  y: number;
}

export interface ScopesProps {
  reading: ScopeReadingLike | undefined;
  targets: readonly VectorTarget[];
}

// A scope is a density, and densities are wildly uneven: a flat sky puts a hundred times as many
// pixels on one level as an edge puts on the next. Drawn straight, everything but the sky is
// invisible. The root is the standard compression -- enough to show a trace that one pixel in a
// thousand made without washing the bright parts out.
function brightness(count: number, busiest: number): number {
  if (count <= 0 || busiest <= 0) return 0;
  return Math.min(1, Math.sqrt(count / busiest) * 1.6);
}

/**
 * The three measuring instruments, on the picture the preview is showing.
 *
 * Drawn into canvases rather than into SVG, because all three are pictures of a density -- one
 * value per cell of a grid tens of thousands of cells wide. As an SVG that is tens of thousands of
 * elements the browser has to lay out; as an ImageData it is one array the size of the picture.
 *
 * The colours come from the tokens rather than from a palette of their own, read off the element
 * at paint time: a scope drawn in fixed colours is a scope that disappears in the other theme.
 */
export function Scopes({ reading, targets }: ScopesProps): ReactElement {
  const { t } = useI18n();
  const waveform = useRef<HTMLCanvasElement | null>(null);
  const vector = useRef<HTMLCanvasElement | null>(null);
  const histogram = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    drawWaveform(waveform.current, reading);
    drawVectorscope(vector.current, reading, targets);
    drawHistogram(histogram.current, reading);
  }, [reading, targets]);

  const empty = reading === undefined || reading.measured === 0;

  return (
    <section className="v-scopes" aria-label={t("scopes.label")}>
      <Instrument
        title={t("scopes.waveform")}
        hint={t("scopes.waveformHint")}
        canvas={waveform}
        empty={empty}
      />
      <Instrument
        title={t("scopes.vectorscope")}
        hint={t("scopes.vectorscopeHint")}
        canvas={vector}
        empty={empty}
      />
      <Instrument
        title={t("scopes.histogram")}
        hint={t("scopes.histogramHint")}
        canvas={histogram}
        empty={empty}
      />
      {/* The reading in words, for anyone who is not going to look at three grey pictures -- and
          the one number a colourist reads off a waveform first anyway. */}
      <p className="v-scopes__range" role="status">
        {empty
          ? t("scopes.nothing")
          : t("scopes.range", { low: reading.range?.[0] ?? 0, high: reading.range?.[1] ?? 0 })}
      </p>
    </section>
  );
}

function Instrument({
  title,
  hint,
  canvas,
  empty,
}: {
  title: string;
  hint: string;
  canvas: React.RefObject<HTMLCanvasElement | null>;
  empty: boolean;
}): ReactElement {
  return (
    <figure className="v-scope">
      <figcaption className="v-scope__title">{title}</figcaption>
      <canvas
        ref={canvas}
        className="v-scope__canvas"
        role="img"
        aria-label={empty ? hint : title}
        data-empty={empty || undefined}
      />
    </figure>
  );
}

// One canvas, sized to its own box in device pixels and cleared. Returns nothing when there is no
// box yet, which is every render before the panel has been laid out.
function surface(
  canvas: HTMLCanvasElement | null,
): { context: CanvasRenderingContext2D; width: number; height: number } | undefined {
  if (canvas === null) return undefined;
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (context === null) return undefined;
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

// The trace colour, off the element itself so both themes and a re-themed build all get it right.
function accent(canvas: HTMLCanvasElement): [number, number, number] {
  const declared = getComputedStyle(canvas).color;
  const parts = /(\d+)\D+(\d+)\D+(\d+)/.exec(declared);
  if (parts === null) return [120, 200, 255];
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
}

// A waveform is the frame with its rows replaced by tone: one column of the picture is one column
// here, and how bright a cell is says how many pixels of that column sat on that tone.
function drawWaveform(canvas: HTMLCanvasElement | null, reading: ScopeReadingLike | undefined): void {
  const surf = surface(canvas);
  if (surf === undefined || canvas === null) return;
  const { context, width, height } = surf;
  // No second guard for an empty reading: with nothing counted the busiest cell is nought and
  // `brightness` answers nought for every cell, so the loop below draws nothing on its own.
  if (reading === undefined || reading.columns === 0) return;

  const levels = reading.histogram.luma.length;
  const [r, g, b] = accent(canvas);
  const image = context.createImageData(width, height);
  const busiest = brightest(reading.waveform);
  for (let x = 0; x < width; x += 1) {
    const column = Math.min(reading.columns - 1, Math.floor((x / width) * reading.columns));
    for (let y = 0; y < height; y += 1) {
      // Row nought is the top of the canvas and the top is white, so the level runs the other way.
      const level = Math.min(levels - 1, Math.floor((1 - y / height) * levels));
      const weight = brightness(reading.waveform[column * levels + level] ?? 0, busiest);
      if (weight <= 0) continue;
      const at = (y * width + x) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = Math.round(weight * 255);
    }
  }
  context.putImageData(image, 0, 0);
}

// The colour plane: how far from neutral a pixel is, and in which direction. The boxes are the six
// colour bars, so a cast reads as a cloud leaning towards one of them.
function drawVectorscope(
  canvas: HTMLCanvasElement | null,
  reading: ScopeReadingLike | undefined,
  targets: readonly VectorTarget[],
): void {
  const surf = surface(canvas);
  if (surf === undefined || canvas === null) return;
  const { context, width, height } = surf;
  const side = Math.min(width, height);
  const left = (width - side) / 2;
  const top = (height - side) / 2;

  context.strokeStyle = getComputedStyle(canvas).borderColor || "#888";
  context.beginPath();
  context.arc(left + side / 2, top + side / 2, side / 2 - 1, 0, Math.PI * 2);
  context.stroke();
  context.font = "9px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = context.strokeStyle;
  for (const target of targets) {
    context.strokeRect(left + target.x * side - 4, top + target.y * side - 4, 8, 8);
    context.fillText(target.name, left + target.x * side, top + target.y * side - 9);
  }

  if (reading === undefined) return;
  const plane = Math.round(Math.sqrt(reading.vectorscope.length));
  if (plane <= 0) return;
  const [r, g, b] = accent(canvas);
  const image = context.createImageData(side, side);
  const busiest = brightest(reading.vectorscope);
  for (let y = 0; y < side; y += 1) {
    const row = Math.min(plane - 1, Math.floor((y / side) * plane));
    for (let x = 0; x < side; x += 1) {
      const column = Math.min(plane - 1, Math.floor((x / side) * plane));
      const weight = brightness(reading.vectorscope[row * plane + column] ?? 0, busiest);
      if (weight <= 0) continue;
      const at = (y * side + x) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = Math.round(weight * 255);
    }
  }
  // Drawn over the graticule rather than under it: putImageData replaces what is beneath, circle
  // included, so the trace goes through a second canvas and is composited on.
  const overlay = new OffscreenCanvas(side, side);
  const into = overlay.getContext("2d");
  if (into === null) return;
  into.putImageData(image, 0, 0);
  context.drawImage(overlay, left, top);
}

// How often each level occurs. The three channels are drawn over each other in the additive way a
// histogram is read: where all three agree the picture is neutral at that tone.
const CHANNEL_COLORS: readonly [string, "red" | "green" | "blue"][] = [
  ["rgba(255, 80, 80, 0.75)", "red"],
  ["rgba(80, 220, 120, 0.75)", "green"],
  ["rgba(90, 150, 255, 0.75)", "blue"],
];

function drawHistogram(canvas: HTMLCanvasElement | null, reading: ScopeReadingLike | undefined): void {
  const surf = surface(canvas);
  if (surf === undefined) return;
  const { context, width, height } = surf;
  if (reading === undefined) return;

  const levels = reading.histogram.luma.length;
  const busiest = Math.max(
    brightest(reading.histogram.red),
    brightest(reading.histogram.green),
    brightest(reading.histogram.blue),
  );
  if (busiest <= 0) return;
  context.globalCompositeOperation = "lighter";
  for (const [color, channel] of CHANNEL_COLORS) {
    const counts = reading.histogram[channel];
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, height);
    for (let x = 0; x < width; x += 1) {
      const level = Math.min(levels - 1, Math.floor((x / width) * levels));
      // The same root the traces use, so the three pictures agree about what "a lot" means.
      const weight = Math.min(1, Math.sqrt((counts[level] ?? 0) / busiest));
      context.lineTo(x, height - weight * height);
    }
    context.lineTo(width, height);
    context.closePath();
    context.fill();
  }
  context.globalCompositeOperation = "source-over";
}

function brightest(counts: ArrayLike<number>): number {
  let most = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const count = counts[i]!;
    if (count > most) most = count;
  }
  return most;
}
