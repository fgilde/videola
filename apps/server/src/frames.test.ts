import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { chromePath, renderStills, rendererPath, RenderError } from "./frames";

const KEYS = ["CHROME_PATH", "VIDEOLA_RENDERER"] as const;
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function profiles(): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter((entry) => entry.startsWith("videola-render-")).length;
}

const JOB = { archive: new Uint8Array([1, 2, 3]), times: [0], width: 32, height: 18 };

describe("finding a browser to render in", () => {
  it("takes CHROME_PATH as an instruction, not as a candidate", () => {
    process.env["CHROME_PATH"] = "/nowhere/chrome";

    expect(() => chromePath()).toThrow(/points at nothing/);
  });

  it("names the missing thing rather than failing later on a blank picture", () => {
    process.env["CHROME_PATH"] = "/nowhere/chrome";

    try {
      chromePath();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).code).toBe("rendererUnavailable");
    }
  });
});

describe("the renderer bundle", () => {
  it("is looked for beside the sources or the bundle, and VIDEOLA_RENDERER overrides that", () => {
    expect(rendererPath()).toMatch(/renderer[\\/]bundle\.js$/);

    process.env["VIDEOLA_RENDERER"] = "/somewhere/else.js";

    expect(rendererPath()).toBe("/somewhere/else.js");
  });

  // A profile directory created before the checks would leave one behind on every call that never
  // had anywhere to render, and the same ordering mistake elsewhere in this server created
  // directories outside the storage root.
  it("is checked before a browser profile is created", async () => {
    process.env["VIDEOLA_RENDERER"] = "/nowhere/bundle.js";
    const before = await profiles();

    await expect(renderStills(JOB)).rejects.toMatchObject({ code: "rendererUnavailable" });
    expect(await profiles()).toBe(before);
  });

  it("and before a browser is looked for, so the first answer names the first missing thing", async () => {
    process.env["VIDEOLA_RENDERER"] = "/nowhere/bundle.js";
    process.env["CHROME_PATH"] = "/nowhere/chrome";

    await expect(renderStills(JOB)).rejects.toThrow(/no renderer bundle/);
  });
});
