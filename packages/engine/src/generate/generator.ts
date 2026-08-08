import { leafClips } from "../nesting";
import { paintText } from "./text";

import type { Clip, Generator, Project } from "@videola/core";

interface Size {
  width: number;
  height: number;
}

// Which generators have pixels. The rest are in the model and not in the menu, so nothing promises
// them: a clip whose generator is not on this list is left out of the draw list entirely rather than
// drawn as an empty rectangle.
export function paintsGenerator(generator: Generator): boolean {
  return generator.type === "text" || generator.type === "solid" || generator.type === "gradient";
}

export function paintGenerator(
  ctx: OffscreenCanvasRenderingContext2D,
  generator: Generator,
  size: Size,
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
  if (generator.type === "text") paintText(ctx, generator.content, generator.style, size);
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
// The pixels do not move. A title is the same picture at every moment it is on screen, because what
// animates it is its transform and not its glyphs -- which is what makes one frame per clip enough
// and re-rendering per tick a full text layout per tick.
export class GeneratorFrames {
  #painted = new Map<string, Painted>();
  #canvas: OffscreenCanvas | undefined;

  // Takes the whole visible set rather than one clip at a time, so dropping what left the screen
  // happens here instead of at every call site. Without it a scrub through a timeline of titles
  // leaves a full-frame picture behind for each of them.
  pictures(project: Project, visible: ReadonlySet<string>): Map<string, VideoFrame> {
    const size = { width: project.settings.width, height: project.settings.height };
    const wanted = new Map<string, VideoFrame>();
    for (const clip of generatorClips(project, visible)) {
      const frame = this.#frame(clip, size);
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

  #frame(clip: Clip, size: Size): VideoFrame | undefined {
    if (clip.source.kind !== "generator") return undefined;
    // What was painted, not when: the key is the whole generator and the size, so an edit to the
    // content or a change of output resolution repaints and nothing else does.
    const key = `${size.width}x${size.height}|${JSON.stringify(clip.source.generator)}`;
    const held = this.#painted.get(clip.id);
    if (held?.key === key) return held.frame;
    held?.frame.close();
    const frame = this.#paint(clip.source.generator, size);
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
  #paint(generator: Generator, size: Size): VideoFrame | undefined {
    if (!paintsGenerator(generator)) return undefined;
    if (typeof OffscreenCanvas === "undefined" || typeof VideoFrame === "undefined") return undefined;
    try {
      const canvas = this.#surface(size);
      const ctx = canvas.getContext("2d");
      if (ctx === null) return undefined;
      paintGenerator(ctx, generator, size);
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
