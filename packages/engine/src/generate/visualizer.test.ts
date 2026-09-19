import { describe, expect, it } from "vitest";

import { visualizerOptions, VISUALIZER_STYLES } from "./visualizer";

describe("what a visualiser was asked for", () => {
  it("falls back to bars for a style this version has never heard of", () => {
    expect(visualizerOptions("hologram", {}).style).toBe("bars");
    for (const style of VISUALIZER_STYLES) {
      expect(visualizerOptions(style, {}).style).toBe(style);
    }
  });

  // A project written by hand, or by a later version, can carry anything at all. None of it may
  // reach the canvas: a bar count of nine million is a frame that never finishes.
  it("holds every number to a range a picture can be drawn in", () => {
    const wild = visualizerOptions("bars", {
      bars: 9_000_000,
      sensitivity: -4,
      glow: 12,
      punch: Number.NaN,
      rotate: 1e30,
    });

    expect(wild.bars).toBe(160);
    expect(wild.sensitivity).toBe(0.1);
    expect(wild.glow).toBe(1);
    expect(wild.punch).toBe(0.5);
    expect(wild.rotate).toBe(4);
  });

  it("takes a named palette, and two colours over a name", () => {
    expect(visualizerOptions("bars", { palette: "ember" }).palette[0]).toBe("#ff2e00");
    expect(visualizerOptions("bars", { palette: "nothing-like-it" }).palette.length).toBeGreaterThan(1);
    expect(visualizerOptions("bars", { color: "#ff0000", colorTo: "#00ff00" }).palette).toEqual([
      "#ff0000",
      "#00ff00",
    ]);
  });

  // Transparent unless something says otherwise: a visualiser is a layer over an edit far more
  // often than it is the whole picture.
  it("has no background of its own until it is given one", () => {
    expect(visualizerOptions("bars", {}).background).toBeUndefined();
    expect(visualizerOptions("bars", { background: "#000000" }).background).toBe("#000000");
  });

  it("keeps the two switches on unless they are turned off", () => {
    expect(visualizerOptions("bars", {}).cap).toBe(true);
    expect(visualizerOptions("bars", { cap: false }).cap).toBe(false);
    expect(visualizerOptions("wave", { fill: false }).fill).toBe(false);
  });
});
