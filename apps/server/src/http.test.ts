import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { cmd } from "@videola/core";
import { tinyMp4 } from "@videola/engine/src/decode/fixture-mp4";
import { COMMAND_LABELS } from "@videola/core/src/generated/commandLabels";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Api } from "./api";
import { createRequestListener, type HttpOptions } from "./http";

// A real, probeable file: the import describes what it reads, and bytes no demuxer can read
// are refused before they reach the library.
const MP4 = Buffer.from(await tinyMp4().arrayBuffer());

let root = "";
let server: Server;
let base = "";

async function start(options: Partial<HttpOptions> = {}): Promise<void> {
  const api = new Api({ storageRoot: root, maxProjects: 4 });
  server = createServer(createRequestListener({ api, ...options }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "videola-http-"));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function json(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, body: await response.json() };
}

async function newProject(): Promise<string> {
  const { body } = await json("/api/projects", { method: "POST" });
  return body.id as string;
}

describe("the read-only routes", () => {
  beforeEach(() => start());

  it("answers health with the storage root it will actually use", async () => {
    const { status, body } = await json("/api/health");

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.storageRoot.endsWith(root.split(/[\\/]/).pop() ?? "")).toBe(true);
  });

  it("hands out a schema entry for every command the core knows", async () => {
    const { body } = await json("/api/schema");

    // Against the core's own label list, not against the catalogue the route serves: comparing the
    // generated file with itself would pass however many commands went missing on the way.
    expect(body.commands.map((entry: { command: string }) => entry.command).sort()).toEqual(
      [...COMMAND_LABELS].map((label) => label.replace(/^cmd\./, "")).sort(),
    );
  });

  it("reports an unknown route rather than a blank 200", async () => {
    const { status, body } = await json("/api/nope");

    expect(status).toBe(404);
    expect(body.error.code).toBe("noSuchRoute");
  });
});

describe("editing over HTTP", () => {
  beforeEach(() => start());

  it("creates, reads and closes a project", async () => {
    const id = await newProject();

    const read = await json(`/api/projects/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.project.timeline.tracks).toEqual([]);
    expect(read.body.revision).toBe(0);

    const listed = await json("/api/projects");
    expect(listed.body.projects).toHaveLength(1);

    const closed = await json(`/api/projects/${id}`, { method: "DELETE" });
    expect(closed.status).toBe(200);
    expect((await json("/api/projects")).body.projects).toEqual([]);
  });

  it("takes a single command as well as a batch", async () => {
    const id = await newProject();

    const single = await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: cmd.trackAdd("video", "V1") }),
    });
    expect(single.status).toBe(200);
    expect(single.body.results).toHaveLength(1);
    expect(single.body.view.revision).toBe(1);

    const batch = await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({
        commands: [cmd.trackAdd("audio", "A1"), cmd.projectSetTitle("Reel")],
      }),
    });
    expect(batch.body.results).toHaveLength(2);
    expect((await json(`/api/projects/${id}`)).body.project.timeline.tracks).toHaveLength(2);
  });

  it("answers 409 when the expected revision has moved on", async () => {
    const id = await newProject();
    await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: cmd.trackAdd("video", "V1") }),
    });

    const stale = await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: cmd.projectSetTitle("Reel"), ifRevision: 0 }),
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("revisionMismatch");
  });

  it("passes the core's refusal through with the reason", async () => {
    const id = await newProject();

    const rejected = await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: cmd.trackRename("trk_nope", "x") }),
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toContain("trk_nope");
  });

  it("reports a malformed body instead of a server error", async () => {
    const id = await newProject();

    const bad = await json(`/api/projects/${id}/commands`, { method: "POST", body: "{oops" });
    expect(bad.status).toBe(400);

    const wrongShape = await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ nothing: true }),
    });
    expect(wrongShape.status).toBe(400);
  });

  it("undoes and redoes", async () => {
    const id = await newProject();
    await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: cmd.trackAdd("video", "V1") }),
    });

    await json(`/api/projects/${id}/undo`, { method: "POST" });
    expect((await json(`/api/projects/${id}`)).body.project.timeline.tracks).toEqual([]);

    await json(`/api/projects/${id}/redo`, { method: "POST" });
    expect((await json(`/api/projects/${id}`)).body.project.timeline.tracks).toHaveLength(1);
  });

  it("describes and validates", async () => {
    const id = await newProject();
    await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: cmd.trackAdd("video", "V1") }),
    });

    expect((await json(`/api/projects/${id}/describe`)).body.description).toContain('video "V1"');
    expect((await json(`/api/projects/${id}/validate`)).body.findings).toEqual([]);
  });
});

describe("media and archives over HTTP", () => {
  beforeEach(() => start());

  it("imports raw bytes and names the medium after them", async () => {
    const id = await newProject();

    const imported = await json(
      `/api/projects/${id}/media?name=clip.mp4&mime=${encodeURIComponent("video/mp4")}`,
      { method: "POST", body: MP4 },
    );

    expect(imported.status).toBe(201);
    expect(imported.body.mediaId).toMatch(/^med_[0-9a-f]{64}$/);
    expect((await json(`/api/projects/${id}`)).body.project.library).toHaveLength(1);
  });

  it("imports a file from the storage root", async () => {
    await writeFile(join(root, "clip.mp4"), MP4);
    const id = await newProject();

    const imported = await json(`/api/projects/${id}/media?path=clip.mp4`, { method: "POST" });

    expect(imported.body.mediaId).toMatch(/^med_/);
  });

  it("refuses a media path that leaves the storage root", async () => {
    const id = await newProject();

    const denied = await json(`/api/projects/${id}/media?path=${encodeURIComponent("../x.mp4")}`, {
      method: "POST",
    });

    expect(denied.status).toBe(403);
  });

  it("needs either a path or a name and type", async () => {
    const id = await newProject();

    expect((await json(`/api/projects/${id}/media`, { method: "POST" })).status).toBe(400);
  });

  it("downloads the archive and reopens it from an upload", async () => {
    const id = await newProject();
    await json(`/api/projects/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ command: cmd.trackAdd("video", "V1") }),
    });

    const download = await fetch(`${base}/api/projects/${id}/file`);
    expect(download.headers.get("content-type")).toBe("application/zip");
    const archive = Buffer.from(await download.arrayBuffer());
    expect(archive.subarray(0, 2).toString()).toBe("PK");

    const saved = await json(`/api/projects/${id}/file`, {
      method: "PUT",
      body: JSON.stringify({ path: "out/reel.videola" }),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.source).toBe("out/reel.videola");

    const reopened = await json("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path: "out/reel.videola" }),
    });
    expect(reopened.status).toBe(201);
    expect((await json(`/api/projects/${reopened.body.id}`)).body.project.timeline.tracks).toHaveLength(1);
  });
});

