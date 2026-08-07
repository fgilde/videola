import { describe, expect, it } from "vitest";

import { cmd, secondsToTime, timeToSeconds } from "./commands";
import type { Command } from "./generated";
import { COMMAND_LABELS } from "./generated";

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

  it("has a factory for every Command variant", () => {
    const expectedTypes = new Set(COMMAND_LABELS.map((label) => label.replace(/^cmd\./, "")));

    const factories = Object.values(cmd) as ((...args: unknown[]) => Command)[];
    const coveredTypes = new Set(factories.map((factory) => factory("x", "x", "x", "x", "x").type));

    expect(coveredTypes).toEqual(expectedTypes);
  });
});

describe("time conversion", () => {
  it("round-trips whole and fractional seconds", () => {
    for (const seconds of [0, 1, 2.5, 0.04166666]) {
      expect(timeToSeconds(secondsToTime(seconds))).toBeCloseTo(seconds, 6);
    }
  });

  // The bound that actually matters: Time::MAX_REASONABLE on the Rust side caps a project at
  // 24 hours (crates/videola-core/src/model/time.rs), so that is the longest timeline this
  // conversion ever has to survive without losing precision to a float round-trip.
  it("stays inside the safe integer range up to the longest timeline the core accepts", () => {
    expect(secondsToTime(24 * 3600)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
