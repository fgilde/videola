import type { JsonValue } from "@videola/core";

/**
 * The words of a song, drawn as they are sung.
 *
 * The lines themselves are caption clips on a caption track -- the same clips the subtitle tools
 * already make, drag, trim and merge -- and this reads them. That is the whole reason a lyric
 * video is worth having in a video editor rather than in a generator: when a line lands a beat
 * late, you drag it, and you drag it on the timeline where everything else is dragged.
 *
 * Seven looks, and the one everybody means by "lyric video" is `kinetic`: black and white trading
 * places on every line, one word at a time, arriving too big and settling.
 *
 * Word timings are worked out here rather than read from a file. Almost nothing carries them --
 * `SYLT` is per line, an `.lrc` is per line, a transcript is per word but only sometimes -- and a
 * line's own span divided by the length of its words puts them close enough that nobody watching
 * can tell, on every song, from every source.
 */
export type LyricStyle =
  | "kinetic"
  | "karaoke"
  | "typewriter"
  | "pop"
  | "neon"
  | "flip"
  | "bar"
  | "depth"
  | "morph"
  | "wave"
  | "glitch";

export const LYRIC_STYLES: readonly LyricStyle[] = [
  "kinetic",
  "karaoke",
  "typewriter",
  "pop",
  "neon",
  "flip",
  "bar",
  "depth",
  "morph",
  "wave",
  "glitch",
];

export interface LyricLineOnScreen {
  text: string;
  /** Where the line stands now, 0 at its first word and 1 as it ends. */
  progress: number;
  /** Which line this is, counted from the first: the flip-flop styles alternate on it. */
  index: number;
  /** The line after this one, for the styles that show what is coming. */
  next?: string;
  /** And the one before it, for the styles that let the last line leave or take its letters. */
  previous?: string;
}

export interface LyricOptions {
  style: LyricStyle;
  color: string;
  background: string | undefined;
  /** The second colour: the ground a kinetic line flips to, the glow of a neon one. */
  accent: string;
  /** A share of the frame's height. */
  size: number;
  position: "top" | "middle" | "bottom";
  uppercase: boolean;
  font: string;
  weight: number;
}

interface Size {
  width: number;
  height: number;
}

const POSITIONS = new Set(["top", "middle", "bottom"]);

export function lyricOptions(style: string, raw: Readonly<Record<string, JsonValue>>): LyricOptions {
  const position = text(raw.position, "middle");
  return {
    style: (LYRIC_STYLES as readonly string[]).includes(style) ? (style as LyricStyle) : "kinetic",
    color: text(raw.color, "#ffffff"),
    background: text(raw.background, "") === "" ? undefined : text(raw.background, ""),
    accent: text(raw.accent, "#a048f8"),
    size: number(raw.size, 0.13, 0.03, 0.4),
    position: POSITIONS.has(position) ? (position as LyricOptions["position"]) : "middle",
    uppercase: raw.uppercase === true,
    // A family the machine may not have is a family the canvas falls back from on its own, which is
    // the right behaviour: the words are still drawn.
    font: text(raw.font, "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"),
    weight: Math.round(number(raw.weight, 800, 100, 900)),
  };
}

