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
    check("hands out 26 commands", schema.commands.length === 26);

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
