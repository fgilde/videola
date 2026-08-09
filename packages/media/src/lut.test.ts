import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createWasmBackend, VideolaDocument } from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";
import { describe, expect, it } from "vitest";

import { installFakeOpfs } from "./fake-opfs";
import { contentHash } from "./hash";
import { LUT_MIME, MAX_LUT_SIZE, importLut, parseCube } from "./lut";
import { getMedia } from "./opfs";

// The same priming the other tests here do: the glue loads itself through fetch(), which Node
// does not implement for file:// URLs.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "../../core/src/wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

// A cube whose entries say where they are: red is the red axis, and so on. Red runs fastest,
// which is the one ordering rule the format has and the one a wrong loop reverses silently.
function identityCube(size: number): string {
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const at = (v: number): string => (v / (size - 1)).toFixed(6);
        lines.push(`${at(r)} ${at(g)} ${at(b)}`);
      }
    }
  }
  return lines.join("\n");
}

function texel(table: { size: number; rgba: Uint8Array }, r: number, g: number, b: number): number[] {
  const at = ((b * table.size + g) * table.size + r) * 4;
  return [...table.rgba.slice(at, at + 4)];
}

describe("parseCube", () => {
  it("reads the size and one texel per grid point", () => {
    const table = parseCube(identityCube(3));
    expect(table.size).toBe(3);
    expect(table.rgba.length).toBe(3 * 3 * 3 * 4);
  });

  // The whole of what "red varies fastest" means, measured rather than assumed: the second entry
  // of the file is one step along red, not one step along blue.
  it("lays the grid out with red varying fastest", () => {
    const table = parseCube(identityCube(3));
    expect(texel(table, 2, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(texel(table, 0, 0, 2)).toEqual([0, 0, 255, 255]);
    expect(texel(table, 0, 2, 0)).toEqual([0, 255, 0, 255]);
  });

  it("keeps a table that maps red to blue", () => {
    const table = parseCube(["LUT_3D_SIZE 2", ...swapRows()].join("\n"));
    expect(texel(table, 1, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(texel(table, 0, 0, 1)).toEqual([255, 0, 0, 255]);
  });

  it("ignores the title, comments and blank lines", () => {
    const text = [
      "# a comment",
      'TITLE "Some Look"',
      "",
      "LUT_3D_SIZE 2",
      "DOMAIN_MIN 0.0 0.0 0.0",
      "DOMAIN_MAX 1.0 1.0 1.0",
      ...swapRows(),
    ].join("\r\n");
    expect(parseCube(text).size).toBe(2);
  });

  // Ours, not the texture's: a float table handed to the driver would be clamped by the RGBA8
  // target anyway, and a test that only measured that would pass with no clamp here at all.
  it("clamps values outside the unit range", () => {
    const rows = ["-4 0 0", "0 0 0", "0 0 0", "0 0 0", "0 0 0", "0 0 0", "0 0 0", "9 9 9"];
    const table = parseCube(["LUT_3D_SIZE 2", ...rows].join("\n"));
    expect(texel(table, 0, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(texel(table, 1, 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it("refuses a file with no size line", () => {
    expect(() => parseCube(swapRows().join("\n"))).toThrow("error.lutInvalid");
  });

  it("refuses a size outside the supported range", () => {
    expect(() => parseCube("LUT_3D_SIZE 1\n0 0 0")).toThrow("error.lutInvalid");
    expect(() => parseCube(`LUT_3D_SIZE ${MAX_LUT_SIZE + 1}\n0 0 0`)).toThrow("error.lutInvalid");
    expect(() => parseCube("LUT_3D_SIZE 2.5\n0 0 0")).toThrow("error.lutInvalid");
  });

  // Both directions. A short file left the tail of the table at zero, which is a black clip, and a
  // long one is a file that means something other than what its header says.
  it("refuses a row count that does not match the size", () => {
    expect(() => parseCube(["LUT_3D_SIZE 2", ...swapRows().slice(1)].join("\n"))).toThrow(
      "error.lutInvalid",
    );
    expect(() => parseCube(["LUT_3D_SIZE 2", ...swapRows(), "0 0 0"].join("\n"))).toThrow(
      "error.lutInvalid",
    );
  });

  it("refuses a row that is not three numbers", () => {
    const rows = [...swapRows()];
    rows[3] = "0 0";
    expect(() => parseCube(["LUT_3D_SIZE 2", ...rows].join("\n"))).toThrow("error.lutInvalid");
    rows[3] = "0 0 nought";
    expect(() => parseCube(["LUT_3D_SIZE 2", ...rows].join("\n"))).toThrow("error.lutInvalid");
    rows[3] = "0 0 NaN";
    expect(() => parseCube(["LUT_3D_SIZE 2", ...rows].join("\n"))).toThrow("error.lutInvalid");
  });

  // Accepted silently, the grade would be applied to the wrong input range -- a quiet wrong
  // picture rather than a refusal anybody can act on.
  it("refuses a domain other than nought to one", () => {
    const text = ["LUT_3D_SIZE 2", "DOMAIN_MAX 4.0 4.0 4.0", ...swapRows()].join("\n");
    expect(() => parseCube(text)).toThrow("error.lutInvalid");
  });

  // A tone curve, which this editor already has a whole effect for. Refused by name so the
  // message can say so rather than reporting a missing 3D size.
  it("refuses a one-dimensional table", () => {
    expect(() => parseCube("LUT_1D_SIZE 4\n0 0 0\n0 0 0\n0 0 0\n1 1 1")).toThrow("error.lutInvalid");
  });

  it("refuses a file too large to be a lookup table", () => {
    expect(() => parseCube("#".repeat(40_000_000))).toThrow("error.lutInvalid");
  });

  it("names a mime type of its own", () => {
    expect(LUT_MIME).toBe("application/x-cube-lut");
  });
});

describe("importLut", () => {
  const text = ["LUT_3D_SIZE 2", ...swapRows()].join("\n");
  const cubeFile = (): File => new File([text], "Swap.cube", { type: "" });

  it("stores the bytes under their hash and names the table to the library", async () => {
    installFakeOpfs();
    const doc = new VideolaDocument(await createWasmBackend());
    const file = cubeFile();

    const id = await importLut(file, doc);

    expect(id).toBe(`med_${await contentHash(file)}`);
    const asset = doc.state.library.find((entry) => entry.id === id);
    expect(asset?.kind).toBe("lut");
    expect(asset?.mime).toBe(LUT_MIME);
    expect(asset?.originalName).toBe("Swap.cube");
    // Under the hash and nowhere else, so the `.videola` writer and the export worker find it the
    // way they find every other medium.
    expect(await getMedia(id.slice("med_".length))).toBeDefined();
  });

  // The tile-without-a-table failure, one level up: a library entry the grade cannot draw is a
  // promise nothing covers, so the parse happens before anything is written down.
  it("refuses a file that is not a lookup table, and stores nothing", async () => {
    installFakeOpfs();
    const doc = new VideolaDocument(await createWasmBackend());
    const broken = new File(["LUT_3D_SIZE 2\n0 0 0"], "broken.cube", { type: "" });

    await expect(importLut(broken, doc)).rejects.toThrow("error.lutInvalid");

    expect(doc.state.library).toHaveLength(0);
    expect(await getMedia(await contentHash(broken))).toBeUndefined();
  });
});

// Red and blue traded, at the smallest size the format allows. Eight rows, red fastest.
function swapRows(): string[] {
  return [
    "0 0 0",
    "0 0 1",
    "0 1 0",
    "0 1 1",
    "1 0 0",
    "1 0 1",
    "1 1 0",
    "1 1 1",
  ];
}
