// The server, as one file somebody can unpack on a machine that has Node and nothing else.
//
// The Docker image is the packaged form for anyone who runs Docker. This is the packaged form for
// everyone else: a Proxmox container, a systemd service on a Raspberry Pi, a VM at a hosting company.
// It carries the three entry points, the WASM the core lives in, and the built editor -- and nothing
// that would need installing, because esbuild has already bundled every dependency into the entry
// points. What is left needs Node 22 and a directory to write to.
//
// Built here rather than in the workflow so the thing a release publishes is the thing anybody can
// build from a checkout with one command. A release step that assembled a tarball out of shell lines
// would be a second recipe, and the one that never runs locally is the one that breaks.

import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const version = JSON.parse(
  await readFile(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
).version;

// One name, computed in one place: the Proxmox script downloads exactly this, and a mismatch between
// what is published and what is fetched is a script that works until the day it is needed.
export const bundleName = (v = version) => `videola-server-${v}.tar.gz`;

/** Everything the tarball holds, as source path to path inside it. */
const CONTENTS = [
  ["apps/server/dist/serve.mjs", "serve.mjs"],
  ["apps/server/dist/mcp.mjs", "mcp.mjs"],
  ["apps/server/dist/cli.mjs", "cli.mjs"],
  ["packages/core/src/wasm/videola_core_bg.wasm", "videola_core_bg.wasm"],
  ["apps/web/dist", "web"],
  ["LICENSE", "LICENSE"],
];

async function run(command, args, cwd = root) {
  await new Promise((resolve, reject) => {
    // No shell. On Windows a shell would also mean tar reading `C:\...` as a host to connect to --
    // GNU tar treats a colon in a path as a remote -- which is why every path below is relative to
    // `cwd` and the archive is moved into place afterwards rather than written across the tree.
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function main() {
  const out = join(root, "dist");
  await mkdir(out, { recursive: true });
  const staging = await mkdtemp(join(tmpdir(), "videola-bundle-"));
  const inside = join(staging, `videola-server-${version}`);
  await mkdir(inside, { recursive: true });
  for (const [from, to] of CONTENTS) {
    await cp(join(root, from), join(inside, to), { recursive: true });
  }
  // What it is and how to start it, in the tarball itself: a directory of .mjs files with no note in
  // it is a directory somebody has to guess at.
  await writeFile(
    join(inside, "README.txt"),
    [
      `Videola ${version} -- the server, the editor and the MCP server.`,
      "",
      "Needs Node 22 or later and nothing else: every dependency is already bundled.",
      "",
      "  VIDEOLA_TOKEN=$(openssl rand -hex 24) \\",
      "  VIDEOLA_HOST=0.0.0.0 VIDEOLA_STORAGE_ROOT=/var/lib/videola \\",
      "  VIDEOLA_WEB_ROOT=./web VIDEOLA_WASM=./videola_core_bg.wasm \\",
      "  node serve.mjs",
      "",
      "The token is not optional on a reachable address: without one the server refuses to bind",
      "anything but loopback, because an open Videola hands out its storage root.",
      "",
      "https://fgilde.github.io/videola/guide/self-hosting",
    ].join("\n"),
    "utf8",
  );
  const archive = join(out, bundleName());
  await run("tar", ["-czf", bundleName(), `videola-server-${version}`], staging);
  await cp(join(staging, bundleName()), archive);
  await rm(staging, { recursive: true, force: true });
  console.log(archive);
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  await main();
}
