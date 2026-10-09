import { describe, expect, it } from "vitest";

import { cellOf, treeLines, type TreeLine } from "./lyric-tree";

const letterAt = (line: TreeLine, index: number) => cellOf(line, index);

function squares(lines: readonly TreeLine[]): Map<string, string[]> {
  const held = new Map<string, string[]>();
  for (const line of lines) {
    [...line.text].forEach((letter, index) => {
      if (letter === " ") return;
      const cell = cellOf(line, index);
      const key = `${cell.x},${cell.y}`;
      held.set(key, [...(held.get(key) ?? []), letter.toLowerCase()]);
    });
  }
  return held;
}

describe("a tree of lines", () => {
  it("lays the first line across, on its own", () => {
    const [first] = treeLines(["Hallo was geht ab"]);

    expect(first).toMatchObject({ start: { x: 0, y: 0 }, direction: { dx: 1, dy: 0 }, shared: -1 });
  });

  // The example it was asked for: "Alle tanzen mit" out of an "a" of "Hallo was geht ab".
  it("grows the next line through a letter already standing", () => {
    const [first, second] = treeLines(["Hallo was geht ab", "Alle tanzen mit"]);

    expect(second!.shared).toBeGreaterThanOrEqual(0);
    const crossing = letterAt(second!, second!.shared);
    const theirs = [...first!.text].findIndex((_, index) => {
      const cell = cellOf(first!, index);
      return cell.x === crossing.x && cell.y === crossing.y;
    });
    expect(first!.text[theirs]?.toLowerCase()).toBe(second!.text[second!.shared]?.toLowerCase());
  });

  it("never runs a line along the one it grows out of", () => {
    const lines = treeLines(["Hallo was geht ab", "Alle tanzen mit", "Morgen ist ein neuer Tag", "Tanz mit mir"]);

    for (const line of lines.slice(1)) {
      const parent = lines.find((other) =>
        other !== line && [...other.text].some((_, index) => {
          const cell = cellOf(other, index);
          return cell.x === line.seed.x && cell.y === line.seed.y;
        }),
      )!;
      expect(parent.direction.dx * line.direction.dy - parent.direction.dy * line.direction.dx).not.toBe(0);
    }
  });

  // A crossing is two words sharing one square with the same letter; anything else on one square is
  // two words drawn over each other.
  it("puts two letters on one square only where they are the same letter", () => {
    const lines = treeLines([
      "Hallo was geht ab",
      "Alle tanzen mit",
      "Morgen ist ein neuer Tag",
      "Tanz mit mir",
      "Die Nacht ist lang",
      "Wir singen laut",
      "Hallo was geht ab",
    ]);

    for (const letters of squares(lines).values()) expect(new Set(letters).size).toBe(1);
  });

  // Two words alongside each other read as one clump of letters, which is what a crossword forbids.
  it("lets no letter touch another line's letter, except where the line grows from", () => {
    const lines = treeLines([
      "Hallo was geht ab",
      "Alle tanzen mit",
      "Morgen ist ein neuer Tag",
      "Tanz mit mir heut Nacht",
      "Die Stadt ist laut",
      "Und wir sind wach",
    ]);
    const owner = new Map<string, number>();
    lines.forEach((line, which) =>
      [...line.text].forEach((letter, index) => {
        const cell = cellOf(line, index);
        if (letter !== " " && !owner.has(`${cell.x},${cell.y}`)) owner.set(`${cell.x},${cell.y}`, which);
      }),
    );
    lines.forEach((line, which) => {
      [...line.text].forEach((letter, index) => {
        if (letter === " ") return;
        const cell = cellOf(line, index);
        if (owner.get(`${cell.x},${cell.y}`) !== which) return;
        for (const dx of [-1, 0, 1]) {
          for (const dy of [-1, 0, 1]) {
            const other = owner.get(`${cell.x + dx},${cell.y + dy}`);
            if (other === undefined || other >= which) continue;
            const atSeed = cell.x + dx === line.seed.x && cell.y + dy === line.seed.y;
            const corner = dx !== 0 && dy !== 0;
            const nearSeed = Math.max(Math.abs(cell.x + dx - line.seed.x), Math.abs(cell.y + dy - line.seed.y)) <= 1;
            expect(atSeed || (corner && nearSeed)).toBe(true);
          }
        }
      });
    });
  });

  it("starts beside a letter where no letter is shared", () => {
    const [first, second] = treeLines(["abc", "xyz"]);

    expect(second!.shared).toBe(-1);
    const seed = second!.seed;
    expect([0, 1, 2].some((index) => {
      const cell = cellOf(first!, index);
      return cell.x === seed.x && cell.y === seed.y;
    })).toBe(true);
    const start = second!.start;
    expect(Math.abs(start.x - seed.x) + Math.abs(start.y - seed.y)).toBeGreaterThan(0);
  });

  it("lays a song out the same way every time, however it is asked", () => {
    const song = ["Hallo was geht ab", "Alle tanzen mit", "Morgen ist ein neuer Tag"];
    const whole = treeLines(song).map((line) => ({ ...line }));
    treeLines(["something else entirely"]);

    expect(treeLines(song)).toEqual(whole);
    expect(treeLines(song.slice(0, 2))).toEqual(whole.slice(0, 2));
  });
});
