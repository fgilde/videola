import { cmd, on, secondsToTime, speedRateAt } from "./commands";

import type { JsonValue } from "./generated/serde_json/JsonValue";

import type {
  Clip,
  ClipSource,
  Command,
  MediaAsset,
  Project,
  Time,
  TrackKind,
} from "./generated";

// A preset is a list of commands and nothing else. It gets no place in the model, and giving it one
// would cost it everything it gets for free: `Dispatch.coalesceKey` already collapses a list into a
// single undo step, `json_patch::diff` already builds the inverse of whatever the list did, the
// command layer already refuses every field it would have had to check itself, and the batch
// endpoint already carries a list over MCP under one key. A `Preset` in the project file would need
// its own load boundary, its own undo and its own wire format, and would become a second authority
// on what "a quarter-size picture in the corner" means -- one that the commands could then disagree
// with. What is authored here is arithmetic, not a new kind of thing.
//
// Which is also why every function below returns `Command[]` rather than dispatching: the caller
// decides the coalesce key, and the same list serves the menu, a test, and an agent over the wire.

// The frame a project draws into, and the pixel size of the material a clip carries. Placement is
// arithmetic on both -- a clip is drawn at its own pixel size scaled, not at the frame's -- so a
// preset that assumed the two were equal would put a corner picture off the edge for any clip whose
// material is not exactly the project's resolution.
export interface Stage {
  readonly frame: { readonly width: number; readonly height: number };
  readonly source: { readonly width: number; readonly height: number };
}

export function stageFor(project: Project, clip: Clip): Stage {
  const frame = { width: project.settings.width, height: project.settings.height };
  return { frame, source: sourceSize(project, clip) ?? frame };
}

// A clip whose medium the library has not measured, or which is not a medium at all, is drawn by
// the compositor at the frame's own size. Falling back to the frame is therefore the same answer
// the picture gives, not a guess.
function sourceSize(project: Project, clip: Clip): Stage["source"] | undefined {
  if (clip.source.kind !== "media") return undefined;
  const asset: MediaAsset | undefined = project.library.find(
    (entry) => entry.id === (clip.source as { media: string }).media,
  );
  if (asset?.width == null || asset.height == null) return undefined;
  if (asset.width <= 0 || asset.height <= 0) return undefined;
  return { width: asset.width, height: asset.height };
}

// The scale at which the material covers the frame without letterboxing, which is where a preset
// that moves a picture around has to start: zooming out from anything smaller would show the
// background through the corners.
function coverScale(stage: Stage): number {
  return Math.max(stage.frame.width / stage.source.width, stage.frame.height / stage.source.height);
}

/**
 * Freeze the picture from `at` to the end of the clip.
 *
 * A frame hold is a rate of zero and nothing else -- no still-image clip, no second kind of source,
 * no branch anywhere downstream. Two keys on the rate track: the speed the clip already runs at,
 * held to `at`, and zero from there on. The frame it stops on is exactly the one the playhead was
 * showing, because the area under the rate up to `at` is unchanged by what comes after it.
 *
 * The sound stops with the picture for the same reason and through the same track.
 *
 * Nothing is returned for a reversed clip, and the menu entry is disabled rather than wrong. A
 * reversed clip reads `in_point + consumed - area`, so zeroing the rate shortens `consumed` and
 * moves the frame the clip is *anchored* to instead of the one it stops on -- it would always
 * freeze on `in_point`, whatever the playhead was showing. Holding an arbitrary frame there needs
 * the source range to keep its far end while its near end moves, which is a slip by a negative
 * amount, and `clip.slip` measures its step as an area and so has no negative to give. Reverse the
 * clip after the hold, or hold and then reverse.
 */
export function frameHold(clip: Clip, at: Time): Command[] {
  if (clip.speed.reverse) return [];
  if (at <= clip.start || at >= clip.start + clip.duration) return [];
  return [
    cmd.keyframeAdd(
      on.clip(clip.id),
      null,
      "speed",
      clip.start,
      { kind: "float", value: speedRateAt(clip, clip.start) },
      "hold",
    ),
    cmd.keyframeAdd(on.clip(clip.id), null, "speed", at, { kind: "float", value: 0 }, "hold"),
  ];
}

export type SpeedShape = "slowIn" | "slowOut" | "slowMiddle";

/**
 * A speed ramp across the whole clip, as three shapes people actually ask for.
 *
 * `slowIn` starts slow and returns to normal, `slowOut` does the reverse, `slowMiddle` dips in the
 * middle and comes back. Every key is `ease`, so the rate itself arrives and leaves smoothly rather
 * than turning a corner -- and because the mapping is the area under that curve, the picture eases
 * into the slow part instead of jumping into it.
 */
