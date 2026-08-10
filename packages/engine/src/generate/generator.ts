import { timeToSeconds } from "@videola/core";

import { leafClips } from "../nesting";
import { paintText } from "./text";

import type { Clip, Generator, JsonValue, Project, Time } from "@videola/core";

interface Size {
  width: number;
  height: number;
}

// The shapes this draws. A shape name is a free string in the model, so an unknown one is a clip with
// nothing to draw and is treated as such rather than filled with a guess.
const SHAPES: readonly string[] = ["rectangle", "square", "ellipse", "circle", "triangle"];

// Which generators have pixels. The rest are in the model and not in the menu, so nothing promises
// them: a clip whose generator is not on this list is left out of the draw list entirely rather than
// drawn as an empty rectangle.
export function paintsGenerator(generator: Generator): boolean {
  if (generator.type === "shape") return SHAPES.includes(generator.shape);
  return (
    generator.type === "text" ||
    generator.type === "solid" ||
    generator.type === "gradient" ||
    generator.type === "countdown"
  );
}

// `atSeconds` is how far into the clip's own material this picture stands, and only a countdown reads
// it. Everything else here is the same picture at every moment it is on screen.
export function paintGenerator(
  ctx: OffscreenCanvasRenderingContext2D,
  generator: Generator,
  size: Size,
  atSeconds = 0,
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  if (generator.type === "solid") {
    ctx.fillStyle = hex(generator.color, "#000000");
    ctx.fillRect(0, 0, size.width, size.height);
    return;
  }
  if (generator.type === "gradient") {
    ctx.fillStyle = ramp(ctx, generator, size);
    ctx.fillRect(0, 0, size.width, size.height);
    return;
  }
  if (generator.type === "shape") {
    paintShape(ctx, generator.shape, hex(generator.color, "#ffffff"), size);
    return;
  }
  if (generator.type === "countdown") {
    const number = countdownNumber(generator.fromSeconds, atSeconds);
    // Past zero there is no number, and a lingering "0" over the shot that took over is worse than
    // nothing. The clip keeps its frame; the frame is simply clear.
    if (number > 0) paintText(ctx, String(number), COUNTDOWN_STYLE, size);
    return;
  }
  if (generator.type === "text") paintText(ctx, generator.content, generator.style, size);
}

// One number per whole second of the clip's own material, so a trimmed head skips the front of the
// count and a speed ramp stretches it -- both because the instant handed in came through the same
// source-time map every decoded clip is read at.
export function countdownNumber(fromSeconds: number, atSeconds: number): number {
  if (!Number.isFinite(fromSeconds) || !Number.isFinite(atSeconds)) return 0;
  const from = Math.min(Math.max(Math.floor(fromSeconds), 0), 3600);
  return Math.max(from - Math.floor(Math.max(atSeconds, 0)), 0);
}

// What was painted, not when. The whole generator and the output size, plus -- for a countdown -- the
// number standing on screen: an edit to the content, a change of resolution or a second going by
// repaints, and nothing else does. Two instants inside the same second give the same key, which is
// what keeps a full text layout off every frame.
export function generatorKey(generator: Generator, size: Size, atSeconds: number): string {
  const shown =
    generator.type === "countdown" ? countdownNumber(generator.fromSeconds, atSeconds) : 0;
  return `${size.width}x${size.height}|${shown}|${JSON.stringify(generator)}`;
}

// Big, centred, and heavy enough to read over anything. Not configurable: the model carries one field
// for a countdown, and a style on top of it would be a second way to write a title.
const COUNTDOWN_STYLE: Readonly<Record<string, JsonValue>> = {
  fontSize: 0.34,
  fontWeight: 800,
  shadowBlur: 0.12,
  shadowY: 0,
};

