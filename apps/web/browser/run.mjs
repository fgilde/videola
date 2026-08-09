import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const templateShot = join(here, "templates.png");
const effectShot = join(here, "effects.png");
const phoneShot = join(here, "phone.png");
const phoneLibraryShot = join(here, "phone-library.png");
const phoneInspectorShot = join(here, "phone-inspector.png");
const tabletShot = join(here, "tablet.png");
// Outside the repository: Chrome keeps the directory locked for a moment after it exits, and a
// half-deleted profile in a working tree is worse than one in the temp directory.
const profiles = join(tmpdir(), `videola-harness-${process.pid}`);
const PORT = Number(process.env.VIDEOLA_HARNESS_PORT ?? 4399);
const DEVTOOLS_PORT = PORT + 1;
// An iPhone 14 in portrait. It cannot be had from --window-size: Chrome on Windows refuses a
// window narrower than 500 CSS pixels and silently gives 500 instead, which is a small tablet
// and would have proven nothing about a phone. The device metrics override is the only way to
// ask for the viewport the layout is meant for -- and it brings the retina scale with it.
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
// An iPad in portrait: wide enough for the library and the timeline to be on screen together,
// which is what makes a drag between them possible, and narrow enough to be a tablet rather than
// a desktop. Same reason as the phone for going through the override rather than --window-size.
const TABLET = { width: 834, height: 1112, deviceScaleFactor: 2, mobile: true };

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  // The charset is spelled out because the driver matches German control labels by their text,
  // and a classic script inheriting the wrong encoding turns every umlaut into a miss.
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".mp4": "video/mp4",
};

function chrome() {
  // A set CHROME_PATH is an instruction, not a candidate: as one of the candidates a typo falls
  // through to some other Chrome, which in CI is one without the flags the wrapper adds.
  const wanted = process.env.CHROME_PATH;
  if (wanted !== undefined) {
    if (!existsSync(wanted)) throw new Error(`CHROME_PATH points at nothing: ${wanted}`);
    return wanted;
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (found === undefined) throw new Error("no Chrome found -- set CHROME_PATH to the executable");
  return found;
}

if (!existsSync(join(dist, "index.html"))) {
  throw new Error("no build to drive -- run `pnpm --filter videola-web build` first");
}

let deliver = () => undefined;
// The page decides what is worth a picture: only it knows when the library is open or the
// playhead is running. Node holds the devtools connection, so the request comes back out here.
let capture = async () => undefined;

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
  if (url === "/shot") {
    const name = new URL(req.url, "http://harness").searchParams.get("name") ?? "shot";
    void capture(name).then(() => send(res, Buffer.from("ok"), "text/plain"));
    return;
  }
  // Two containers of the same two seconds: a browser without proprietary codecs reads the WebM.
  if (url === "/fixture.mp4") return send(res, readFileSync(join(here, "fixture.mp4")), TYPES[".mp4"]);
  if (url === "/fixture.webm")
    return send(res, readFileSync(join(here, "fixture.webm")), "video/webm");
  if (url === "/second.mp4") return send(res, readFileSync(join(here, "second.mp4")), TYPES[".mp4"]);
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
    // Not `--enable-unsafe-swiftshader`: under it `VideoEncoder.isConfigSupported` never settles,
    // and the export asks it before deciding whether it can write sound. WebGL2 works under
    // `--disable-gpu` alone -- the compositor harness passes all of its pixel checks there too.
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
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
      // Long enough for the virtual clock to run out what is left of its budget and write the
      // screenshot. Chrome takes that picture when the budget expires, not when the run reports
      // back, and with nothing pending the remainder is consumed in a few milliseconds -- but half
      // a second of wall clock was nowhere near enough of them: an editor at rest still has timers
      // in it -- the instruments measure the picture ten times a virtual second -- and every one of
      // them is real work Chrome does on the way to the end of the budget, and the picture the guide is built
      // from simply went missing the first time a run grew.
      setTimeout(() => child.kill(), 20000);
      resolve(results);
    };
    const child = launch(url, extra);
  });
}

function reported(budgetMs, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the harness never reported back from ${what}`)), budgetMs);
    deliver = (results) => {
      clearTimeout(timer);
      resolve(results);
    };
  });
}

// The devtools protocol by hand over the WebSocket Node already has. Four commands is less than
// a browser-automation dependency costs, and the two things it buys cannot be had from the
// command line: a viewport smaller than a window may be, and a screenshot taken at a moment the
// harness chooses rather than when the page finished loading.
// The socket is opened the moment the page target appears, and on a loaded runner Chrome answers
// /json a little before it accepts a connection. One refusal is not an absent browser.
async function connectWithRetries(url, attempts = 10) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connect(url);
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const settle = pending.get(message.id);
    pending.delete(message.id);
    settle?.(message.result);
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`no devtools at ${url}`));
  });
  return {
    send: (method, params) =>
      new Promise((resolve) => {
        nextId += 1;
        pending.set(nextId, resolve);
        socket.send(JSON.stringify({ id: nextId, method, params }));
      }),
    close: () => socket.close(),
  };
}

async function pageTarget(deadline) {
  for (;;) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`)).json();
      const page = targets.find((target) => target.type === "page");
      if (page !== undefined) return page;
    } catch {
      // Chrome has not opened the port yet.
    }
    if (Date.now() > deadline) throw new Error("devtools never came up");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Wall clock, so the frame clock runs and playback really ticks -- and because layout under