export function speedRamp(clip: Clip, shape: SpeedShape, slow = 0.35): Command[] {
  const end = clip.start + clip.duration;
  const middle = clip.start + Math.round(clip.duration / 2);
  const fast = clip.speed.rate;
  const points: [Time, number][] =
    shape === "slowIn"
      ? [
          [clip.start, slow],
          [end, fast],
        ]
      : shape === "slowOut"
        ? [
            [clip.start, fast],
            [end, slow],
          ]
        : [
            [clip.start, fast],
            [middle, slow],
            [end, fast],
          ];
  return points.map(([time, rate]) =>
    cmd.keyframeAdd(on.clip(clip.id), null, "speed", time, { kind: "float", value: rate }, "ease"),
  );
}

export type KenBurnsMove = "in" | "out";

// How far a Ken Burns push travels, as a fraction of the frame. Small on purpose: the whole point
// is a move slow enough that nobody watches it happen, and a bigger one reads as a zoom effect.
const KEN_BURNS_ZOOM = 1.18;
const KEN_BURNS_DRIFT = 0.045;

/**
 * A slow push and drift over a clip or a still -- the Ken Burns move.
 *
 * No new mechanism: two keys on `scaleX` and `scaleY` and a two-point motion path, which is exactly
 * a straight line between them. It starts from the scale at which the material covers the frame, so
 * the corners never open onto the background at either end of the move.
 */
export function kenBurns(clip: Clip, stage: Stage, move: KenBurnsMove = "in"): Command[] {
  const end = clip.start + clip.duration;
  const base = coverScale(stage);
  const [from, to] = move === "in" ? [base, base * KEN_BURNS_ZOOM] : [base * KEN_BURNS_ZOOM, base];
  const drift = KEN_BURNS_DRIFT * stage.frame.width;
  const lift = KEN_BURNS_DRIFT * stage.frame.height;
  const scale = (key: string, time: Time, value: number): Command =>
    cmd.keyframeAdd(on.clip(clip.id), null, key, time, { kind: "float", value }, "ease");
  const place = (time: Time, x: number, y: number): Command =>
    cmd.keyframeAdd(on.clip(clip.id), null, "position", time, { kind: "vec2", value: [x, y] }, "ease");
  return [
    scale("scaleX", clip.start, from),
    scale("scaleY", clip.start, from),
    scale("scaleX", end, to),
    scale("scaleY", end, to),
    place(clip.start, -drift, lift),
    place(end, drift, -lift),
  ];
}

export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

// A quarter of each side of the frame, and a margin of one fortieth so the picture reads as inset
// rather than as bleeding off the edge.
const PIP_SIDE = 0.25;
const PIP_MARGIN = 0.025;

/**
 * A clip shrunk to a quarter of the frame and parked in a corner.
 *
 * One transform, and a move to `toTrack` where the caller has a track above to put it on -- a
 * picture in picture is a picture over another one, and the stacking is the track order.
 */
export function pictureInPicture(
  clip: Clip,
  stage: Stage,
  corner: Corner = "bottomRight",
  toTrack?: string,
): Command[] {
  const scale = Math.min(
    (PIP_SIDE * stage.frame.width) / stage.source.width,
    (PIP_SIDE * stage.frame.height) / stage.source.height,
  );
  const half = (stage.frame.width - stage.source.width * scale) / 2 - PIP_MARGIN * stage.frame.width;
  const rise =
    (stage.frame.height - stage.source.height * scale) / 2 - PIP_MARGIN * stage.frame.height;
  const right = corner === "topRight" || corner === "bottomRight";
  const bottom = corner === "bottomLeft" || corner === "bottomRight";
  const placed = cmd.clipSetTransform(clip.id, {
    ...clip.transform,
    x: right ? half : -half,
    y: bottom ? rise : -rise,
    scaleX: scale,
    scaleY: scale,
  });
  return toTrack === undefined || toTrack === ""
    ? [placed]
    : [cmd.clipMove(clip.id, toTrack, clip.start), placed];
}

export type SplitAxis = "sideBySide" | "stacked";

/**
 * Two clips sharing the frame, each cropped to the half it stands in.
 *
 * The crop is what makes this a split screen rather than two squashed pictures: each clip is scaled
 * to cover the frame and then has half of itself cut away, so both keep their proportions and
 * neither reaches across the middle.
 */
