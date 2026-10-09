/**
 * Lines that grow out of the lines before them, like a crossword nobody planned.
 *
 * The first line stands on its own. Every line after it runs through a letter that is already
 * there -- "Alle tanzen mit" through the "a" of "Hallo was geht ab" -- in a direction its parent
 * does not have: down, up to the right, across, down to the right -- never upwards or backwards,
 * which would be read the wrong way round. Where no letter is shared,
 * it starts beside a letter of an earlier line instead. Over a song that is a tree of words, and the
 * picture follows the newest branch.
 *
 * The letters sit on a grid and stand upright, the way they do in a crossword: a word written
 * downwards is still read letter by letter, and a crossing is two words sharing one square. Nothing
 * is random -- the direction and the way a line arrives come out of its index and a hash -- so the
 * preview, the timeline and the export draw the same frame.
 */
export interface Cell {
  x: number;
  y: number;
}

export interface Direction {
  dx: number;
  dy: number;
}

export type Entrance = "grow" | "unfold" | "swing";

export interface TreeLine {
  text: string;
  start: Cell;
  direction: Direction;
  /** The letter of this line that sits on a letter of an earlier one, or -1 where none does. */
  shared: number;
  /** Where it grows from: the shared square, or the letter it starts beside. */
  seed: Cell;
  entrance: Entrance;
}

