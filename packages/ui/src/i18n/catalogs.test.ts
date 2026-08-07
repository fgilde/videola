import { describe, expect, it } from "vitest";

import de from "./catalogs/de.json";
import en from "./catalogs/en.json";

describe("catalogs", () => {
  it("cover exactly the same keys in both languages", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty values", () => {
    for (const [key, value] of [...Object.entries(de), ...Object.entries(en)]) {
      expect(value, key).not.toBe("");
    }
  });
});
