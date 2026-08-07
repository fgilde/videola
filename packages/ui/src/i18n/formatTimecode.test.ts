import { describe, expect, it } from "vitest";

import { formatTimecode } from "./formatTimecode";

describe("formatTimecode", () => {
  it("formats a plain duration", () => {
    expect(formatTimecode(90, 25)).toBe("00:01:30.00");
  });

  it("does not go negative internally when the input is negative", () => {
    expect(formatTimecode(-5, 25)).toBe("-00:00:05.00");
  });

  it("names the last field frames and derives it from fps, not hundredths", () => {
    expect(formatTimecode(0.5, 25)).toBe("00:00:00.13");
  });

  it("rounds a single exact quantity instead of subtracting floats", () => {
    // (90.05 - 90) * 100 is 4.999...; going through totalFrames avoids that entirely.
    expect(formatTimecode(90.05, 100)).toBe("00:01:30.05");
  });
});