const DIRECTIONS: readonly Direction[] = [
  { dx: 0, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
];

const ENTRANCES: readonly Entrance[] = ["grow", "unfold", "swing"];

/** Longer than this, a line goes down only where nothing else fits. */
const LONG = 12;

/** How far back a new line looks for a letter to grow out of. Further, and branches cross the frame. */
const REACH = 6;

let memo: { texts: string[]; placed: TreeLine[] } = { texts: [], placed: [] };

/**
 * Where every line stands, in grid squares. A line's place depends only on the lines before it, so
 * the song is laid out once and every frame after that reads the same answer.
 */
export function treeLines(texts: readonly string[]): TreeLine[] {
  let same = 0;
  while (same < texts.length && same < memo.texts.length && texts[same] === memo.texts[same]) same += 1;
  const placed = memo.placed.slice(0, same);
  const taken = new Map<string, string>();
  for (const line of placed) occupy(taken, line);
  for (let index = same; index < texts.length; index += 1) {
    const line = place(placed, taken, texts[index]!, index);
    occupy(taken, line);
    placed.push(line);
  }
  memo = { texts: [...texts], placed };
  return placed;
}

export function cellOf(line: TreeLine, index: number): Cell {
  return step(line.start, line.direction, index);
}

function place(placed: readonly TreeLine[], taken: Map<string, string>, text: string, index: number): TreeLine {
  const entrance = ENTRANCES[hash(`${text}:${index}`) % ENTRANCES.length]!;
  const letters = [...text];
  if (placed.length === 0) {
    return { text, start: { x: 0, y: 0 }, direction: DIRECTIONS[2]!, shared: -1, seed: { x: 0, y: 0 }, entrance };
  }
  const tries = attempts(placed, letters.length, index);

  for (const { parent, direction } of tries) {
    for (const [shared, letter] of letters.entries()) {
      if (!isLetter(letter)) continue;
      for (const [at, theirs] of [...parent.text].entries()) {
        if (theirs.toLowerCase() !== letter.toLowerCase()) continue;
        const seed = cellOf(parent, at);
        const start = { x: seed.x - direction.dx * shared, y: seed.y - direction.dy * shared };
        if (fits(taken, letters, start, direction, seed)) return { text, start, direction, shared, seed, entrance };
      }
    }
  }
  // No letter in common: the line starts beside the last letter of a line before, or its first.
  for (const { parent, direction } of tries) {
    for (const at of [parent.text.length - 1, 0]) {
      const seed = cellOf(parent, at);
      const start = { x: seed.x + direction.dx, y: seed.y + direction.dy };
      if (fits(taken, letters, start, direction, seed)) return { text, start, direction, shared: -1, seed, entrance };
    }
  }
  const right = Math.max(...[...taken.keys()].map((key) => Number(key.split(",")[0])));
  const last = placed[placed.length - 1]!;
  const start = { x: right + 2, y: last.start.y };
  return { text, start, direction: DIRECTIONS[2]!, shared: -1, seed: start, entrance };
}

/**
 * Which line to grow from and in which direction, in the order worth trying. Newest parent first, so
 * the tree grows from where the eye is -- except for a long line, which tries every parent across or
 * at a slant before any of them downwards: written downwards it fills the frame top to bottom and the
 * letters shrink to fit it.
 */
function attempts(
  placed: readonly TreeLine[],
  length: number,
  index: number,
): { parent: TreeLine; direction: Direction }[] {
  const turned = DIRECTIONS.map((_, at) => DIRECTIONS[(at + index) % DIRECTIONS.length]!);
  const parents = placed.slice(-REACH).reverse();
  const pairs = parents.flatMap((parent, recency) =>
    turned
      .filter((direction) => crosses(direction, parent.direction))
      .map((direction, rank) => ({ parent, direction, recency, rank })),
  );
  if (length > LONG) {
    const down = (pair: { direction: Direction }): number => (pair.direction.dx === 0 ? 1 : 0);
    pairs.sort((a, b) => down(a) - down(b) || a.recency - b.recency || a.rank - b.rank);
  }
  return pairs;
}

// A new line has to go somewhere its parent does not: along the same axis it would lie on top of it.
function crosses(one: Direction, other: Direction): boolean {
  return one.dx * other.dy - one.dy * other.dx !== 0;
}

/**
 * Whether a line fits where it would stand, by a crossword's rules: every square free or holding the
 * same letter -- a crossing -- and no letter of its own touching a letter of another line, so two
 * words never run alongside each other into a clump. Around the square it grows from, only corners
 * may touch, which leaves the crossings at right angles.
 */
function fits(
  taken: Map<string, string>,
  letters: readonly string[],
  start: Cell,
  direction: Direction,
  seed: Cell,
): boolean {
  const own = new Set(letters.map((_, index) => key(step(start, direction, index))));
  const after = key(step(start, direction, letters.length));
  if (taken.has(after)) return false;
  return letters.every((letter, index) => {
    const cell = step(start, direction, index);
    const held = taken.get(key(cell));
    if (held !== undefined) return isLetter(letter) && held.toLowerCase() === letter.toLowerCase();
    if (letter.trim() === "") return true;
    return NEIGHBOURS.every(({ dx, dy }) => {
      const near = { x: cell.x + dx, y: cell.y + dy };
      // At the crossing itself, corner to corner is how two words at right angles meet. Edge to edge
      // is two words at forty-five degrees, and those read as one clump.
      if (near.x === seed.x && near.y === seed.y) return true;
      if (dx !== 0 && dy !== 0 && Math.abs(near.x - seed.x) <= 1 && Math.abs(near.y - seed.y) <= 1) return true;
      return own.has(key(near)) || !taken.has(key(near));
    });
  });
}

const NEIGHBOURS: readonly Direction[] = [-1, 0, 1].flatMap((dx) =>
  [-1, 0, 1].filter((dy) => dx !== 0 || dy !== 0).map((dy) => ({ dx, dy })),
);

function step(start: Cell, direction: Direction, index: number): Cell {
  return { x: start.x + direction.dx * index, y: start.y + direction.dy * index };
}

function occupy(taken: Map<string, string>, line: TreeLine): void {
  [...line.text].forEach((letter, index) => {
    if (letter.trim() !== "") taken.set(key(cellOf(line, index)), letter);
  });
}

function key(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function isLetter(letter: string): boolean {
  return /\p{L}|\p{N}/u.test(letter);
}

interface Look {
  color: string;
  accent: string;
  size: number;
  position: "top" | "middle" | "bottom";
  font: string;
  weight: number;
  intensity: number;
  glow: number;
}

interface Camera {
  x: number;
  y: number;
  square: number;
}

/**
 * A square is narrower than it is tall, about as wide as a letter: across, the words read at their
 * own spacing rather than as a crossword's, and downwards the letters still stand one under another.
 */
const ASPECT = 0.62;

/** How many lines before the newest stay in the picture, fading as they age. */
const KEPT = 8;

export function paintTree(
  ctx: OffscreenCanvasRenderingContext2D,
  look: Look,
  size: { width: number; height: number },
  texts: readonly string[],
  progress: number,
): void {
  const placed = treeLines(texts);
  const newest = placed.length - 1;
  const line = placed[newest];
  if (line === undefined) return;
  const settle = ease(Math.min(1, progress / 0.3));
  const from = newest > 0 ? cameraOn(placed[newest - 1]!, size, look) : cameraOn(line, size, look);
  const to = cameraOn(line, size, look);
  const camera = {
    x: from.x + (to.x - from.x) * settle,
    y: from.y + (to.y - from.y) * settle,
    square: from.square + (to.square - from.square) * settle,
  };
  const middle = look.position === "top" ? 0.32 : look.position === "bottom" ? 0.68 : 0.5;
  const onScreen = (cell: Cell): { x: number; y: number } => ({
    x: size.width / 2 + (cell.x - camera.x) * camera.square * ASPECT,
    y: size.height * middle + (cell.y - camera.y) * camera.square,
  });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${look.weight} ${Math.max(6, Math.round(camera.square * 0.9))}px ${look.font}`;
  ctx.fillStyle = look.color;
  for (let index = Math.max(0, newest - KEPT); index < newest; index += 1) {
    ctx.globalAlpha = Math.max(0.12, 0.9 - (newest - index) * 0.1);
    const earlier = placed[index]!;
    [...earlier.text].forEach((letter, at) => {
      const point = onScreen(cellOf(earlier, at));
      ctx.fillText(letter, point.x, point.y);
    });
  }
  ctx.globalAlpha = 1;
  paintNewest(ctx, look, line, progress, onScreen, camera.square);
}

/** The newest line, arriving one of three ways: letters out of the seed, folding open, or swinging in. */
function paintNewest(
  ctx: OffscreenCanvasRenderingContext2D,
  look: Look,
  line: TreeLine,
  progress: number,
  onScreen: (cell: Cell) => { x: number; y: number },
  square: number,
): void {
  const letters = [...line.text];
  const seed = onScreen(line.seed);
  const reach = Math.max(1, ...letters.map((_, index) => distance(line, index)));
  const turn = ease(Math.min(1, progress / 0.45));
  const along = Math.atan2(line.direction.dy, line.direction.dx);
  if (look.glow > 0) {
    ctx.shadowColor = look.accent;
    ctx.shadowBlur = square * 0.45 * look.glow;
  }
  letters.forEach((letter, index) => {
    if (letter.trim() === "") return;
    const start = line.entrance === "unfold" ? 0.05 + 0.3 * (distance(line, index) / reach) : 0.08 + 0.55 * (distance(line, index) / reach);
    const arrived = ease(Math.min(1, Math.max(0, (progress - start) / (line.entrance === "unfold" ? 0.25 : 0.18))));
    if (arrived <= 0) return;
    const home = onScreen(cellOf(line, index));
    let x = home.x;
    let y = home.y;
    let scaleX = 1;
    let scaleY = 1;
    if (line.entrance === "grow") {
      x = seed.x + (home.x - seed.x) * arrived;
      y = seed.y + (home.y - seed.y) * arrived;
      const pop = 1 + Math.sin(arrived * Math.PI) * 0.35 * look.intensity;
      scaleX = (0.3 + 0.7 * arrived) * pop;
      scaleY = scaleX;
    } else if (line.entrance === "unfold") {
      // Folding open about the line itself, the way a page turns towards you: across a line drawn
      // left to right it is the height that opens, across one drawn downwards the width.
      const open = arrived;
      if (line.direction.dx === 0) scaleX = open;
      else if (line.direction.dy === 0) scaleY = open;
      else {
        scaleX = 0.4 + 0.6 * open;
        scaleY = open;
      }
    } else {
      const angle = (1 - turn) * (Math.PI / 2) * (1 + look.intensity * 0.5) * (along >= 0 ? -1 : 1);
      const dx = home.x - seed.x;
      const dy = home.y - seed.y;
      x = seed.x + dx * Math.cos(angle) - dy * Math.sin(angle);
      y = seed.y + dx * Math.sin(angle) + dy * Math.cos(angle);
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.2 + arrived);
    ctx.fillStyle = arrived < 1 || index === line.shared ? look.accent : look.color;
    ctx.translate(x, y);
    ctx.scale(Math.max(0.01, scaleX), Math.max(0.01, scaleY));
    ctx.fillText(letter, 0, 0);
    ctx.restore();
  });
  ctx.shadowBlur = 0;
}

// How many squares a letter is from where the line grows, so the letters nearest the seed come first.
function distance(line: TreeLine, index: number): number {
  return line.shared >= 0 ? Math.abs(index - line.shared) : index + 1;
}

/** Centred on a line, and close enough that it fills the frame without leaving it. */
function cameraOn(line: TreeLine, size: { width: number; height: number }, look: Look): Camera {
  const ends = [line.seed, cellOf(line, 0), cellOf(line, line.text.length - 1)];
  const xs = ends.map((cell) => cell.x);
  const ys = ends.map((cell) => cell.y);
  const wide = Math.max(...xs) - Math.min(...xs) + 1;
  const tall = Math.max(...ys) - Math.min(...ys) + 1;
  const square = Math.min(size.height * look.size, (size.width * 0.86) / (wide * ASPECT), (size.height * 0.8) / tall);
  return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, square };
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}