export function paintLyrics(
  ctx: OffscreenCanvasRenderingContext2D,
  options: LyricOptions,
  size: Size,
  line: LyricLineOnScreen | undefined,
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  const flipped = options.style === "kinetic" && line !== undefined && line.index % 2 === 1;
  const ground = flipped ? options.color : options.background;
  if (ground !== undefined) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  if (line === undefined || line.text.trim() === "") return;
  const ink = flipped ? (options.background ?? options.accent) : options.color;
  const words = (options.uppercase ? line.text.toUpperCase() : line.text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const paint = {
    kinetic: paintKinetic,
    karaoke: paintKaraoke,
    typewriter: paintTypewriter,
    pop: paintPop,
    neon: paintNeon,
    flip: paintFlip,
    bar: paintBar,
    depth: paintDepth,
    morph: paintMorph,
    wave: paintWave,
    glitch: paintGlitch,
  }[options.style];
  paint(ctx, { ...options, color: ink }, size, words, line);
  ctx.restore();
}

type Painter = (
  ctx: OffscreenCanvasRenderingContext2D,
  options: LyricOptions,
  size: Size,
  words: readonly string[],
  line: LyricLineOnScreen,
) => void;

/**
 * The one everybody means. Word by word, each arriving a little too big and settling, the whole
 * line growing across the frame and the ground trading places with the ink on every line.
 */
const paintKinetic: Painter = (ctx, options, size, words, line) => {
  const shown = wordsSoFar(words, line.progress);
  if (shown.count === 0) return;
  const rows = layout(ctx, words.slice(0, shown.count), size, options, 1.18);
  // The newest word arrives at 130% and settles over the first fifth of its own time.
  const settling = Math.min(1, shown.within * 5);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  rows.forEach((row, index) => {
    const last = index === rows.length - 1;
    const scale = last ? 1.3 - 0.3 * settling : 1;
    ctx.save();
    ctx.translate(size.width / 2, middle + index * rows.line);
    ctx.scale(scale, scale);
    ctx.fillStyle = options.color;
    ctx.font = fontOf(options, rows.size);
    ctx.globalAlpha = last ? 0.35 + 0.65 * settling : 1;
    ctx.fillText(row, 0, 0);
    ctx.restore();
  });
};

/** The whole line, filled left to right as it is sung: the one everybody can read along to. */
const paintKaraoke: Painter = (ctx, options, size, words, line) => {
  const rows = layout(ctx, words, size, options, 1.2);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  const filledRows = line.progress * rows.length;
  rows.forEach((row, index) => {
    const y = middle + index * rows.line;
    ctx.font = fontOf(options, rows.size);
    // The row behind: the words that are not being sung yet, in the ink at a quarter strength.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = options.color;
    ctx.fillText(row, size.width / 2, y);
    ctx.globalAlpha = 1;
    // And the fill, clipped to however far through this row the singing is.
    const share = Math.min(1, Math.max(0, filledRows - index));
    if (share <= 0) return;
    const width = ctx.measureText(row).width;
    ctx.save();
    ctx.beginPath();
    ctx.rect((size.width - width) / 2, y - rows.size, width * share, rows.size * 2);
    ctx.clip();
    ctx.fillStyle = options.accent;
    ctx.fillText(row, size.width / 2, y);
    ctx.restore();
  });
  if (line.next !== undefined) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = options.color;
    ctx.font = fontOf(options, rows.size * 0.55);
    ctx.fillText(line.next, size.width / 2, middle + rows.length * rows.line + rows.size);
    ctx.globalAlpha = 1;
  }
};

/** One character at a time, with a block where the next one lands. */
const paintTypewriter: Painter = (ctx, options, size, words, line) => {
  const whole = words.join(" ");
  const shown = Math.max(1, Math.round(whole.length * Math.min(1, line.progress * 1.25)));
  const rows = layout(ctx, whole.slice(0, shown).split(" "), size, options, 1.2);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  ctx.fillStyle = options.color;
  ctx.font = fontOf(options, rows.size);
  rows.forEach((row, index) => {
    const last = index === rows.length - 1;
    const caret = last && shown < whole.length ? "█" : "";
    ctx.fillText(row + caret, size.width / 2, middle + index * rows.line);
  });
};

/** Each word lands on its own beat, bouncing past its size and back. */
const paintPop: Painter = (ctx, options, size, words, line) => {
  const rows = layoutWords(ctx, words, size, options);
  const middle = anchor(size, options, rows.rows.length * rows.line, rows.line);
  const shown = wordsSoFar(words, line.progress);
  let index = 0;
  rows.rows.forEach((row, rowIndex) => {
    let x = (size.width - row.width) / 2;
    for (const word of row.words) {
      if (index < shown.count) {
        const age = index === shown.count - 1 ? Math.min(1, shown.within * 6) : 1;
        // Overshoot and settle: 1.35 at the moment it lands, 1 a sixth of a word later.
        const scale = 1 + 0.35 * (1 - age) * Math.cos(age * Math.PI * 0.5);
        ctx.save();
        ctx.translate(x + word.width / 2, middle + rowIndex * rows.line);
        ctx.scale(scale, scale);
        ctx.fillStyle = index === shown.count - 1 ? options.accent : options.color;
        ctx.font = fontOf(options, rows.size);
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
      }
      x += word.width + rows.space;
      index += 1;
    }
  });
};

