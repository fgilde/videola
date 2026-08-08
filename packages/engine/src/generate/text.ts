import type { JsonValue } from "@videola/core";

// How a title becomes pixels: canvas 2D into a texture, rather than glyph outlines into geometry.
// The browser already has a shaper, a font fallback chain and a hinting engine, and reimplementing
// any of them is a project rather than a milestone. What it costs is that text is a raster at the
// project's resolution, so a project authored at 720p and exported at 4K rasterises the title again
// at 4K -- which is the right way round, and the reason every measurement below is a *fraction* of
// the frame rather than a pixel count.
export type TextMove = "none" | "fade" | "rise" | "fall" | "grow";

export interface TextStyle {
  fontFamily: string;
  // Cap height as a fraction of the frame's height, so the same style reads the same at any output
  // resolution. A pixel size would shrink the title as the export grew.
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  x: number;
  y: number;
  maxWidth: number;
  strokeWidth: number;
  strokeColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  shadowColor: string;
  // Empty means no box at all, which is the common case and has to be the default.
  background: string;
  padding: number;
  animateIn: TextMove;
  animateInSeconds: number;
  animateOut: TextMove;
  animateOutSeconds: number;
  loop: "none" | "pulse";
  loopSeconds: number;
}

const DEFAULTS: TextStyle = {
  fontFamily: "sans-serif",
  fontSize: 0.09,
  fontWeight: 700,
  italic: false,
  color: "#ffffff",
  align: "center",
  lineHeight: 1.25,
  letterSpacing: 0,
  x: 0.5,
  y: 0.5,
  maxWidth: 0.8,
  strokeWidth: 0,
  strokeColor: "#000000",
  shadowBlur: 0,
  shadowX: 0,
  shadowY: 0.05,
  shadowColor: "#00000080",
  background: "",
  padding: 0.3,
  animateIn: "none",
  animateInSeconds: 0.5,
  animateOut: "none",
  animateOutSeconds: 0.5,
  loop: "none",
  loopSeconds: 2,
};

const MOVES: readonly TextMove[] = ["none", "fade", "rise", "fall", "grow"];
const ALIGNMENTS = ["left", "center", "right"] as const;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// The style arrives as free-form JSON from a project file, a template or an agent, so this is a trust
// boundary and not a convenience. Every field is bounded and every unusable value falls back rather
// than reaching the canvas: an unparseable colour leaves `fillStyle` at whatever it was, and an
// unparseable font string leaves `ctx.font` at 10px sans-serif -- both silent, both catastrophic.
export function textStyle(raw: Readonly<Record<string, JsonValue>> | undefined): TextStyle {
  const source = raw ?? {};
  return {
    fontFamily: family(source.fontFamily),
    fontSize: span(source.fontSize, DEFAULTS.fontSize, 0.005, 1),
    fontWeight: span(source.fontWeight, DEFAULTS.fontWeight, 100, 900),
    italic: source.italic === true,
    color: color(source.color, DEFAULTS.color),
    align: choice(source.align, ALIGNMENTS, DEFAULTS.align),
    lineHeight: span(source.lineHeight, DEFAULTS.lineHeight, 0.5, 4),
    letterSpacing: span(source.letterSpacing, DEFAULTS.letterSpacing, -0.5, 2),
    x: span(source.x, DEFAULTS.x, -2, 3),
    y: span(source.y, DEFAULTS.y, -2, 3),
    maxWidth: span(source.maxWidth, DEFAULTS.maxWidth, 0.05, 4),
    strokeWidth: span(source.strokeWidth, DEFAULTS.strokeWidth, 0, 1),
    strokeColor: color(source.strokeColor, DEFAULTS.strokeColor),
    shadowBlur: span(source.shadowBlur, DEFAULTS.shadowBlur, 0, 2),
    shadowX: span(source.shadowX, DEFAULTS.shadowX, -2, 2),
    shadowY: span(source.shadowY, DEFAULTS.shadowY, -2, 2),
    shadowColor: color(source.shadowColor, DEFAULTS.shadowColor),
    background: color(source.background, ""),
    padding: span(source.padding, DEFAULTS.padding, 0, 4),
    animateIn: choice(source.animateIn, MOVES, DEFAULTS.animateIn),
    animateInSeconds: span(source.animateInSeconds, DEFAULTS.animateInSeconds, 0, 30),
    animateOut: choice(source.animateOut, MOVES, DEFAULTS.animateOut),
    animateOutSeconds: span(source.animateOutSeconds, DEFAULTS.animateOutSeconds, 0, 30),
    loop: source.loop === "pulse" ? "pulse" : "none",
    loopSeconds: span(source.loopSeconds, DEFAULTS.loopSeconds, 0.05, 60),
  };
}

