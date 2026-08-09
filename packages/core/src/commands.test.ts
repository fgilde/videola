import { describe, expect, it } from "vitest";

import { cmd, on, secondsToTime, timeToSeconds } from "./commands";
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

  it("clears a transition with an explicit null rather than omitting the field", () => {
    expect(cmd.clipSetTransition("clp_1", null)).toEqual({
      type: "clip.setTransition",
      clip: "clp_1",
      transition: null,
    });
  });

  it("keyframes linearly unless told otherwise", () => {
    const command = cmd.keyframeAdd(on.clip("clp_1"), "brightness", "amount", 0, {
      kind: "float",
      value: 0.5,
    });
    expect(command).toEqual({
      type: "keyframe.add",
      target: { kind: "clip", clip: "clp_1" },
      effectType: "brightness",
      key: "amount",
      time: 0,
      value: { kind: "float", value: 0.5 },
      interp: "linear",
    });
  });

  // The type checker already guarantees the field *names*; what a runtime test can still catch is
  // two arguments landing in each other's field, which is why these pass values that cannot be
  // mistaken for one another.
  it("puts every argument of an edit command in its own field", () => {
    expect(cmd.clipRippleTrim("clp_1", "end", 7)).toEqual({
      type: "clip.rippleTrim",
      clip: "clp_1",
      edge: "end",
      delta: 7,
    });
    expect(cmd.clipRoll("clp_1", "start", -7)).toEqual({
      type: "clip.roll",
      clip: "clp_1",
      edge: "start",
      delta: -7,
    });
    expect(cmd.clipSlip("clp_1", 3)).toEqual({ type: "clip.slip", clip: "clp_1", delta: 3 });
    expect(cmd.clipSlide("clp_1", 3)).toEqual({ type: "clip.slide", clip: "clp_1", delta: 3 });
    expect(cmd.markerAdd(9, "chapter")).toEqual({ type: "marker.add", time: 9, label: "chapter" });
    expect(cmd.markerRename("mrk_1", "chapter")).toEqual({
      type: "marker.rename",
      marker: "mrk_1",
      label: "chapter",
    });
    expect(cmd.markerSetColor("mrk_1", "#2EA043")).toEqual({
      type: "marker.setColor",
      marker: "mrk_1",
      colorHex: "#2EA043",
    });
    expect(cmd.markerSetNote("mrk_1", "take 3")).toEqual({
      type: "marker.setNote",
      marker: "mrk_1",
      note: "take 3",
    });
  });

  // Four numbers that cannot be mistaken for one another: a three-point edit carries a source in
  // point, a length and a place on the timeline, and an argument in the wrong field is a cut
  // nobody marked.
  it("keeps the source range and the timeline position apart in a three-point edit", () => {
    const source = { kind: "media", media: "med_a" } as const;
    expect(cmd.clipInsert("trk_1", source, 100, 50, 900)).toEqual({
      type: "clip.insert",
      track: "trk_1",
      source,
      start: 100,
      duration: 50,
      inPoint: 900,
    });
    expect(cmd.clipOverwrite("trk_1", source, 100, 50, 900)).toEqual({
      type: "clip.overwrite",
      track: "trk_1",
      source,
      start: 100,
      duration: 50,
      inPoint: 900,
    });
  });

  // The head of the medium is what "nothing marked" means, and it has to travel as an explicit
  // zero rather than as a field the core would have to guess at.
  it("defaults the in point of a three-point edit to the head of the medium", () => {
    expect(cmd.clipInsert("trk_1", { kind: "media", media: "med_a" }, 0, 50).inPoint).toBe(0);
  });

  // A copied clip must reach the core whole -- the core is what mints new ids and refuses a
  // payload it could not load back.
  it("carries the whole clip in a paste and takes the start from the argument", () => {
    const clip = { id: "clp_1", start: 100, duration: 50 } as unknown as Parameters<
      typeof cmd.clipPaste
    >[1];
    const command = cmd.clipPaste("trk_1", clip, 900);
    expect(command).toEqual({ type: "clip.paste", track: "trk_1", clip, start: 900 });
  });

  // Copied, not aliased: the caller's array is often the live selection, which changes while the
  // command is still on its way through the queue.
  it("copies the clip list of a group", () => {
    const selection = ["clp_1", "clp_2"];
    const command = cmd.clipGroup(selection);
    selection.push("clp_3");
    expect(command.clips).toEqual(["clp_1", "clp_2"]);
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
