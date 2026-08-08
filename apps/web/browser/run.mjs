import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The built application, in a real browser, with a real file dropped on it. Everything the
// preview and the transport rest on -- OPFS, WebCodecs, WebGL2, Web Audio -- is absent from
// jsdom, so this is the only place the chain from a dropped file to a decoded frame is checked.
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const shot = join(here, "preview.png");
// Outside the repository: Chrome keeps the directory locked for a moment after it exits, and a
// half-deleted profile in a working tree is worse than one in the temp directory.
const profiles = join(tmpdir(), `videola-harness-${process.pid}`);
const PORT = Number(process.env.VIDEOLA_HARNESS_PORT ?? 4399);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".mp4": "video/mp4",
};

function chrome() {
  const found = CHROME_CANDIDATES.find((path) => path !== undefined && existsSync(path));
  if (found === undefined) throw new Error("no Chrome found -- set CHROME_PATH to the executable");
  return found;
}

if (!existsSync(join(dist, "index.html"))) {
  throw new Error("no build to drive -- run `pnpm --filter videola-web build` first");
}

let deliver = () => undefined;

const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  // The harness clock. Under --virtual-time-budget a timer in the page fires with no real time
  // passing at all; a pending fetch is what makes Chrome hold virtual time still while a decoder
  // actually does its work.
  if (url === "/wait") {
    const ms = Number(new URL(req.url, "http://harness").searchParams.get("ms") ?? 100);
    setTimeout(() => send(res, Buffer.from("ok"), "text/plain"), ms);
    return;
  }
  if (url === "/results") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      send(res, Buffer.from("ok"), "text/plain");
      deliver(JSON.parse(body));
    });
    return;
  }
  if (url === "/fixture.mp4") return send(res, readFileSync(join(here, "fixture.mp4")), TYPES[".mp4"]);
  if (url === "/driver.js") return send(res, readFileSync(join(here, "driver.js")), TYPES[".js"]);
  const path = join(dist, url === "/" ? "index.html" : decodeURIComponent(url));
  if (!existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404).end("no");
    return;
  }
  if (path.endsWith("index.html")) {
    const html = readFileSync(path, "utf8").replace(
      "</body>",
      '<script src="/driver.js"></script></body>',
    );
    return send(res, Buffer.from(html), TYPES[".html"]);
  }
  send(res, readFileSync(path), TYPES[extname(path)] ?? "application/octet-stream");
});

function send(res, body, type) {
  res.writeHead(200, { "content-type": type });
  res.end(body);
}

// The click that starts playback is a real user gesture in a real browser; headless has no user
// to make one, and a suspended AudioContext would never resume. Nothing else here is relaxed.
function launch(url, extra) {
  return execFile(chrome(), [
    "--headless",
    "--disable-gpu",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1440,900",
    "--force-device-scale-factor=1",
    `--user-data-dir=${join(profiles, String(Math.random()).slice(2))}`,
    ...extra,
    url,
  ]);
}

function drive(url, extra, budgetMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the harness never reported back from ${url}`));
    }, budgetMs);
    deliver = (results) => {
      clearTimeout(timer);
      setTimeout(() => child.kill(), 500);
      resolve(results);
    };
    const child = launch(url, extra);
  });
}

await new Promise((resolve) => server.listen(PORT, resolve));

try {
  // Wall clock: the frame clock runs, so playback can tick and the transport can be watched.
  const live = await drive(`http://localhost:${PORT}/`, [], 120_000);
  // Virtual clock: the frame clock is stopped, so the drawing buffer survives long enough to be
  // read back -- and the screenshot is taken once the budget runs out, which is after the run.
  const drawn = await drive(
    `http://localhost:${PORT}/?virtual=1`,
    ["--virtual-time-budget=300000", `--screenshot=${shot}`],
    300_000,
  );
  const results = [...live, ...drawn];
  for (const result of results.filter((entry) => !entry.ok)) {
    console.error(
      `FAIL ${result.name}\n  got  ${JSON.stringify(result.got)}\n  want ${JSON.stringify(result.want)}`,
    );
  }
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`${results.length - failed}/${results.length} application checks passed`);
  console.log(`screenshot: ${shot}`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  server.close();
  try {
    rmSync(profiles, { recursive: true, force: true });
  } catch {
    // Chrome may still hold it; the temp directory is the operating system's problem then.
  }
}
