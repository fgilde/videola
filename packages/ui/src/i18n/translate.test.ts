import { describe, expect, it } from "vitest";

import { translate } from "./translate";

const catalog = {
  "app.title": "Videola",
  "track.count": "{count} Spur | {count} Spuren",
  "clip.renamed": "{name} umbenannt",
};

describe("translate", () => {
  it("returns the plain string for a known key", () => {
    expect(translate(catalog, "app.title")).toBe("Videola");
  });

  it("returns the key itself when it is missing so gaps are visible", () => {
    expect(translate(catalog, "nope.missing")).toBe("nope.missing");
  });

  it("interpolates named variables", () => {
    expect(translate(catalog, "clip.renamed", { name: "Intro" })).toBe("Intro umbenannt");
  });

  it("leaves unknown placeholders untouched instead of printing undefined", () => {
    expect(translate(catalog, "clip.renamed", {})).toBe("{name} umbenannt");
  });

  it("picks the singular form for exactly one", () => {
    expect(translate(catalog, "track.count", { count: 1 })).toBe("1 Spur");
  });

  it("picks the plural form for anything else, zero included", () => {
    expect(translate(catalog, "track.count", { count: 0 })).toBe("0 Spuren");
    expect(translate(catalog, "track.count", { count: 5 })).toBe("5 Spuren");
  });
});
