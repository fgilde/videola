import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";

import { cmd } from "@videola/core";
import { tinyMp4 } from "@videola/engine/src/decode/fixture-mp4";
import { COMMAND_LABELS } from "@videola/core/src/generated/commandLabels";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Api } from "./api";
import type { RunYtDlp } from "./fetch";
import { createRequestListener, type HttpOptions } from "./http";

// A real, probeable file: the import describes what it reads, and bytes no demuxer can read
// are refused before they reach the library.
const MP4 = Buffer.from(await tinyMp4().arrayBuffer());

let root = "";
let server: Server;
let base = "";

let sent: { url: string; body: unknown }[] = [];

// A `yt-dlp` that answers out of this file rather than off the internet. Where the real one writes
// a file into the directory it was handed, this one writes one too -- which is what lets the route
// be checked the whole way, from a query string to the bytes the editor receives.
let fetched: string[][] = [];

function fakeYtDlp(answers: {
  version?: string;
  search?: unknown[];
  describe?: unknown;
  writes?: { name: string; bytes: Uint8Array };
  fails?: string;
}) {
  return async (args: readonly string[]) => {
    fetched.push([...args]);
    if (answers.fails !== undefined) return { stdout: "", stderr: answers.fails, code: 1 };
    if (args.includes("--version")) return { stdout: answers.version ?? "2026.01.01", stderr: "", code: 0 };
    if (args.some((arg) => arg.startsWith("ytsearch"))) {
      return { stdout: (answers.search ?? []).map((one) => JSON.stringify(one)).join("\n"), stderr: "", code: 0 };
    }
    if (args.includes("--dump-single-json")) {
      return { stdout: JSON.stringify(answers.describe ?? {}), stderr: "", code: 0 };
    }
    const target = args[args.indexOf("-o") + 1] ?? "";
    const written = answers.writes;
    if (written !== undefined) await writeFile(join(dirname(target), written.name), written.bytes);
    return { stdout: "", stderr: "", code: 0 };
  };
}