/** Letters of light: a wide soft glow under a bright core, on whatever is behind. */
const paintNeon: Painter = (ctx, options, size, words, line) => {
  const rows = layout(ctx, words, size, options, 1.25);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  const pulse = 0.75 + 0.25 * Math.sin(line.progress * Math.PI);
  ctx.font = fontOf(options, rows.size);
  rows.forEach((row, index) => {
    const y = middle + index * rows.line;
    ctx.shadowColor = options.accent;
    ctx.shadowBlur = rows.size * 0.7 * pulse;
    ctx.fillStyle = options.accent;
    ctx.fillText(row, size.width / 2, y);
    ctx.shadowBlur = rows.size * 0.3 * pulse;
    ctx.fillStyle = options.color;
    ctx.fillText(row, size.width / 2, y);
  });
  ctx.shadowBlur = 0;
};

/** Words turning in out of the depth, one after another: the three-dimensional one. */
const paintFlip: Painter = (ctx, options, size, words, line) => {
  const rows = layoutWords(ctx, words, size, options);
  const middle = anchor(size, options, rows.rows.length * rows.line, rows.line);
  const shown = wordsSoFar(words, line.progress);
  let index = 0;
  rows.rows.forEach((row, rowIndex) => {
    let x = (size.width - row.width) / 2;
    for (const word of row.words) {
      if (index < shown.count) {
        const age = index === shown.count - 1 ? Math.min(1, shown.within * 5) : 1;
        // A quarter turn about the horizontal axis, faked by squashing: the face of a word turning
        // towards the camera is exactly a cosine of its height, and a canvas can do that.
        const turn = (1 - age) * (Math.PI / 2);
        ctx.save();
        ctx.translate(x + word.width / 2, middle + rowIndex * rows.line);
        ctx.transform(1, 0, 0, Math.max(0.02, Math.cos(turn)), 0, 0);
        ctx.globalAlpha = 0.2 + 0.8 * age;
        ctx.fillStyle = options.color;
        ctx.font = fontOf(options, rows.size);
        ctx.fillText(word.text, 0, 0);
        ctx.restore();
      }
      x += word.width + rows.space;
      index += 1;
    }
  });
  ctx.globalAlpha = 1;
};

/** A plate with the line on it: the one that stays out of the way, wherever it was put. */
const paintBar: Painter = (ctx, options, size, words) => {
  const rows = layout(ctx, words, size, options, 1.25);
  const block = rows.line * rows.length;
  const middle = anchor(size, options, block, rows.line);
  const top = middle - rows.line / 2 - rows.size * 0.35;
  ctx.fillStyle = options.accent;
  ctx.globalAlpha = 0.72;
  ctx.fillRect(size.width * 0.06, top, size.width * 0.88, block + rows.size * 0.7);
  ctx.globalAlpha = 1;
  ctx.fillStyle = options.color;
  ctx.font = fontOf(options, rows.size);
  rows.forEach((row, index) => {
    ctx.fillText(row, size.width / 2, middle + index * rows.line);
  });
};

/**
 * The line coming at the camera, and the one before it going past behind it.
 *
 * Two planes and a perspective divide: the line being sung starts far away and arrives, while the
 * line before it keeps coming, overshoots the eye and carries on -- drawn mirrored once it is
 * behind, because that is what the back of a word looks like.
 */
