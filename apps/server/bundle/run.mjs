// Checks the two things unit tests structurally cannot: that `pnpm build` produces bundles Node
// can actually run, and that the wasm core still resolves from inside a bundle, where
// `import.meta.url` no longer points at a source file next to the .wasm.
//
// Run after `pnpm --filter videola-server build`.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const root = await mkdtemp(join(tmpdir(), "videola-bundle-"));
const failures = [];

const SECOND = 705_600_000;
// Two colours nothing else in the picture can produce, and neither of them the zero a cleared
// buffer reads as -- a still that came back blank has to fail both checks, not pass one of them.
const BACKDROP = "#204060";
const BACKDROP_PIXEL = [32, 64, 96, 255];
const CLIP_PIXEL = [255, 0, 255, 255];

function check(label, condition) {
  if (condition) process.stdout.write(`  ok   ${label}\n`);
  else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}\n`);
  }
}

function checkEq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(ok ? label : `${label} -- got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, ok);
}

// An independent reader: nothing below shares a line with whatever wrote the file. It covers what
// a canvas writes -- eight bit RGBA, no interlace -- and refuses everything else rather than
// guessing at it.
function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error("not a PNG");
  const parts = [];
  let header;
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: view.getUint32(offset + 8),
        height: view.getUint32(offset + 12),
        depth: body[8],
        colour: body[9],
        interlace: body[12],
      };
    }
    if (type === "IDAT") parts.push(body);
    offset += 12 + length;
  }
  if (header === undefined) throw new Error("a PNG without an IHDR");
  if (header.depth !== 8 || header.colour !== 6 || header.interlace !== 0) {
    throw new Error(`unexpected PNG: depth ${header.depth}, colour type ${header.colour}`);
  }
  const pixels = unfilter(inflateSync(Buffer.concat(parts)), header.width, header.height);
  return { ...header, pixels };
}

function unfilter(raw, width, height) {
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  let at = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[at];
    at += 1;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? out[row * stride + index - 4] : 0;
      const up = row > 0 ? out[(row - 1) * stride + index] : 0;
      const corner = row > 0 && index >= 4 ? out[(row - 1) * stride + index - 4] : 0;
      out[row * stride + index] = (raw[at + index] + predict(filter, left, up, corner)) & 0xff;
    }
    at += stride;
  }
  return out;
}

// The five row filters of the PNG specification, section 9.2.
function predict(filter, left, up, corner) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return (left + up) >> 1;
  if (filter === 4) return paeth(left, up, corner);
  throw new Error(`unknown PNG row filter ${filter}`);
}

function paeth(a, b, c) {
  const estimate = a + b - c;
  const da = Math.abs(estimate - a);
  const db = Math.abs(estimate - b);
  const dc = Math.abs(estimate - c);
  if (da <= db && da <= dc) return a;
  return db <= dc ? b : c;
}

function centre(png) {
  const at = ((png.height >> 1) * png.width + (png.width >> 1)) * 4;
  return Array.from(png.pixels.subarray(at, at + 4));
}

// A solid generator rather than a video: no medium to import, and a flat colour comes back out of
// a PNG as the number that went in, so the check can be the colour itself.
async function paintProject(call) {
  const project = JSON.parse((await call("project_create", {})).content[0].text).id;
  await call("project_setSettings", {
    project,
    settings: {
      width: 320,
      height: 180,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: 48000,
      colorSpace: "srgb",
      background: BACKDROP,
    },
  });
  await call("track_add", { project, kind: "video", name: "V1" });
  const state = JSON.parse((await call("project_get", { project })).content[0].text);
  await call("clip_add", {
    project,
    track: state.timeline.tracks[0].id,
    source: { kind: "generator", generator: { type: "solid", color: "#ff00ff" } },
    start: 0,
    duration: SECOND,
  });
  return project;
}

async function checkFrames(call) {
  const project = await paintProject(call);
  const answer = await call("project_getFrame", {
    project,
    at: [SECOND / 2, 2 * SECOND],
    width: 96,
  });
  check("get_frame answers at all", answer.isError !== true);
  if (answer.isError === true) {
    process.stdout.write(`       ${answer.content[0].text}\n`);
    return;
  }
  checkEq(
    "with a picture per instant, as pictures",
    answer.content.map((block) => [block.type, block.mimeType]),
    [
      ["image", "image/png"],
      ["image", "image/png"],
    ],
  );
  const pictures = answer.content.map((block) => decodePng(Buffer.from(block.data, "base64")));
  checkEq(
    "at the width asked for, in the project's aspect ratio",
    pictures.map((png) => [png.width, png.height]),
    [
      [96, 54],
      [96, 54],
    ],
  );
  // Inside the clip and past its end: the same renderer, two instants, two colours. A frozen
  // buffer, a blank one, or a still of the wrong moment each fail one of these.
  checkEq("showing the clip where the clip is", centre(pictures[0]), CLIP_PIXEL);
  checkEq("and the backdrop where it has ended", centre(pictures[1]), BACKDROP_PIXEL);

  const refused = await call("project_getFrame", { project, at: [-1] });
  check("a time that is not a time is refused", refused.isError === true);
}

