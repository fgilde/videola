import { describe, expect, it } from "vitest";

import { formatTimecode } from "./formatTimecode";

const FPS_25 = { numerator: 25, denominator: 1 };
const FPS_100 = { numerator: 100, denominator: 1 };
const NTSC_30 = { numerator: 30000, denominator: 1001 }; // 29.97
const NTSC_24 = { numerator: 24000, denominator: 1001 }; // 23.976
const NTSC_60 = { numerator: 60000, denominator: 1001 }; // 59.94

describe("formatTimecode", () => {
  it("formats a plain duration", () => {
    expect(formatTimecode(90, FPS_25)).toBe("00:01:30.00");
  });

  it("does not go negative internally when the input is negative", () => {
    expect(formatTimecode(-5, FPS_25)).toBe("-00:00:05.00");
  });

  it("names the last field frames and derives it from fps, not hundredths", () => {
    expect(formatTimecode(0.5, FPS_25)).toBe("00:00:00.13");
  });

  it("rounds a single exact quantity instead of subtracting floats", () => {
    // (90.05 - 90) * 100 is 4.999...; going through totalFrames avoids that entirely.
    expect(formatTimecode(90.05, FPS_100)).toBe("00:01:30.05");
  });

  it("counts frames against the nominal rate for 29.97", () => {
    expect(formatTimecode(90, NTSC_30)).toBe("00:01:29.27");
  });

  it("counts frames against the nominal rate for 23.976", () => {
    expect(formatTimecode(10, NTSC_24)).toBe("00:00:10.00");
  });

  it("counts frames against the nominal rate for 59.94", () => {
    expect(formatTimecode(60, NTSC_60)).toBe("00:00:59.56");
  });

  it("keeps the frame field two digits wide for every fps here", () => {
    for (const fps of [FPS_25, FPS_100, NTSC_30, NTSC_24, NTSC_60]) {
      const frameField = formatTimecode(1, fps).split(".")[1];
      expect(frameField, JSON.stringify(fps)).toHaveLength(2);
    }
  });
});