const paintDepth: Painter = (ctx, options, size, words, line) => {
  const rows = layout(ctx, words, size, options, 1.2);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  const draw = (text: string, z: number, alpha: number, behind: boolean): void => {
    // A plane at z=1 is at the screen; nearer than 0.05 it is past the eye and not drawn at all.
    if (z < 0.05) return;
    const scale = 1 / z;
    ctx.save();
    ctx.translate(size.width / 2, middle);
    // Seen from behind, a word is its own mirror image. That is the whole of "from behind", and it
    // is what makes a line that has gone past read as having gone past rather than having vanished.
    ctx.scale(behind ? -scale : scale, scale);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = behind ? options.accent : options.color;
    ctx.font = fontOf(options, rows.size);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  // The one before it: from the screen, past the eye, and gone.
  if (line.index > 0 && line.previous !== undefined) {
    const gone = 1 - line.progress * 1.6;
    draw(line.previous, gone, gone < 0.4 ? gone * 2 : 1, gone < 0.35);
  }
  // And this one, arriving from four planes back.
  const coming = 4 - line.progress * 3;
  rows.forEach((row, index) => {
    ctx.save();
    ctx.translate(0, index * rows.line);
    draw(row, coming, Math.min(1, (4 - coming) / 1.5), false);
    ctx.restore();
  });
};

/**
 * Letters that were in the line before travel to where they are needed now.
 *
 * Every letter of the new line looks for itself in the old one: the first "a" takes the place of
 * the first "a" that was there, and one that finds no home fades in where it stands. Over a verse
 * it reads as one line rearranging itself into the next, which is the trick nobody expects a video
 * editor to do.
 */
const paintMorph: Painter = (ctx, options, size, words, line) => {
  const rows = layout(ctx, words, size, options, 1.2);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  ctx.font = fontOf(options, rows.size);
  // Half the line's own time to travel, so the words stand still long enough to be read.
  const travelled = Math.min(1, line.progress * 2);
  const eased = travelled * travelled * (3 - 2 * travelled);
  const before = letterPlaces(ctx, line.previous ?? "", size, middle, rows);
  rows.forEach((row, rowIndex) => {
    const places = letterPlaces(ctx, row, size, middle + rowIndex * rows.line, rows);
    for (const place of places) {
      const from = takeFrom(before, place.letter);
      const x = from === undefined ? place.x : from.x + (place.x - from.x) * eased;
      const y = from === undefined ? place.y : from.y + (place.y - from.y) * eased;
      ctx.globalAlpha = from === undefined ? eased : 1;
      ctx.fillStyle = options.color;
      ctx.fillText(place.letter, x, y);
    }
  });
  ctx.globalAlpha = 1;
};

/** The line riding a wave, each letter a little further along it than the one before. */
const paintWave: Painter = (ctx, options, size, words, line) => {
  const rows = layout(ctx, words, size, options, 1.3);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  ctx.font = fontOf(options, rows.size);
  ctx.fillStyle = options.color;
  const height = rows.size * 0.28;
  rows.forEach((row, rowIndex) => {
    for (const place of letterPlaces(ctx, row, size, middle + rowIndex * rows.line, rows)) {
      const phase = place.index * 0.45 - line.progress * Math.PI * 4;
      ctx.fillText(place.letter, place.x, place.y + Math.sin(phase) * height);
    }
  });
};

/**
 * The line, torn: three passes a few pixels apart in red, blue and the ink, and the tear opening
 * and closing on the beat of the line rather than at random -- an export has to draw the same
 * frame the preview did, and `Math.random` would make every pass a different video.
 */
const paintGlitch: Painter = (ctx, options, size, words, line) => {
  const rows = layout(ctx, words, size, options, 1.2);
  const middle = anchor(size, options, rows.length * rows.line, rows.line);
  ctx.font = fontOf(options, rows.size);
  // Hard at the start of a line, settling as it is sung, with a wobble on top of it.
  const torn = (1 - line.progress) * 0.7 + Math.abs(Math.sin(line.progress * 17)) * 0.3;
  const shift = torn * rows.size * 0.18;
  rows.forEach((row, index) => {
    const y = middle + index * rows.line;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#ff0044";
    ctx.fillText(row, size.width / 2 - shift, y);
    ctx.fillStyle = "#00e5ff";
    ctx.fillText(row, size.width / 2 + shift, y);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = options.color;
    ctx.fillText(row, size.width / 2, y);
  });
};

interface LetterPlace {
  letter: string;
  x: number;
  y: number;
  index: number;
}

/** Where every letter of a row stands, so a style can move them one at a time. */
function letterPlaces(
  ctx: OffscreenCanvasRenderingContext2D,
  row: string,
  size: { width: number; height: number },
  y: number,
  rows: { size: number },
): LetterPlace[] {
  if (row === "") return [];
  const width = ctx.measureText(row).width;
  let x = (size.width - width) / 2;
  const places: LetterPlace[] = [];
  for (const [index, letter] of [...row].entries()) {
    const letterWidth = ctx.measureText(letter).width;
    // The canvas draws centred here, so each letter is placed at the middle of its own box.
    places.push({ letter, x: x + letterWidth / 2, y, index });
    x += letterWidth;
  }
  void rows;
  return places;
}

/** The first place that letter had in the line before, taken so two "a"s do not share one home. */
function takeFrom(before: LetterPlace[], letter: string): LetterPlace | undefined {
  const at = before.findIndex((place) => place.letter.toLowerCase() === letter.toLowerCase());
  if (at < 0) return undefined;
  const [found] = before.splice(at, 1);
  return found;
}

/**
 * How many words have been sung, and how far into the newest one.
 *
 * Weighted by length rather than counted: "I" and "unbelievable" do not take the same time to sing,
 * and a line that gave them the same slice lands its last word before the singer does.
 */
function wordsSoFar(
  words: readonly string[],
  progress: number,
): { count: number; within: number } {
  const total = words.reduce((sum, word) => sum + word.length + 1, 0);
  const reached = Math.min(1, Math.max(0, progress)) * total;
  let passed = 0;
  for (const [index, word] of words.entries()) {
    const span = word.length + 1;
    if (reached < passed + span) {
      return { count: index + 1, within: (reached - passed) / span };
    }
    passed += span;
  }
  return { count: words.length, within: 1 };
}

interface Rows extends Array<string> {
  size: number;
  line: number;
}

/**
 * The line broken into rows that fit the frame, and the size they fit at.
 *
 * Shrinks rather than overflows: a chorus with a long line in it has to stay inside the picture,
 * and a lyric video where one line runs off both edges is the first thing anybody notices.
 */
function layout(
  ctx: OffscreenCanvasRenderingContext2D,
  words: readonly string[],
  size: Size,
  options: LyricOptions,
  spacing: number,
): Rows {
  const reach = size.width * 0.86;
  let fontSize = size.height * options.size;
  let rows: string[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ctx.font = fontOf(options, fontSize);
    rows = wrap(ctx, words, reach);
    const tall = rows.length * fontSize * spacing;
    if (rows.every((row) => ctx.measureText(row).width <= reach) && tall <= size.height * 0.8) break;
    fontSize *= 0.85;
  }
  const out = rows as Rows;
  out.size = fontSize;
  out.line = fontSize * spacing;
  return out;
}

interface WordBox {
  text: string;
  width: number;
}

interface WordRows {
  rows: { words: WordBox[]; width: number }[];
  size: number;
  line: number;
  space: number;
}

/** The same layout, but keeping the words apart: the styles that animate one at a time need boxes. */
function layoutWords(
  ctx: OffscreenCanvasRenderingContext2D,
  words: readonly string[],
  size: Size,
  options: LyricOptions,
): WordRows {
  const laid = layout(ctx, words, size, options, 1.2);
  ctx.font = fontOf(options, laid.size);
  const space = ctx.measureText(" ").width;
  const rows = laid.map((row) => {
    const boxes = row.split(" ").map((text) => ({ text, width: ctx.measureText(text).width }));
    const width = boxes.reduce((sum, box) => sum + box.width, 0) + space * Math.max(0, boxes.length - 1);
    return { words: boxes, width };
  });
  return { rows, size: laid.size, line: laid.line, space };
}

function wrap(
  ctx: OffscreenCanvasRenderingContext2D,
  words: readonly string[],
  reach: number,
): string[] {
  const rows: string[] = [];
  let row = "";
  for (const word of words) {
    const candidate = row === "" ? word : `${row} ${word}`;
    if (row !== "" && ctx.measureText(candidate).width > reach) {
      rows.push(row);
      row = word;
    } else {
      row = candidate;
    }
  }
  if (row !== "") rows.push(row);
  return rows;
}

/**
 * Where the middle of the first row sits.
 *
 * Every style draws its rows at `anchor + index * line`, so this is the one place the three
 * positions are decided -- and the half-line is what makes "middle" mean the middle of the block
 * rather than the top of it.
 */
function anchor(size: Size, options: LyricOptions, block: number, line: number): number {
  const half = line / 2;
  if (options.position === "top") return size.height * 0.14 + half;
  if (options.position === "bottom") return size.height * 0.86 - block + half;
  return size.height / 2 - block / 2 + half;
}

function fontOf(options: LyricOptions, size: number): string {
  return `${options.weight} ${Math.max(6, Math.round(size))}px ${options.font}`;
}

function number(value: JsonValue | undefined, fallback: number, low: number, high: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, low), high)
    : fallback;
}

function text(value: JsonValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