async function checkMcpBundle() {
  process.stdout.write("dist/mcp.mjs over stdio\n");
  const client = new Client({ name: "bundle-check", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(dist, "mcp.mjs")],
      env: { ...process.env, VIDEOLA_STORAGE_ROOT: root },
    }),
  );

  const { tools } = await client.listTools();
  check("lists tools", tools.length > 26);
  check("has a tool for clip.split", tools.some((tool) => tool.name === "clip_split"));

  const created = await client.callTool({ name: "project_create", arguments: {} });
  const project = JSON.parse(created.content[0].text).id;
  check("creates a project", typeof project === "string" && project.startsWith("prj_"));

  const added = await client.callTool({
    name: "track_add",
    arguments: { project, kind: "video", name: "V1" },
  });
  check("dispatches through the real core", added.isError !== true);

  const described = await client.callTool({ name: "project_describe", arguments: { project } });
  check("describes the project", described.content[0].text.includes('video "V1"'));

  const saved = await client.callTool({
    name: "project_save",
    arguments: { project, path: "bundle.videola" },
  });
  check("saves an archive", saved.isError !== true);

  check("has the one tool that shows a picture", tools.some((t) => t.name === "project_getFrame"));
  await checkFrames((name, args) => client.callTool({ name, arguments: args }));

  await client.close();
}

async function paintedOverHttp(port) {
  const base = `http://127.0.0.1:${port}/api/projects`;
  const send = async (path, payload) =>
    (
      await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      })
    ).json();

  const { id } = await send("");
  await send(`/${id}/commands`, {
    commands: [
      {
        type: "project.setSettings",
        settings: {
          width: 320,
          height: 180,
          fps: { numerator: 30, denominator: 1 },
          sampleRate: 48000,
          colorSpace: "srgb",
          background: BACKDROP,
        },
      },
      { type: "track.add", kind: "video", name: "V1" },
    ],
  });
  const { project } = await fetch(`${base}/${id}`).then((response) => response.json());
  await send(`/${id}/commands`, {
    commands: [
      {
        type: "clip.add",
        track: project.timeline.tracks[0].id,
        source: { kind: "generator", generator: { type: "solid", color: "#ff00ff" } },
        start: 0,
        duration: SECOND,
      },
    ],
  });
  return id;
}

async function checkServeBundle() {
  process.stdout.write("dist/serve.mjs over HTTP\n");
  const port = 7411;
  const child = spawn(process.execPath, [join(dist, "serve.mjs")], {
    env: { ...process.env, VIDEOLA_PORT: String(port), VIDEOLA_STORAGE_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("exit", (code) => reject(new Error(`server exited with ${code}`)));
    });

    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
    check("answers health", health.ok === true);

    const schema = await fetch(`http://127.0.0.1:${port}/api/schema`).then((r) => r.json());
    // A count would have to be edited by hand every time the Rust enum grows, which is the chore
    // the generated catalogue exists to remove -- and it went stale the first time it did. What
    // matters is that the bundle really carries the generated entries: named commands from three
    // different families, each with a schema the bundler did not flatten away.
    const served = new Map(schema.commands.map((entry) => [entry.command, entry]));
    for (const name of ["clip.add", "clip.rippleDelete", "keyframe.add", "marker.add"]) {
      check(`serves ${name}`, served.get(name)?.schema?.properties !== undefined);
    }
    check("serves every command the core exports", schema.commands.length >= served.size);

    const created = await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST" }).then(
      (r) => r.json(),
    );
    const archive = await fetch(`http://127.0.0.1:${port}/api/projects/${created.id}/file`);
    const bytes = Buffer.from(await archive.arrayBuffer());
    check("writes a .videola archive", bytes.subarray(0, 2).toString() === "PK");

    // The other transport of the same seam, and its own way of reading the arguments: over HTTP a
    // frame is a picture with a content type, not base64 in a JSON envelope.
    const id = await paintedOverHttp(port);
    const frame = await fetch(
      `http://127.0.0.1:${port}/api/projects/${id}/frame?at=${SECOND / 2}&width=96`,
    );
    check("hands back a picture as a picture", frame.headers.get("content-type") === "image/png");
    if (frame.ok) {
      const png = decodePng(Buffer.from(await frame.arrayBuffer()));
      checkEq("of the moment that was asked for", centre(png), CLIP_PIXEL);
    } else {
      checkEq("of the moment that was asked for", await frame.text(), "a picture");
    }
  } finally {
    child.kill();
  }
}

try {
  await checkMcpBundle();
  await checkServeBundle();
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nall bundle checks passed\n");
