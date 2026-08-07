import { describe, expect, it } from "vitest";

import { blit } from "./audio-source";

const target = (length: number): Float32Array => new Float32Array(length);
const source = (...values: number[]): Float32Array => Float32Array.from(values);

describe("blit", () => {
  it("writes a whole chunk at its offset", () => {
    const into = target(6);
    blit(into, source(1, 2, 3), 2);

    expect([...into]).toEqual([0, 0, 1, 2, 3, 0]);
  });

  it("drops the head of a chunk that starts before the range", () => {
    const into = target(4);
    blit(into, source(1, 2, 3, 4), -2);

    expect([...into]).toEqual([3, 4, 0, 0]);
  });

  it("drops the tail of a chunk that runs past the range", () => {
    const into = target(4);
    blit(into, source(1, 2, 3, 4), 2);

    expect([...into]).toEqual([0, 0, 1, 2]);
  });

  it("writes nothing for a chunk entirely outside the range", () => {
    const into = target(3);
    blit(into, source(1, 2), 3);
    blit(into, source(1, 2), -2);

    expect([...into]).toEqual([0, 0, 0]);
  });
});
