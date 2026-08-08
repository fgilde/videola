import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

// The export's promise is a file, and only a file proves it. jsdom has no encoder, no worker with
// WebCodecs in it and no OPFS, so everything from the compositor's canvas to the muxed bytes is
// unproven until this runs. What comes out is then handed to ffmpeg, which shares no code with
// anything in this repository.
//
// Three differences from the compositor harness, each measured rather than assumed:
//   http instead of file://, because OPFS never settles on an opaque origin;
//   `--disable-gpu` instead of `--enable-unsafe-swiftshader`, because under the latter
//     `VideoEncoder.isConfigSupported` never settles while WebGL2 works under both -- the
//     compositor harness passes 66/66 under these flags too;
//   the page posts its results back instead of being read out of a DOM dump, because
//     `--virtual-time-budget` runs the clock faster than the encoders answer on their own threads.
const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(here, "..", "..", "core", "src", "wasm");
const artefacts = [join(here, "bundle.js"), join(here, "worker.js")];
const RUN_TIMEOUT_MS = 300_000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

function chrome() {
  const found = CHROME_CANDIDATES.find((path) => path !== undefined && existsSync(path));
  if (found === undefined) throw new Error("no Chrome found -- set CHROME_PATH to the executable");
  return found;
}

function body(request) {
  return new Promise((resolve, reject) => {
    const parts = [];
    request.on("data", (chunk) => parts.push(chunk));
    request.on("end", () => resolve(Buffer.concat(parts)));
    request.on("error", reject);
  });
}

function serve() {
  const state = { file: null };
  let deliver = () => undefined;
  const reported = new Promise((resolve) => {
    deliver = resolve;
  });

  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (request.method === "POST") {
      void body(request).then((bytes) => {
        if (path === "/file") state.file = bytes;
        else deliver(JSON.parse(bytes.toString("utf8")));
        response.writeHead(204).end();
      });
      return;
    }
    const name = path.replace(/^\//, "");
    const file = name.endsWith(".wasm") ? join(wasmDir, name) : join(here, name);
    if (!existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, state, reported, port: server.address().port }),
    );
  });
}

// ffmpeg is the independent reader. If it decodes the frames and agrees on the numbers, the file
// is a file and not merely something our own demuxer recognises.
function inspect(path) {
  const probed = JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], {
      encoding: "utf8",
    }),
  );
  const decoded = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { probed, decoded };
}

// ffmpeg decodes the sound back to raw floats and a Goertzel filter asks what note it is. A track
// that exists proves only that the muxer wrote a header; this proves the samples travelled from
// the offline render through the worker into the file.
function toneStrength(path, hertz) {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-map", "0:a", "-t", "0.5", "-ac", "1", "-f", "f32le", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  const w = (2 * Math.PI * hertz) / 48_000;
  const c = 2 * Math.cos(w);
  let first = 0;
  let second = 0;
  for (const sample of samples) {
    const next = sample + c * first - second;
    second = first;
    first = next;
  }
  return (first * first + second * second - c * first * second) / samples.length;
}

function ffmpegChecks(path, expected) {
  const checks = [];
  const add = (name, got, want) =>
    checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  let report;
  try {
    report = inspect(path);
  } catch (error) {
    add("ffmpeg reads the file", `THREW ${String(error.message).slice(0, 300)}`, "no throw");
    return checks;
  }
  const video = report.probed.streams.find((stream) => stream.codec_type === "video");
  const audio = report.probed.streams.find((stream) => stream.codec_type === "audio");
  add("ffprobe agrees on the codec", video?.codec_name, "h264");
  add("ffprobe agrees on the resolution", [video?.width, video?.height], expected.size);
  add("ffprobe agrees on the frame rate", video?.r_frame_rate, expected.frameRate);
  add("ffprobe counts every frame", Number(video?.nb_frames), expected.frames);
  add(
    "ffprobe agrees on the length",
    Math.round(Number(report.probed.format.duration) * 100),
    Math.round(expected.seconds * 100),
  );
  add("ffprobe finds the sound", audio?.codec_name, "aac");
  add("and its sample rate and channels", [audio?.sample_rate, audio?.channels], ["48000", 2]);
  add("ffmpeg decodes every frame back", report.decoded.trim(), "");
  const tone = toneStrength(path, expected.hertz);
  add("the sound in the file is the tone that went in", tone > 100 * toneStrength(path, 550), true);
  return checks;
}

function stop(browser) {
  if (browser?.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      browser.kill();
    }
  } catch {
    // Already gone, which is the outcome this wanted.
  }
}

const { server, state, reported, port } = await serve();
let browser;
try {
  await esbuild.build({
    entryPoints: [join(here, "entry.ts")],
    bundle: true,
    format: "esm",
    outfile: join(here, "bundle.js"),
    target: "es2022",
  });
  await esbuild.build({
    entryPoints: [join(here, "..", "src", "export", "worker.ts")],
    bundle: true,
    format: "esm",
    outfile: join(here, "worker.js"),
    target: "es2022",
  });

  browser = spawn(
    chrome(),
    ["--headless", "--disable-gpu", "--no-first-run", `http://127.0.0.1:${port}/harness.html`],
    { stdio: "ignore" },
  );

  const page = await Promise.race([
    reported,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("the harness never reported back")), RUN_TIMEOUT_MS),
    ),
  ]);

  const results = [...page.results];
  if (state.file === null) {
    results.push({ name: "the export produced a file", ok: false, got: null, want: "bytes" });
  } else {
    const out = join(tmpdir(), "videola-export");
    mkdirSync(out, { recursive: true });
    const path = join(out, page.fileName);
    writeFileSync(path, state.file);
    console.log(`wrote ${path} (${state.file.length} bytes)`);
    results.push(...ffmpegChecks(path, page.expected));
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of failed) {
    console.error(
      `FAIL ${result.name}\n  got  ${JSON.stringify(result.got)}\n  want ${JSON.stringify(result.want)}`,
    );
  }
  console.log(`${results.length - failed.length}/${results.length} export checks passed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  // A headless Chrome without --dump-dom stays up until it is told otherwise, and on Windows it
  // has children that outlive their parent's handle. Its open sockets keep `close()` waiting
  // forever, so both ends have to be cut: the whole process tree, then the connections.
  stop(browser);
  server.closeAllConnections();
  server.close();
  for (const artefact of artefacts) rmSync(artefact, { force: true });
}
