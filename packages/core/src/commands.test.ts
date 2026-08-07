import { describe, expect, it } from "vitest";

import { cmd, secondsToTime, timeToSeconds } from "./index";

describe("command factories", () => {
  it("emits the wire format the Rust core expects", () => {
    expect(cmd.trackAdd("video", "V1")).toEqual({
      type: "track.add",
      kind: "video",
      name: "V1",
      index: null,
    });
  });

  it("passes an explicit index through", () => {
    expect(cmd.trackAdd("audio", "A1", 0).index).toBe(0);
  });

  it("builds clip splits with integer flick times", () => {
    const command = cmd.clipSplit("clp_1", secondsToTime(1.5));
    expect(command).toEqual({ type: "clip.split", clip: "clp_1", at: 1058400000 });
    expect(Number.isInteger(command.at)).toBe(true);
  });
});

describe("time conversion", () => {
  it("round-trips whole and fractional seconds", () => {
    for (const seconds of [0, 1, 2.5, 0.04166666]) {
      expect(timeToSeconds(secondsToTime(seconds))).toBeCloseTo(seconds, 6);
    }
  });

  it("stays inside the safe integer range for a four hour timeline", () => {
    expect(secondsToTime(4 * 3600)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
