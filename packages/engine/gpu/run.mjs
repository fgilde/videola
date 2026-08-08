import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

// The compositor's claims are about pixels, and only a driver produces those. jsdom has no WebGL2
// at all, so everything below the draw list is unproven until this runs. SwiftShader makes it a
// software rasteriser -- slow, deterministic, and present wherever Chrome is, which includes the
// CI runners. Task 24 wires this into the workflow; until then it is one command.
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

// --dump-dom is the whole reason this needs no Playwright: Chrome renders the page, waits out the
// virtual clock, and prints the DOM it ended up with.
function runHarness() {
  const dom = execFileSync(
    chrome(),
    [
      "--headless",
      "--enable-unsafe-swiftshader",
      "--disable-gpu-sandbox",
      "--virtual-time-budget=20000",
      "--dump-dom",
      `file:///${join(here, "harness.html").replaceAll("\\", "/")}`,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
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
  globalName: "R",
  outfile: bundle,
  target: "es2022",
});

try {
  const results = runHarness();
  const failed = results.filter((result) => !result.ok);
  for (const result of failed) {
    console.error(`FAIL ${result.name}\n  got  ${JSON.stringify(result.got)}\n  want ${JSON.stringify(result.want)}`);
  }
  console.log(`${results.length - failed.length}/${results.length} GPU checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  rmSync(bundle, { force: true });
}
