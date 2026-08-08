import { describe, expect, it, vi } from "vitest";

import { EXPORT_FORMATS, formatSupport } from "./format";

import type { EncodeProbe } from "./format";

const TARGET = { width: 1280, height: 720, sampleRate: 44100, channels: 1 };

function probe(overrides: Partial<EncodeProbe> = {}): EncodeProbe {
  return {
    video: vi.fn(async () => true),
    audio: vi.fn(async () => true),
    ...overrides,
  };
}

describe("formatSupport", () => {
  it("reports every offered format", async () => {
    const support = await formatSupport(TARGET, probe());
    expect(support.map((entry) => entry.format.id)).toEqual(
      EXPORT_FORMATS.map((format) => format.id),
    );
  });

  it("asks the encoder about the size and format the run will use", async () => {
    const asked = probe();
    await formatSupport(TARGET, asked);
    expect(asked.video).toHaveBeenCalledWith("avc", expect.objectContaining({
      width: 1280,
      height: 720,
    }));
    expect(asked.audio).toHaveBeenCalledWith("aac", { sampleRate: 44100, numberOfChannels: 1 });
  });

  it("marks a video codec the machine refuses", async () => {
    const support = await formatSupport(
      TARGET,
      probe({ video: async (codec) => codec !== "avc" }),
    );
    expect(support.find((entry) => entry.format.id === "mp4")?.video).toBe(false);
    expect(support.find((entry) => entry.format.id === "webm")?.video).toBe(true);
  });

  it("keeps a format whose video encodes but whose audio does not", async () => {
    const support = await formatSupport(TARGET, probe({ audio: async () => false }));
    expect(support.every((entry) => entry.video)).toBe(true);
    expect(support.every((entry) => !entry.audio)).toBe(true);
  });

  it("counts a probe that throws as unsupported instead of failing the menu", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const support = await formatSupport(
      TARGET,
      probe({
        video: async (codec) => {
          if (codec === "avc") throw new TypeError("unknown codec");
          return true;
        },
      }),
    );
    expect(support.find((entry) => entry.format.id === "mp4")?.video).toBe(false);
    expect(support.find((entry) => entry.format.id === "webm")?.video).toBe(true);
  });
});