// Centred and inscribed in the frame, which is what makes a shape usable as a mask target or a plate:
// the transform moves and scales it, and the generator itself has one job.
function paintShape(
  ctx: OffscreenCanvasRenderingContext2D,
  shape: string,
  color: string,
  size: Size,
): void {
  const cx = size.width / 2;
  const cy = size.height / 2;
  ctx.fillStyle = color;
  if (shape === "rectangle") {
    ctx.fillRect(0, 0, size.width, size.height);
    return;
  }
  const side = Math.min(size.width, size.height);
  if (shape === "square") {
    ctx.fillRect(cx - side / 2, cy - side / 2, side, side);
    return;
  }
  // Named, never a fallback. A shape this does not know has to leave the frame alone: falling
  // through to whichever branch came last would draw an ellipse for `hexagon`, which is the picture
  // promising something nobody authored.
  if (shape !== "triangle" && shape !== "circle" && shape !== "ellipse") return;
  ctx.beginPath();
  if (shape === "triangle") {
    ctx.moveTo(cx, cy - side / 2);
    ctx.lineTo(cx + side / 2, cy + side / 2);
    ctx.lineTo(cx - side / 2, cy + side / 2);
    ctx.closePath();
  } else if (shape === "circle") {
    ctx.arc(cx, cy, side / 2, 0, 2 * Math.PI);
  } else {
    ctx.ellipse(cx, cy, size.width / 2, size.height / 2, 0, 0, 2 * Math.PI);
  }
  ctx.fill();
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hex(value: string, fallback: string): string {
  return HEX.test(value) ? value : fallback;
}

// Spans the frame at any angle: projecting the frame's half-extents onto the direction is exactly how
// far the ramp has to reach for its two ends to land on opposite edges. Clockwise on screen, like the
// transform's rotation and unlike a shader pass, because canvas 2D runs y down the picture.
function ramp(
  ctx: OffscreenCanvasRenderingContext2D,
  generator: Extract<Generator, { type: "gradient" }>,
  size: Size,
): CanvasGradient {
  const radians = (generator.angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const reach = (Math.abs(dx) * size.width + Math.abs(dy) * size.height) / 2;
  const cx = size.width / 2;
  const cy = size.height / 2;
  const gradient = ctx.createLinearGradient(
    cx - dx * reach,
    cy - dy * reach,
    cx + dx * reach,
    cy + dy * reach,
  );
  gradient.addColorStop(0, hex(generator.from, "#000000"));
  gradient.addColorStop(1, hex(generator.to, "#ffffff"));
  return gradient;
}

interface Painted {
  key: string;
  frame: VideoFrame;
}

// A generator has no decoder behind it, so its pictures are made here and handed over as `VideoFrame`
// like everything else the compositor draws. One type of picture through the whole renderer is worth
// more than saving a copy: `uploadable`, the liveness probe and the texture path all stay one path.
//
// The pixels do not move -- with one exception. A title is the same picture at every moment it is on
// screen, because what animates it is its transform and not its glyphs, which is what makes one frame
// per clip enough and re-rendering per tick a full text layout per tick. A countdown is the exception
// and pays for itself: its picture changes once a second and not once a frame, because the key below
// is the number and not the instant.
export class GeneratorFrames {
  #painted = new Map<string, Painted>();
  #canvas: OffscreenCanvas | undefined;

  // Takes the whole visible set rather than one clip at a time, so dropping what left the screen
  // happens here instead of at every call site. Without it a scrub through a timeline of titles
  // leaves a full-frame picture behind for each of them.
  //
  // `sourceTimes` is the map every decoded clip is read at, handed in rather than recomputed: a
  // countdown inside a compound clip, or under a speed ramp, then counts at the rate its material
  // actually runs at instead of at the rate the outer timeline does.
  pictures(
    project: Project,
    visible: ReadonlySet<string>,
    sourceTimes?: ReadonlyMap<string, Time>,
  ): Map<string, VideoFrame> {
    const size = { width: project.settings.width, height: project.settings.height };
    const wanted = new Map<string, VideoFrame>();
    for (const clip of generatorClips(project, visible)) {
      const frame = this.#frame(clip, size, timeToSeconds(sourceTimes?.get(clip.id) ?? 0));
      if (frame !== undefined) wanted.set(clip.id, frame);
    }
    for (const [id, held] of this.#painted) {
      if (wanted.has(id)) continue;
      held.frame.close();
      this.#painted.delete(id);
    }
    return wanted;
  }

  close(): void {
    for (const held of this.#painted.values()) held.frame.close();
    this.#painted.clear();
    this.#canvas = undefined;
  }

  #frame(clip: Clip, size: Size, atSeconds: number): VideoFrame | undefined {
    if (clip.source.kind !== "generator") return undefined;
    const generator = clip.source.generator;
    const key = generatorKey(generator, size, atSeconds);
    const held = this.#painted.get(clip.id);
    if (held?.key === key) return held.frame;
    held?.frame.close();
    const frame = this.#paint(generator, size, atSeconds);
    if (frame === undefined) {
      this.#painted.delete(clip.id);
      return undefined;
    }
    this.#painted.set(clip.id, { key, frame });
    return frame;
  }

  // One clip's picture, and one clip's failure. A throw here would cost the whole frame every other
  // clip in it -- the same mistake the audio graph and the video source both had to have taken out of
  // them, and it does not travel to a new layer by itself.
  //
  // A runtime without `OffscreenCanvas` or `VideoFrame` is a capability rather than a fault, so it is
  // silent: jsdom has neither, and a test driving playback there should see a project without titles
  // rather than a console full of errors.
  #paint(generator: Generator, size: Size, atSeconds: number): VideoFrame | undefined {
    if (!paintsGenerator(generator)) return undefined;
    if (typeof OffscreenCanvas === "undefined" || typeof VideoFrame === "undefined") return undefined;
    try {
      const canvas = this.#surface(size);
      const ctx = canvas.getContext("2d");
      if (ctx === null) return undefined;
      paintGenerator(ctx, generator, size, atSeconds);
      return new VideoFrame(canvas, { timestamp: 0 });
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }

  // One canvas for every generator in the project. They are painted one at a time and copied into a
  // frame before the next one starts, so a second surface would buy nothing.
  #surface(size: Size): OffscreenCanvas {
    const canvas = this.#canvas;
    if (canvas !== undefined && canvas.width === size.width && canvas.height === size.height) {
      return canvas;
    }
    this.#canvas = new OffscreenCanvas(size.width, size.height);
    return this.#canvas;
  }
}

// The visible set comes from the draw list, which names a nested clip by its own id, so this has to
// reach into compound clips as well. It needs no instant of its own: a generator paints the same
// picture at every moment it is on screen, and whether it is on screen was decided already.
function generatorClips(project: Project, visible: ReadonlySet<string>): Clip[] {
  return leafClips(project).filter(
    (clip) => visible.has(clip.id) && clip.source.kind === "generator",
  );
}
