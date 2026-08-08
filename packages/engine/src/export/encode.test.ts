import { describe, expect, it } from "vitest";

import { audioChunks } from "./encode";

function ramp(from: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => from + index);
}

describe("audioChunks", () => {
  it("cuts the range into whole chunks and a shorter tail", () => {
    const chunks = [
      ...audioChunks({ sampleRate: 10, channels: [ramp(0, 25)] }, 10),
    ];
    expect(chunks.map((chunk) => chunk.numberOfFrames)).toEqual([10, 10, 5]);
  });

  it("dates every chunk from its own offset in the range", () => {
    const chunks = [...audioChunks({ sampleRate: 100, channels: [ramp(0, 250)] }, 100)];
    expect(chunks.map((chunk) => chunk.timestamp)).toEqual([0, 1, 2]);
  });

  it("lays the channels out one plane after the other", () => {
    const chunks = [
      ...audioChunks({ sampleRate: 4, channels: [ramp(0, 4), ramp(100, 4)] }, 2),
    ];
    expect([...chunks[0]!.data]).toEqual([0, 1, 100, 101]);
    expect([...chunks[1]!.data]).toEqual([2, 3, 102, 103]);
  });

  it("keeps the planes contiguous in the short tail too", () => {
    const chunks = [
      ...audioChunks({ sampleRate: 4, channels: [ramp(0, 3), ramp(100, 3)] }, 2),
    ];
    expect([...chunks[1]!.data]).toEqual([2, 102]);
  });

  it("yields nothing for an empty range", () => {
    expect([...audioChunks({ sampleRate: 48000, channels: [] }, 100)]).toEqual([]);
    expect([...audioChunks({ sampleRate: 48000, channels: [new Float32Array(0)] }, 100)]).toEqual(
      [],
    );
  });
});
