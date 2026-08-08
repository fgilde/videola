import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

// The timeline's claims are about boxes: 44 px targets, hit areas that reach a clip's outer edge,
// a window that keeps the DOM small at every zoom, a scroll container as wide as the project.
// jsdom computes none of that -- every rect is zero and every stylesheet is inert. This runs the
// same component in Chrome and asks the layout engine. Same shape as packages/engine/gpu.
const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "bundle.js");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function chrome() {
  const found = CHROME_CANDIDATES.find((path) => path !== undefined && existsSync(path));
  if (found === undefined) {
    throw new Error("no Chrome found -- set CHROME_PATH to the executable");
  }
  return found;
}

// --virtual-time-budget alone does not make requestAnimationFrame fire under --dump-dom, so the
// harness must never wait for a frame. Everything below is synchronous on purpose.
function runHarness() {
  const dom = execFileSync(
    chrome(),
    [
      "--headless",
      "--disable-gpu",
      "--window-size=1200,900",
      "--force-device-scale-factor=1",
      "--virtual-time-budget=20000",
      "--dump-dom",
      `file:///${join(here, "harness.html").replaceAll("\\", "/")}`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const body = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom)?.[1];
  if (body === undefined) throw new Error(`no results in the page:\n${dom.slice(0, 2000)}`);
  if (body.trim() === "pending") throw new Error("the harness never finished");
  return JSON.parse(unescapeHtml(body));
}

function unescapeHtml(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

await esbuild.build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "iife",
  globalName: "T",
  outfile: bundle,
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".png": "dataurl", ".wasm": "file" },
  // @videola/core re-exports the wasm glue, whose import.meta.url only runs inside init() -- and
  // the harness never loads a document. Bundling it is cheaper than a second entry point.
  logOverride: { "empty-import-meta": "silent" },
});

try {
  const results = runHarness();
  const failed = results.filter((result) => !result.ok);
  for (const result of failed) {
    console.error(
      `FAIL ${result.name}\n  got  ${JSON.stringify(result.got)}\n  want ${JSON.stringify(result.want)}`,
    );
  }
  console.log(`${results.length - failed.length}/${results.length} browser checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  rmSync(bundle, { force: true });
  rmSync(join(here, "bundle.css"), { force: true });
}
