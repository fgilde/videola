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

function body(request) {
  return new Promise((resolve, reject) => {
    const parts = [];
    request.on("data", (chunk) => parts.push(chunk));
    request.on("end", () => resolve(Buffer.concat(parts)));
    request.on("error", reject);
  });
}

function serve() {
  const state = { file: null, graded: null };
  let deliver = () => undefined;
  const reported = new Promise((resolve) => {
    deliver = resolve;
  });

  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (request.method === "POST") {
      void body(request).then((bytes) => {
        if (path === "/file") state.file = bytes;
        // A second file, exported through a lookup table. It is kept apart from the first because
        // the two answer different questions: that one is a well-formed file with sound and
        // subtitles in it, this one is a colour.
        else if (path === "/graded") state.graded = bytes;
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

// The first frame decoded back to raw RGB by ffmpeg. The written file's resolution says nothing
// about which file the export read -- the encoder is told the output size either way -- but the
// picture does: a proxy carries different pixels, and this is an outside reader saying which ones
// are in there.
function firstPixel(path, [width, height]) {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const centre = 3 * (Math.floor(height / 2) * width + Math.floor(width / 2));
  return [raw[centre], raw[centre + 1], raw[centre + 2]];
}

/**
 * One pixel out of the middle of the first frame, decoded by ffmpeg and nothing else.
 *
 * This is where the lookup table stops being our own claim about our own file. The page already
 * compares the export against a still rendered on its own thread, which proves the worker and the
 * editor agree; a reader that shares no line of code with either says what the colour actually is.
 * One frame, cropped to the middle, written out as raw RGB -- no container and no decoder of ours
 * in the path. Two by two at an even offset rather than a single pixel: the file is yuv420p, where
 * the chroma planes are half size, and a crop of one lands on a chroma plane of zero width.
 */
function centrePixel(path, width, height) {
  const x = Math.floor(width / 2 / 2) * 2;
  const y = Math.floor(height / 2 / 2) * 2;
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-vf", `crop=2:2:${x}:${y}`,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1024 },
  );
  return [raw[0], raw[1], raw[2]];
}

// A lossy encode at this bitrate moves a flat colour by a few levels; the swap this measures moves
// two channels by more than two hundred, so the slack cannot swallow the claim.
function gradedChecks(path, expected) {
  const want = expected.graded;
  try {
    const got = centrePixel(path, expected.size[0], expected.size[1]);
    return [{
      name: "ffmpeg reads the graded file's own pixel as the table's answer",
      ok: got.every((channel, index) => Math.abs(channel - want[index]) <= 16),
      got,
      want,
    }];
  } catch (error) {
    return [{
      name: "ffmpeg reads the graded file",
      ok: false,
      got: `THREW ${String(error.message).slice(0, 300)}`,
      want: "no throw",
    }];
  }
}

function ffmpegChecks(path, expected) {
  const checks = [];
  const add = (name, got, want) =>
    checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const addNear = (name, got, want, slack) =>
    checks.push({
      name,
      ok: got.length === want.length && got.every((v, i) => Math.abs(v - want[i]) <= slack),
      got,
      want,
    });
  let report;
  try {
    report = inspect(path);
  } catch (error) {
    add("ffmpeg reads the file", `THREW ${String(error.message).slice(0, 300)}`, "no throw");
    return checks;
  }
  const video = report.probed.streams.find((stream) => stream.codec_type === "video");
  const audio = report.probed.streams.find((stream) => stream.codec_type === "audio");
  add("ffprobe agrees on the codec", video?.codec_name, expected.videoCodec ?? "h264");
  add("ffprobe agrees on the resolution", [video?.width, video?.height], expected.size);
  add("ffprobe agrees on the frame rate", video?.r_frame_rate, expected.frameRate);
  add("ffprobe counts every frame", Number(video?.nb_frames), expected.frames);
  add(
    "ffprobe agrees on the length",
    Math.round(Number(report.probed.format.duration) * 100),
    Math.round(expected.seconds * 100),
  );
  add("ffmpeg decodes every frame back", report.decoded.trim(), "");
  // The one that matters for proxies. A proxy of this medium was on disk while the file was
  // written, at half its height and painted a colour that appears nowhere in the material. If the
  // export had read it, this pixel would be that colour.
  if (expected.firstPixel !== undefined) {
    const pixel = firstPixel(path, expected.size);
    addNear("the picture in the file is the original's, not the proxy's", pixel,
      expected.firstPixel, 16);
    add("and nothing of the proxy reached it",
      pixel.every((value, index) => Math.abs(value - expected.notPixel[index]) > 16), true);
    add("while the proxy on disk was another size entirely",
      [video?.width, video?.height].join("x") !== expected.proxySize.join("x"), true);
  }
  // The independent reader on the one thing our own demuxer is not asked about: a subtitle track
  // written beside the picture rather than drawn into it. A player has to find it, not us.
  if (expected.subtitles === true) {
    // Two shapes for one track. Matroska carries WebVTT as a subtitle stream and ffprobe names it
    // `webvtt`; ISO base media carries it in a `wvtt` box, which ffmpeg does not demux as subtitles
    // at all and reports as a data stream under that tag. Both are the track being in the file --
    // insisting on the Matroska shape would have called a correct MP4 a failure.
    const track = report.probed.streams.find(
      (stream) => stream.codec_name === "webvtt" || stream.codec_tag_string === "wvtt",
    );
    add("ffprobe finds the subtitle track in the file", track !== undefined, true);
    add("and it is a track of its own, beside the picture and the sound",
      report.probed.streams.length, expected.hasAudio === false ? 2 : 3);
  }
  // A browser can carry a format's picture and refuse its sound -- Chrome on Linux encodes H.264
  // and not AAC -- and the export then writes a silent file on purpose. Asking ffmpeg for a track
  // that is deliberately absent is not a failure of the export, so what is checked is that the
  // file matches what the browser said it could write.
  if (expected.hasAudio === false) {
    add("no sound, because this browser cannot encode any", audio, undefined);
    console.log("note: silent export -- this browser encodes no audio codec for the chosen format");
    return checks;
  }
  add("ffprobe finds the sound", audio?.codec_name, expected.audioCodec ?? "aac");
  add("and its sample rate and channels", [audio?.sample_rate, audio?.channels], ["48000", 2]);
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

  // Unreferenced, or the loser of the race holds the process open for its full five minutes after
  // a run that finished in forty seconds. The listening server is what keeps the loop alive until
  // then, so the deadline still arrives when the page really never reports.
  const page = await Promise.race([
    reported,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("the harness never reported back")), RUN_TIMEOUT_MS).unref();
    }),
  ]);

  const results = [...page.results];
  // Printed whether the run passed or failed: a budget that only says yes or no hides how close it
  // came, and these are the numbers the performance claims are made of.
  for (const [name, value] of Object.entries(page.measured ?? {})) {
    console.log(`measured ${name}: ${value}`);
  }
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

  if (state.graded === null) {
    results.push({ name: "the graded export produced a file", ok: false, got: null, want: "bytes" });
  } else {
    const out = join(tmpdir(), "videola-export");
    mkdirSync(out, { recursive: true });
    const path = join(out, `graded-${page.fileName}`);
    writeFileSync(path, state.graded);
    console.log(`wrote ${path} (${state.graded.length} bytes)`);
    results.push(...gradedChecks(path, page.expected));
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