// --virtual-time-budget lags behind the DOM: a dragged clip's inline style says it moved while
// its rect still says it did not, and every claim in these runs is about a rect.
//
// The viewport comes from the device metrics override and not from --window-size, which Chrome on
// Windows refuses to take below 500 CSS pixels: it clips the screenshot instead of scaling it, so
// a run asking for a phone would measure a small tablet and look entirely convincing doing it.
async function driveTouch(metrics, query, budgetMs, what) {
  const child = launch("about:blank", [
    "--window-size=1200,1200",
    `--remote-debugging-port=${DEVTOOLS_PORT}`,
  ]);
  try {
    const page = await pageTarget(Date.now() + 30_000);
    const devtools = await connectWithRetries(page.webSocketDebuggerUrl);
    await devtools.send("Emulation.setDeviceMetricsOverride", metrics);
    // Without this the editor still reports a fine pointer, and the timeline would hand a finger
    // the four-pixel trim zone it keeps for a mouse.
    await devtools.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    capture = async (name) => {
      const png = await devtools.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(here, `${name}.png`), Buffer.from(png.data, "base64"));
    };
    const results = reported(budgetMs, what);
    await devtools.send("Page.navigate", { url: `http://localhost:${PORT}/?${query}` });
    const out = await results;
    devtools.close();
    return out;
  } finally {
    child.kill();
  }
}

await new Promise((resolve) => server.listen(PORT, resolve));

try {
  const desktop = ["--window-size=1440,900"];
  // Wall clock: the frame clock runs, so playback can tick and the transport can be watched.
  const live = await drive(`http://localhost:${PORT}/`, desktop, 120_000);
  // Virtual clock: the frame clock is stopped, so the drawing buffer survives long enough to be
  // read back -- and the screenshot is taken once the budget runs out, which is after the run.
  // The one run whose picture is arranged rather than incidental: it grades a clip and turns the
  // instruments on, and the shot is taken while that is on screen.
  const drawn = await drive(
    `http://localhost:${PORT}/?virtual=1`,
    [...desktop, "--virtual-time-budget=300000", `--screenshot=${shot}`],
    300_000,
  );
  // The template run needs both halves the other two runs split between them: real decoding time
  // (so the fetch-driven clock) and a drawing buffer nobody has taken away (so virtual time). It is
  // its own launch because it starts from an untouched editor -- a gallery that replaces the
  // document has nothing to prove against a project the run before it already built.
  const baked = await drive(
    `http://localhost:${PORT}/?templates=1&virtual=1`,
    [...desktop, "--virtual-time-budget=300000", `--screenshot=${templateShot}`],
    300_000,
  );
  // The effect library, for the same reason the template run is its own launch: it opens on a fresh
  // editor, and the picture at the end of the budget has to be the shelf rather than whatever the
  // run before it left on screen.
  const shelved = await drive(
    `http://localhost:${PORT}/?effects=1&virtual=1`,
    [...desktop, "--virtual-time-budget=300000", `--screenshot=${effectShot}`],
    300_000,
  );
  const pocket = await driveTouch(PHONE, "phone=1", 180_000, "the phone");
  // The mode that had a layout rule and no run behind it. It is also the only viewport where a
  // drag from the library onto a track can be driven with a finger, because it is the only one
  // where both panels are on screen at the same time.
  const slate = await driveTouch(TABLET, "tablet=1", 180_000, "the tablet");
  const results = [...live, ...drawn, ...baked, ...shelved, ...pocket, ...slate];
  for (const note of results.filter((entry) => entry.name.startsWith("ENV "))) {
    console.log(note.name);
  }
  for (const result of results.filter((entry) => !entry.ok)) {
    console.error(
      `FAIL ${result.name}\n  got  ${JSON.stringify(result.got)}\n  want ${JSON.stringify(result.want)}`,
    );
  }
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`${results.length - failed}/${results.length} application checks passed`);
  for (const path of [shot, templateShot, effectShot, phoneShot, phoneLibraryShot, phoneInspectorShot, tabletShot]) {
    console.log(`screenshot: ${path}`);
  }
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  server.close();
  try {
    rmSync(profiles, { recursive: true, force: true });
  } catch {
    // Chrome may still hold it; the temp directory is the operating system's problem then.
  }
}