async function start(
  options: Partial<HttpOptions> = {},
  watched = false,
  ytdlp?: RunYtDlp,
): Promise<void> {
  // A publish is an HTTP conversation with somebody else's server. Watched, it is a conversation with
  // this array -- which is the only way a check can say what a publish would do to a real account.
  const http = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    sent.push({ url: String(input), body: init?.body });
    if (String(input).includes("oauth2")) {
      return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
    }
    if (String(input).includes("uploadType=resumable")) {
      return new Response("{}", { status: 200, headers: { location: "https://upload.test/s" } });
    }
    return new Response(JSON.stringify({ id: "vid_1" }), { status: 200 });
  }) as typeof fetch;
  const api = new Api({
    storageRoot: root,
    maxProjects: 4,
    ...(watched ? { fetch: http } : {}),
    ...(ytdlp === undefined ? {} : { ytdlp }),
  });
  server = createServer(createRequestListener({ api, ...options }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "videola-http-"));
  sent = [];
  fetched = [];
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
    await writeFile(join(web, "sw.js"), "self.addEventListener('fetch', () => {});");
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

  // The one file that must never be cached long: a service worker served as immutable pins the
  // whole application to whatever it was serving on the day it was installed, and the browser has
  // no way back from that -- the worker it would need to fetch a newer one is the stale one.
  it("never caches the service worker as immutable", async () => {
    await start({ webRoot: web });

    const worker = await fetch(`${base}/sw.js`);
    expect(worker.headers.get("cache-control")).toBe("no-cache");
    expect(worker.headers.get("content-type")).toContain("javascript");
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

describe("destinations", () => {
  beforeEach(() => start({}, true));

  async function youtube(): Promise<string> {
    const { body } = await json("/api/destinations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "youtube",
        name: "Mein Kanal",
        secrets: { clientId: "id", clientSecret: "shh", refreshToken: "r" },
        settings: { privacyStatus: "unlisted" },
      }),
    });
    return body.id as string;
  }

  it("takes a destination and lists it again", async () => {
    const id = await youtube();

    const { body } = await json("/api/destinations");

    expect(body.destinations).toHaveLength(1);
    expect(body.destinations[0].id).toBe(id);
    expect(body.destinations[0].name).toBe("Mein Kanal");
  });

  // The rule the whole feature stands on. Anything that answers a request may say a destination holds
  // a refresh token; nothing may say what it is.
  it("never reads a secret back out", async () => {
    await youtube();

    const listed = await json("/api/destinations");

    expect(JSON.stringify(listed.body)).not.toContain("shh");
    expect(listed.body.destinations[0].holds).toEqual(["clientId", "clientSecret", "refreshToken"]);
  });

  it("refuses one it could not publish with, at the moment it is set up", async () => {
    const { status, body } = await json("/api/destinations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "youtube", name: "Halb", secrets: { clientId: "id" } }),
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("badDestination");
    expect(String(body.error.message)).toContain("clientSecret");
  });

  it("sends the video where it was told to, with the title beside it", async () => {
    const id = await youtube();

    const response = await fetch(
      `${base}/api/destinations/${id}/publish?title=Sommer&description=Ein%20Test`,
      { method: "POST", headers: { "content-type": "video/mp4" }, body: MP4 },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "vid_1",
      url: "https://www.youtube.com/watch?v=vid_1",
    });
    // The refresh token was spent on a token, and the metadata carried what the query said.
    expect(sent[0]?.url).toContain("oauth2");
    expect(String(sent[1]?.body)).toContain("Sommer");
    expect(String(sent[1]?.body)).toContain("Ein Test");
    // Unlisted, because the destination said so, and not the safe default.
    expect(String(sent[1]?.body)).toContain('"privacyStatus":"unlisted"');
  });

  it("will not publish a video with no title, and will not publish nothing", async () => {
    const id = await youtube();

    expect((await json(`/api/destinations/${id}/publish`, { method: "POST", body: MP4 })).status)
      .toBe(400);
    const empty = await fetch(`${base}/api/destinations/${id}/publish?title=Leer`, {
      method: "POST",
      body: new Uint8Array(),
    });
    expect(empty.status).toBe(400);
  });

  it("is a 404 for a destination that is not there, and forgets one that is", async () => {
    const id = await youtube();

    expect(
      (await fetch(`${base}/api/destinations/dst_nope/publish?title=X`, { method: "POST", body: MP4 }))
        .status,
    ).toBe(404);
    expect((await json(`/api/destinations/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await json("/api/destinations")).body.destinations).toEqual([]);
  });

  // The platform's own failure is not this server's failure, and a 401 from YouTube must not read as
  // "your Videola token expired".
  it("reports a refusal from the platform as a bad gateway, in its own words", async () => {
    const id = await youtube();
    sent = [];
    const failing = new Api({
      storageRoot: root,
      fetch: (async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch,
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createServer(createRequestListener({ api: failing }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const response = await fetch(`${base}/api/destinations/${id}/publish?title=X`, {
      method: "POST",
      body: MP4,
    });

    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).toContain("invalid_grant");
  });
});

describe("fetching material from a link", () => {
  const FOUND = {
    id: "abc123",
    title: "Die Bühne",
    duration: 61,
    uploader: "Ein Kanal",
    thumbnails: [{ url: "https://i.example/big.jpg" }],
  };

  it("says whether this server can fetch at all", async () => {
    await start({}, false, fakeYtDlp({ version: "2026.08.31" }));

    const { status, body } = await json("/api/fetch/ready");

    expect(status).toBe(200);
    expect(body).toEqual({ available: true, version: "2026.08.31" });
  });

  it("says so plainly where the tool is not installed", async () => {
    await start({}, false, async () => {
      throw new Error("yt-dlp is not installed on this server");
    });

    const { body } = await json("/api/fetch/ready");

    expect(body.available).toBe(false);
  });

  it("searches, and hands back what a dialogue needs to show a result", async () => {
    await start({}, false, fakeYtDlp({ search: [FOUND] }));

    const { status, body } = await json("/api/fetch/search?q=b%C3%BChne");

    expect(status).toBe(200);
    expect(body.results).toEqual([
      {
        id: "abc123",
        title: "Die Bühne",
        url: "https://www.youtube.com/watch?v=abc123",
        duration: 61,
        uploader: "Ein Kanal",
        thumbnail: "https://i.example/big.jpg",
      },
    ]);
    expect(fetched[0]?.some((arg) => arg === "ytsearch12:bühne")).toBe(true);
  });

  it("describes one link without downloading it", async () => {
    await start({}, false, fakeYtDlp({ describe: { ...FOUND, webpage_url: "https://ok.test/v" } }));

    const { body } = await json("/api/fetch/describe?url=https%3A%2F%2Fok.test%2Fv");

    expect(body.title).toBe("Die Bühne");
    expect(fetched[0]).toContain("--dump-single-json");
  });

  it("refuses a link into the server's own network", async () => {
    await start({}, false, fakeYtDlp({}));

    const { status, body } = await json("/api/fetch/describe?url=http%3A%2F%2F127.0.0.1%2Fadmin");

    expect(status).toBe(502);
    expect(body.error.message).toContain("own network");
    // Refused before anything ran: a downloader that reaches the address first has already been
    // used as a way in, whatever it reports afterwards.
    expect(fetched).toEqual([]);
  });

  it("hands the file back as bytes, named the way the site named it", async () => {
    await start({}, false, fakeYtDlp({ writes: { name: "Die Bühne.mp4", bytes: new Uint8Array(MP4) } }));

    const response = await fetch(
      `${base}/api/fetch?url=https%3A%2F%2Fok.test%2Fv&kind=video&format=mp4&quality=720`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    // Twice: a plain name for every client, and the real one in the encoding a header can carry.
    // A title from a video site has umlauts, quotes and emoji in it, and Node refuses the header
    // outright rather than mangling it.
    expect(response.headers.get("content-disposition")).toContain(`filename="Die B_hne.mp4"`);
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''" + encodeURIComponent("Die Bühne.mp4"),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(MP4));
    const asked = fetched[0] ?? [];
    expect(asked[asked.indexOf("-f") + 1]).toContain("height<=720");
  });

  it("asks for sound alone when sound is what was asked for", async () => {
    await start({}, false, fakeYtDlp({ writes: { name: "ton.m4a", bytes: new Uint8Array([1, 2]) } }));

    const response = await fetch(
      `${base}/api/fetch?url=https%3A%2F%2Fok.test%2Fv&kind=audio&format=m4a&quality=best`,
      { method: "POST" },
    );

    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(fetched[0]).toContain("--extract-audio");
  });

  it("passes the tool's own words on when a download fails", async () => {
    await start({}, false, fakeYtDlp({ fails: "ERROR: Video unavailable" }));

    const { status, body } = await json("/api/fetch?url=https%3A%2F%2Fok.test%2Fv", {
      method: "POST",
    });

    expect(status).toBe(502);
    expect(body.error.message).toBe("Video unavailable");
  });

  it("refuses a fetch with no link at all", async () => {
    await start({}, false, fakeYtDlp({}));

    const { status, body } = await json("/api/fetch", { method: "POST" });

    expect(status).toBe(400);
    expect(body.error.code).toBe("badRequest");
  });
});
