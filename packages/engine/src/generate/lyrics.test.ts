import { describe, expect, it } from "vitest";

import { lineAt } from "./generator";
import { lyricKnobs, lyricOptions, LYRIC_STYLES } from "./lyrics";

import type { Clip, Project, Track } from "@videola/core";

const SECOND = 705_600_000;

function song(lines: [number, number, string][]): Project {
  const clips = lines.map(([from, to, text], index) => ({
    id: `clp_${index}`,
    source: { kind: "generator", generator: { type: "text", content: text, style: {} } },
    start: from * SECOND,
    duration: (to - from) * SECOND,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {},
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
  })) as unknown as Clip[];
  const track = {
    id: "trk_lyrics",
    kind: "caption",
    name: "C1",
    hidden: false,
    muted: false,
    solo: false,
    locked: false,
    volume: 1,
    pan: 0,
    clips,
    effects: [],
  } as unknown as Track;
  return {
    schemaVersion: 1,
    meta: { id: "prj_1", title: "", tags: [] },
    settings: {
      width: 1920,
      height: 1080,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: 48000,
      colorSpace: "srgb",
      background: "#000000",
    },
    library: [],
    timeline: { tracks: [track] },
    markers: [],
    master: { volume: 1, effects: [] },
  } as unknown as Project;
}

describe("which line is being sung", () => {
  const project = song([
    [1, 3, "Standing in the hall of fame"],
    [3, 5, "And the world's gonna know your name"],
  ]);

  it("is the line the playhead is inside", () => {
    expect(lineAt(project, 1.5 * SECOND)?.text).toBe("Standing in the hall of fame");
    expect(lineAt(project, 4 * SECOND)?.text).toBe("And the world's gonna know your name");
  });

  // Nothing between the lines: a lyric video that holds the last line through an instrumental is a
  // lyric video with a stuck picture.
  it("is nothing at all before the first line and after the last", () => {
    expect(lineAt(project, 0)).toBeUndefined();
    expect(lineAt(project, 6 * SECOND)).toBeUndefined();
  });

  it("says how far through the line the singing is", () => {
    expect(lineAt(project, 1 * SECOND)?.progress).toBe(0);
    expect(lineAt(project, 2 * SECOND)?.progress).toBeCloseTo(0.5, 5);
  });

  // The styles that flip a background need to know which line this is, and the ones that show what
  // is coming need the next.
  it("carries the line's number and the one after it", () => {
    expect(lineAt(project, 1.5 * SECOND)?.index).toBe(0);
    expect(lineAt(project, 1.5 * SECOND)?.next).toBe("And the world's gonna know your name");
    expect(lineAt(project, 4 * SECOND)?.next).toBeUndefined();
  });
});

describe("what a lyric style was asked for", () => {
  it("falls back to the kinetic one for a style nobody has heard of", () => {
    expect(lyricOptions("hologram", {}).style).toBe("kinetic");
    for (const style of LYRIC_STYLES) expect(lyricOptions(style, {}).style).toBe(style);
  });

  it("holds the numbers to something a frame can hold", () => {
    const wild = lyricOptions("bar", { size: 40, weight: 9000 });

    expect(wild.size).toBe(0.4);
    expect(wild.weight).toBe(900);
  });

  it("has no background unless it is given one", () => {
    expect(lyricOptions("karaoke", {}).background).toBeUndefined();
    expect(lyricOptions("kinetic", { background: "#050609" }).background).toBe("#050609");
  });

  it("takes a position it knows and ignores one it does not", () => {
    expect(lyricOptions("bar", { position: "top" }).position).toBe("top");
    expect(lyricOptions("bar", { position: "sideways" }).position).toBe("middle");
  });

  it("holds the three new knobs between nothing and everything", () => {
    const wild = lyricOptions("grow", { intensity: 12, glow: -4, tilt: 0.25 });

    expect([wild.intensity, wild.glow, wild.tilt]).toEqual([1, 0, 0.25]);
  });

  // A slider for a setting the style ignores teaches somebody that the settings do nothing, so
  // every style says which of the four it answers to -- and every style answers to at least one.
  it("says which knobs each style answers to", () => {
    for (const style of LYRIC_STYLES) {
      const knobs = lyricKnobs(style);
      expect(knobs.length).toBeGreaterThan(0);
      expect(knobs).toContain("size");
    }
    expect(lyricKnobs("grow")).toContain("tilt");
    expect(lyricKnobs("karaoke")).not.toContain("tilt");
    // A style nobody has heard of is drawn kinetic, so it is asked the kinetic questions.
    expect(lyricKnobs("hologram")).toEqual(lyricKnobs("kinetic"));
  });
});