export function splitScreen(
  clips: readonly [Clip, Clip],
  stages: readonly [Stage, Stage],
  axis: SplitAxis = "sideBySide",
  toTrack?: string,
): Command[] {
  const commands: Command[] = [];
  clips.forEach((clip, index) => {
    const stage = stages[index]!;
    const scale = coverScale(stage);
    const shift = axis === "sideBySide" ? stage.frame.width / 4 : stage.frame.height / 4;
    const first = index === 0;
    // Half the picture is cut off the side that faces the middle, so what is left fills its own half
    // exactly. The anchor stays where it was; cropping moves no pivot.
    const crop = {
      ...clip.transform.crop,
      left: axis === "sideBySide" && !first ? 0.5 : 0,
      right: axis === "sideBySide" && first ? 0.5 : 0,
      top: axis === "stacked" && !first ? 0.5 : 0,
      bottom: axis === "stacked" && first ? 0.5 : 0,
    };
    if (index === 1 && toTrack !== undefined && toTrack !== "") {
      commands.push(cmd.clipMove(clip.id, toTrack, clip.start));
    }
    commands.push(
      cmd.clipSetTransform(clip.id, {
        ...clip.transform,
        x: axis === "sideBySide" ? (first ? -shift : shift) : 0,
        y: axis === "stacked" ? (first ? -shift : shift) : 0,
        scaleX: scale,
        scaleY: scale,
        crop,
      }),
    );
  });
  return commands;
}

export type TitleKind = "lowerThird" | "banner" | "credits";

// The three shapes a title takes, in the style keys the text generator already reads (see
// packages/engine/src/generate/text.ts). Nothing new is being built here: the generator can already
// set a face, a box, a stroke and an in/out animation, and what was missing was the combinations.
// Every value below is inside the range that file clamps to, so what is authored is what is drawn.
const TITLE_STYLES: Record<TitleKind, Record<string, JsonValue>> = {
  lowerThird: {
    fontSize: 0.055,
    fontWeight: 700,
    align: "left",
    x: 0.08,
    y: 0.8,
    maxWidth: 0.55,
    background: "#000000b3",
    padding: 0.45,
    animateIn: "rise",
    animateInSeconds: 0.45,
    animateOut: "fade",
    animateOutSeconds: 0.35,
  },
  banner: {
    fontSize: 0.085,
    fontWeight: 800,
    align: "center",
    x: 0.5,
    y: 0.5,
    maxWidth: 0.8,
    background: "#000000cc",
    padding: 0.55,
    animateIn: "grow",
    animateInSeconds: 0.4,
    animateOut: "fade",
    animateOutSeconds: 0.4,
  },
  credits: {
    fontSize: 0.045,
    fontWeight: 500,
    align: "center",
    x: 0.5,
    y: 0.5,
    maxWidth: 0.7,
    lineHeight: 1.7,
    animateIn: "rise",
    animateInSeconds: 0.9,
    animateOut: "fade",
    animateOutSeconds: 0.9,
  },
};

/**
 * A titled clip, ready-styled -- a lower third, a full-frame banner, or a centred credits card.
 *
 * One command, because a generator's style is written when the clip is added and there is no
 * command that edits it afterwards. That is a real limit and the reason these are presets for
 * *making* a title rather than for restyling one.
 */
export function title(
  track: string,
  kind: TitleKind,
  text: string,
  start: Time,
  duration: Time,
): Command[] {
  return [
    cmd.clipAdd(
      track,
      {
        kind: "generator",
        generator: { type: "text", content: text, style: TITLE_STYLES[kind] },
      },
      start,
      duration,
    ),
  ];
}

/** Everything a person can put on the timeline that is not a medium. */
export type InsertKind = TitleKind | "shape" | "countdown";

export const INSERT_KINDS: readonly InsertKind[] = [
  "lowerThird",
  "banner",
  "credits",
  "shape",
  "countdown",
];

/**
 * What an insert lays down: the clip's source, how long it stands by default, and the kind of track
 * it belongs on.
 *
 * The track kind is decided here rather than by the caller for the same reason the styles are: it is
 * knowledge about the model, and two callers deciding it separately is two answers to where a title
 * goes. A title goes on a text track, which is what the mixer skips and the caption tools look for;
 * a shape and a countdown are pictures over the picture, and belong on an overlay.
 */
export function insert(kind: InsertKind, text: string): {
  source: ClipSource;
  duration: Time;
  track: TrackKind;
} {
  if (kind === "countdown") {
    // Three seconds, and the clip is exactly as long as it counts: a countdown standing on a fourth
    // second is a clip showing nothing, which reads as a bug rather than as a pause.
    return {
      source: { kind: "generator", generator: { type: "countdown", fromSeconds: 3 } },
      duration: secondsToTime(3),
      track: "overlay",
    };
  }
  if (kind === "shape") {
    return {
      source: { kind: "generator", generator: { type: "shape", shape: "rectangle", color: "#ffffff" } },
      duration: secondsToTime(3),
      track: "overlay",
    };
  }
  return {
    source: {
      kind: "generator",
      generator: { type: "text", content: text, style: TITLE_STYLES[kind] },
    },
    duration: secondsToTime(kind === "credits" ? 8 : 4),
    track: "text",
  };
}