function span(value: unknown, fallback: number, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, low), high);
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((entry) => entry === value) ?? fallback;
}

// Hex only, like every other colour in the format. A CSS colour function would be a second syntax
// for the same thing, and the one thing a colour must not do is fail quietly.
function color(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0) return "";
  return HEX.test(value) ? value : fallback;
}

// A family name travels into a CSS shorthand, where a stray quote or semicolon makes the whole
// assignment a no-op and the title comes out at ten pixels. Stripped to what a family name can
// contain, and a generic family is always appended so the shorthand parses whatever is left.
function family(value: unknown): string {
  if (typeof value !== "string") return DEFAULTS.fontFamily;
  const cleaned = value.replace(/[^\p{L}\p{N} ,-]/gu, "").trim();
  return cleaned.length === 0 ? DEFAULTS.fontFamily : cleaned;
}

interface Size {
  width: number;
  height: number;
}

// Anything a canvas 2D context needs from us. `letterSpacing` is not in every runtime's typings and
// is ignored where it is missing, which is a title with tighter tracking rather than no title.
type Canvas2D = OffscreenCanvasRenderingContext2D & { letterSpacing?: string };

export function paintText(
  ctx: Canvas2D,
  content: string,
  raw: Readonly<Record<string, JsonValue>> | undefined,
  size: Size,
): void {
  const style = textStyle(raw);
  const em = style.fontSize * size.height;
  ctx.font = `${style.italic ? "italic " : ""}${style.fontWeight} ${em}px ${style.fontFamily}, sans-serif`;
  ctx.letterSpacing = `${style.letterSpacing * em}px`;
  const lines = wrap(ctx, content, style.maxWidth * size.width);
  if (lines.length === 0) return;

  const step = em * style.lineHeight;
  const anchorX = style.x * size.width;
  const middle = style.y * size.height;
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const top = middle - (lines.length * step) / 2;

  if (style.background.length > 0) {
    const pad = style.padding * em;
    ctx.fillStyle = style.background;
    ctx.fillRect(
      leftOf(anchorX, widest, style.align) - pad,
      top - pad,
      widest + 2 * pad,
      lines.length * step + 2 * pad,
    );
  }

  ctx.textAlign = style.align;
  ctx.textBaseline = "middle";
  ctx.lineWidth = style.strokeWidth * em;
  ctx.lineJoin = "round";
  ctx.strokeStyle = style.strokeColor;
  ctx.fillStyle = style.color;
  for (const [index, line] of lines.entries()) {
    const y = top + (index + 0.5) * step;
    // The shadow is cast once, by whichever pass is painted first. Leaving it on for both would
    // double it, and a stroke's shadow under its own fill is invisible work.
    shadow(ctx, style, em);
    if (ctx.lineWidth > 0) {
      ctx.strokeText(line, anchorX, y);
      clearShadow(ctx);
    }
    ctx.fillText(line, anchorX, y);
    clearShadow(ctx);
  }
}

function shadow(ctx: Canvas2D, style: TextStyle, em: number): void {
  if (style.shadowBlur <= 0 && style.shadowX === 0 && style.shadowY === 0) return;
  ctx.shadowColor = style.shadowColor;
  ctx.shadowBlur = style.shadowBlur * em;
  ctx.shadowOffsetX = style.shadowX * em;
  ctx.shadowOffsetY = style.shadowY * em;
}

function clearShadow(ctx: Canvas2D): void {
  ctx.shadowColor = "#00000000";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function leftOf(anchor: number, width: number, align: TextStyle["align"]): number {
  if (align === "left") return anchor;
  return align === "right" ? anchor - width : anchor - width / 2;
}

// Hard breaks in the content are honoured and the rest is wrapped to `maxWidth`. A single word that
// does not fit is left long rather than broken: hyphenation needs a dictionary, and a word cut at an
// arbitrary letter reads worse than one that overhangs.
function wrap(ctx: Canvas2D, content: string, limit: number): string[] {
  const lines: string[] = [];
  for (const paragraph of content.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (line.length > 0 && ctx.measureText(candidate).width > limit) {
        lines.push(line);
        line = word;
        continue;
      }
      line = candidate;
    }
    lines.push(line);
  }
  // A title of nothing but blank lines is nothing to draw, and measuring it would put an empty
  // background box on screen.
  return lines.every((line) => line.trim().length === 0) ? [] : lines;
}
