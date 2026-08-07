import { describe, expect, it } from "vitest";

import { cmd, FLICKS_PER_SECOND, framesToTime, secondsToTime, timeToSeconds } from "./commands";
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

  it("has a factory for every Command variant the WASM layer can reach from JS", () => {
    // media.import is not reachable from JS by design: the WASM layer derives the
    // media id from a content hash of the bytes, so a caller can never supply one.
    const unreachableFromJs = new Set(["media.import"]);
    const expectedTypes = new Set(
      COMMAND_LABELS.map((label) => label.replace(/^cmd\./, "")).filter(
        (type) => !unreachableFromJs.has(type),
      ),
    );

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

  it("stays inside the safe integer range for a four hour timeline", () => {
    expect(secondsToTime(4 * 3600)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("converts a frame number to flicks using a fps rate", () => {
    expect(framesToTime(1, { numerator: 25, denominator: 1 })).toBe(FLICKS_PER_SECOND / 25);
  });

  it("rounds a non-integral frame rate to an integer flick time", () => {
    const ntsc30 = { numerator: 30000, denominator: 1001 };
    expect(Number.isInteger(framesToTime(1, ntsc30))).toBe(true);
  });
});
