import { timeToSeconds } from "@videola/core";

import { textStyle } from "./text";

import type { Clip, Time, Transform } from "@videola/core";
import type { TextMove, TextStyle } from "./text";

interface Size {
  width: number;
  height: number;
}

// How far a rising title travels, as a fraction of the frame's height, and how small a growing one
// starts. Chosen rather than authored: a title that slides a whole frame reads as a slide transition,
// and one that slides three pixels reads as a rendering fault.
const TRAVEL = 0.06;
const GROW_FROM = 0.85;
const PULSE = 0.04;

interface Phase {
  opacity: number;
  scale: number;
  shift: number;
}

const STILL: Phase = { opacity: 1, scale: 1, shift: 0 };

// A title's in, out and loop animation, as a transform rather than as pixels. That is the whole
// design decision here: the glyphs are rasterised once and what moves is the quad they are on, so a
// looping title costs one matrix per frame instead of one text layout per frame -- and the same
// function serves the preview and the export, because the draw list is shared.
//
// Keyframes are deliberately not what this is. A keyframe is resolved in the Rust core, and putting a
// second interpolation next to it would be the divergence the core exists to prevent. This is a
// declarative preset with no authored values in between, evaluated in the one place both renderers go
// through.
export function generatorMotion(clip: Clip, at: Time, frame: Size): Transform {
  const style = titleStyle(clip);
  if (style === undefined) return clip.transform;
  const elapsed = at - clip.start;
  const phase = compose(
    arrive(style.animateIn, fraction(elapsed, style.animateInSeconds)),
    arrive(style.animateOut, fraction(clip.duration - elapsed, style.animateOutSeconds)),
    beat(style, elapsed),
  );
  return {
    ...clip.transform,
    opacity: clip.transform.opacity * phase.opacity,
    scaleX: clip.transform.scaleX * phase.scale,
    scaleY: clip.transform.scaleY * phase.scale,
    // y runs down the picture, which is what makes a positive shift "below where it belongs".
    y: clip.transform.y + phase.shift * frame.height,
  };
}

function titleStyle(clip: Clip): TextStyle | undefined {
  if (clip.source.kind !== "generator" || clip.source.generator.type !== "text") return undefined;
  return textStyle(clip.source.generator.style);
}

// 1 is in place, 0 is as far out as the animation goes. An animation of no length is over before it
// began, which is the same as not having one.
function fraction(remaining: Time, seconds: number): number {
  if (seconds <= 0) return 1;
  const progress = timeToSeconds(remaining) / seconds;
  return Math.min(Math.max(progress, 0), 1);
}

// Both ends of the clip use the same function, so `rise` means the title is below its place while it
// is not in it -- it comes up on the way in and goes back down on the way out. Symmetric by
// construction rather than by two tables that can disagree.
function arrive(move: TextMove, progress: number): Phase {
  if (move === "none") return STILL;
  // Smoothstep rather than linear: a title that starts and stops abruptly reads as a dropped frame.
  const eased = progress * progress * (3 - 2 * progress);
  switch (move) {
    case "rise":
      return { opacity: eased, scale: 1, shift: (1 - eased) * TRAVEL };
    case "fall":
      return { opacity: eased, scale: 1, shift: -(1 - eased) * TRAVEL };
    case "grow":
      return { opacity: eased, scale: GROW_FROM + (1 - GROW_FROM) * eased, shift: 0 };
    default:
      return { opacity: eased, scale: 1, shift: 0 };
  }
}

function beat(style: TextStyle, elapsed: Time): Phase {
  if (style.loop !== "pulse") return STILL;
  const turns = timeToSeconds(elapsed) / style.loopSeconds;
  return { opacity: 1, scale: 1 + PULSE * Math.sin(turns * 2 * Math.PI), shift: 0 };
}

function compose(...phases: readonly Phase[]): Phase {
  return phases.reduce((total, phase) => ({
    opacity: total.opacity * phase.opacity,
    scale: total.scale * phase.scale,
    shift: total.shift + phase.shift,
  }));
}
