import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function filesUnder(folder: string, ending: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return filesUnder(path, ending);
    return entry.name.endsWith(ending) ? [path] : [];
  });
}

const SHEETS = filesUnder(root, ".css");
// A component can set one as an inline style -- the preview's aspect is a number only it knows --
// so those count as definitions too.
const SOURCES = filesUnder(root, ".tsx");

/**
 * Every custom property a stylesheet reads has to be one some stylesheet writes.
 *
 * A `var(--v-space-5)` in a scale that goes 4, 8, 12, 16, 24 is not a smaller gap: it is a
 * declaration the browser throws away whole, so the rule loses its padding and nothing anywhere
 * says so. The about dialogue stood with its text against both edges for months on exactly that.
 */
describe("the custom properties the stylesheets read", () => {
  const defined = new Set<string>();
  for (const file of [...SHEETS, ...SOURCES]) {
    for (const [, name] of readFileSync(file, "utf8").matchAll(/(--[\w-]+)"?\s*:/g)) {
      if (name !== undefined) defined.add(name);
    }
  }

  it("are all defined by one of them", () => {
    const missing: string[] = [];
    for (const sheet of SHEETS) {
      const text = readFileSync(sheet, "utf8");
      // A fallback is the author saying "and if not, this": `var(--x, 4px)` stands on its own.
      for (const [, name, fallback] of text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
        if (name === undefined || fallback !== undefined || defined.has(name)) continue;
        missing.push(`${sheet.slice(root.length + 1)}: ${name}`);
      }
    }

    expect(missing).toEqual([]);
  });

  // The guard above is only worth having if it can tell the difference.
  it("would notice one that is not", () => {
    expect(defined.has("--v-space-4")).toBe(true);
    expect(defined.has("--v-space-5")).toBe(false);
  });
});