describe("the token guard", () => {
  it("lets every request through when no token is configured", async () => {
    await start();

    expect((await json("/api/health")).status).toBe(200);
  });

  it("refuses every request without the token once one is configured", async () => {
    await start({ token: "s3cret" });

    expect((await json("/api/health")).status).toBe(401);
    expect((await json("/api/projects", { method: "POST" })).status).toBe(401);
  });

  it("accepts the right token and refuses a wrong one of the same length", async () => {
    await start({ token: "s3cret" });

    const good = await json("/api/health", { headers: { authorization: "Bearer s3cret" } });
    const bad = await json("/api/health", { headers: { authorization: "Bearer s3crXt" } });

    expect(good.status).toBe(200);
    expect(bad.status).toBe(401);
  });
});

describe("serving the web app", () => {
  let web = "";

  beforeEach(async () => {
    web = await mkdtemp(join(tmpdir(), "videola-web-"));
    await mkdir(join(web, "assets"), { recursive: true });
    await writeFile(join(web, "index.html"), "<title>Videola</title>");
    await writeFile(join(web, "assets", "index-abc123.js"), "export const a = 1;");
    await writeFile(join(web, "assets", "videola_core_bg-abc123.wasm"), Buffer.from([0, 97, 115, 109]));
  });

  it("answers the root with index.html", async () => {
    await start({ webRoot: web });

    const response = await fetch(`${base}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("Videola");
  });

  // The trap this project has already fallen into once: a wrong type here and the browser refuses
  // to instantiate the module, so the editor never starts while every file is served correctly.
  it("names the wasm and the script by their real types", async () => {
    await start({ webRoot: web });

    const wasm = await fetch(`${base}/assets/videola_core_bg-abc123.wasm`);
    const script = await fetch(`${base}/assets/index-abc123.js`);

    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("caches hashed assets forever and the document never", async () => {
    await start({ webRoot: web });

    expect((await fetch(`${base}/assets/index-abc123.js`)).headers.get("cache-control")).toContain(
      "immutable",
    );
    expect((await fetch(`${base}/`)).headers.get("cache-control")).toBe("no-cache");
  });

  it("answers a deep application route with the document", async () => {
    await start({ webRoot: web });

    const response = await fetch(`${base}/project/abc/timeline`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Videola");
  });

  it("refuses a path that climbs out of the web root", async () => {
    await writeFile(join(root, "secret.txt"), "not yours");
    await start({ webRoot: web });

    const response = await fetch(`${base}/${encodeURIComponent("../")}secret.txt`);

    expect(await response.text()).not.toContain("not yours");
  });

  // The app holds its projects in the visitor's own browser, so it gives nothing away; the storage
  // root behind /api does, and stays guarded.
  it("serves the app without the token but not the api", async () => {
    await start({ webRoot: web, token: "s3cret" });

    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/api/health`)).status).toBe(401);
  });

  it("keeps answering 404 on the api when no web root is configured", async () => {
    await start();

    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});

describe("the body cap", () => {
  it("refuses a body past the limit", async () => {
    await start({ maxBodyBytes: 64 });
    const id = await newProject();

    const response = await fetch(
      `${base}/api/projects/${id}/media?name=a.mp4&mime=${encodeURIComponent("video/mp4")}`,
      { method: "POST", body: "x".repeat(1024) },
    ).catch(() => null);

    expect(response?.status ?? 413).toBe(413);
    expect((await json(`/api/projects/${id}`)).body.project.library).toEqual([]);
  });

  it("accepts a body at the limit", async () => {
    await start({ maxBodyBytes: MP4.length });
    const id = await newProject();

    const response = await json(
      `/api/projects/${id}/media?name=a.mp4&mime=${encodeURIComponent("video/mp4")}`,
      { method: "POST", body: MP4 },
    );

    expect(response.status).toBe(201);
  });
});

describe("a still over HTTP", () => {
  beforeEach(() => start());

  it("insists on an instant and refuses one that is not a whole number", async () => {
    const id = await newProject();

    expect((await json(`/api/projects/${id}/frame`)).status).toBe(400);
    expect((await json(`/api/projects/${id}/frame?at=half`)).status).toBe(400);
    expect((await json(`/api/projects/${id}/frame?at=0&width=1.5`)).status).toBe(400);
  });

  it("is unknown for an unknown project before it renders anything", async () => {
    expect((await json("/api/projects/prj_nope/frame?at=0")).status).toBe(404);
  });
});
