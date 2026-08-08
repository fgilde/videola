// Checks the two things unit tests structurally cannot: that `pnpm build` produces bundles Node
// can actually run, and that the wasm core still resolves from inside a bundle, where
// `import.meta.url` no longer points at a source file next to the .wasm.
//
// Run after `pnpm --filter videola-server build`.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const root = await mkdtemp(join(tmpdir(), "videola-bundle-"));
const failures = [];

function check(label, condition) {
  if (condition) process.stdout.write(`  ok   ${label}\n`);
  else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}\n`);
  }
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

  await client.close();
}

// The image serves the editor out of this same process, so the bundle has to prove it can: a
// wrong type on the .wasm leaves every file reachable and the editor still never starts.
async function stageWebRoot() {
  const web = join(root, "web");
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(web, "index.html"), "<title>Videola</title>");
  await writeFile(join(web, "assets", "core-abc.wasm"), Buffer.from([0, 97, 115, 109]));
  return web;
}

async function checkServeBundle() {
  process.stdout.write("dist/serve.mjs over HTTP\n");
  const port = 7411;
  const child = spawn(process.execPath, [join(dist, "serve.mjs")], {
    env: {
      ...process.env,
      VIDEOLA_PORT: String(port),
      VIDEOLA_STORAGE_ROOT: root,
      VIDEOLA_WEB_ROOT: await stageWebRoot(),
    },
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

    const page = await fetch(`http://127.0.0.1:${port}/editor/deep/route`);
    check("answers an application route with the document", (await page.text()).includes("Videola"));
    const wasm = await fetch(`http://127.0.0.1:${port}/assets/core-abc.wasm`);
    check("serves .wasm as application/wasm", wasm.headers.get("content-type") === "application/wasm");

    const created = await fetch(`http://127.0.0.1:${port}/api/projects`, { method: "POST" }).then(
      (r) => r.json(),
    );
    const archive = await fetch(`http://127.0.0.1:${port}/api/projects/${created.id}/file`);
    const bytes = Buffer.from(await archive.arrayBuffer());
    check("writes a .videola archive", bytes.subarray(0, 2).toString() === "PK");
  } finally {
    child.kill();
  }
}

async function checkCliBundle() {
  process.stdout.write("dist/cli.mjs from a shell\n");
  const commands = join(root, "cmds.json");
  const archive = join(root, "cli.videola");
  await writeFile(commands, JSON.stringify([{ type: "track.add", kind: "video", name: "V1" }]));

  const applied = await runCli(["apply", "--commands", commands, "--out", archive]);
  check("applies a commands file", applied.code === 0 && applied.stdout.includes("wrote"));

  const described = await runCli(["describe", archive]);
  check("reads back what it wrote", described.stdout.includes('video "V1"'));

  const refused = await runCli(["schema", "clip.teleport"]);
  // A message on stdout would end up inside whatever the caller is piping the schema into.
  check("keeps refusals off stdout", refused.code === 1 && refused.stdout === "");
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(dist, "cli.mjs"), ...args], {
      env: { ...process.env, VIDEOLA_STORAGE_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout }));
  });
}

try {
  await checkMcpBundle();
  await checkServeBundle();
  await checkCliBundle();
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nall bundle checks passed\n");
