import { describe, expect, it } from "vitest";

import { COMMAND_LABELS } from "@videola/core/src/generated/commandLabels";

import de from "./catalogs/de.json";
import en from "./catalogs/en.json";
import { PLACEHOLDER_PATTERN } from "./translate";

type CatalogKey = keyof typeof de;

describe("catalogs", () => {
  it("cover exactly the same keys in both languages", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty values", () => {
    for (const [key, value] of [...Object.entries(de), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(de) as CatalogKey[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(de[key]));
    }
  });

  it("use a plural form in both languages or neither", () => {
    for (const key of Object.keys(de) as CatalogKey[]) {
      expect(hasPluralForm(en[key]), key).toBe(hasPluralForm(de[key]));
    }
  });

  it("carry a translation for every command label the core can emit", () => {
    for (const label of COMMAND_LABELS) {
      expect(label in de, label).toBe(true);
      expect(label in en, label).toBe(true);
    }
  });
});

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

function hasPluralForm(template: string): boolean {
  return template.includes(" | ");
}
