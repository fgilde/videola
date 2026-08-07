import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cmd } from "./commands";
import { VideolaDocument } from "./document";
import { createWasmBackend } from "./wasm-backend";
import { initSync } from "./wasm/videola_core.js";

// Needs the real build in packages/core/src/wasm (gitignored - run `pnpm wasm` first). Every
// other test in this package dispatches against the fake backend from document.test.ts /
// commands.test.ts; this is the one test that goes through the actual Rust core.
//
// createWasmBackend() loads the module via fetch(new URL(...)), which Node's undici does not
// implement for file:// URLs. initSync populates the glue module's internal instance directly
// from disk first, so the later fetch-based init() call in createWasmBackend() short-circuits
// on its own "already initialized" guard instead of ever calling fetch.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

describe("save and reopen through the real WASM backend", () => {
  it("keeps a track across a save and reopen", async () => {
    const doc = new VideolaDocument(await createWasmBackend());
    doc.dispatch(cmd.trackAdd("video", "V1"));

    const bytes = doc.save({
      appVersion: "0.0.0-test",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      locale: "de",
      slim: true,
    });

    const reopened = new VideolaDocument(await createWasmBackend(bytes));
    expect(reopened.state.timeline.tracks).toHaveLength(1);
    expect(reopened.state.timeline.tracks[0]?.name).toBe("V1");
  });
});
