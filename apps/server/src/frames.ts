import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ChildProcess } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { wasmPath } from "./wasm";

export type RenderCode = "rendererUnavailable" | "renderFailed" | "renderTimeout";

export class RenderError extends Error {
  constructor(
    readonly code: RenderCode,
    message: string,
  ) {
    super(message);
  }
}

export interface StillJob {
  readonly archive: Uint8Array;
  readonly times: readonly number[];
  readonly width: number;
  readonly height: number;
}

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const RENDER_TIMEOUT_MS = 120_000;

const PAGE = '<!doctype html><meta charset="utf-8"><script type="module" src="./bundle.js"></script>';

// The compositor is WebGL2 and the decoders are WebCodecs; neither exists in Node. Rather than a
// second renderer that would have to be kept in step with the one the editor draws with, the
// server drives the real one in the browser the export already uses. The price is a Chrome on the
// machine, named here so a missing one is a clear answer rather than a blank picture.
export function chromePath(): string {
  const wanted = process.env["CHROME_PATH"];
  if (wanted !== undefined && wanted !== "") {
    if (!existsSync(wanted)) {
      throw new RenderError("rendererUnavailable", `CHROME_PATH points at nothing: ${wanted}`);
    }
    return wanted;
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (found === undefined) {
    throw new RenderError(
      "rendererUnavailable",
      "no Chrome or Chromium found; set CHROME_PATH to the executable",
    );
  }
  return found;
}

// Built by `pnpm --filter videola-server build`, and found from either the sources or the bundle
// because both sit one level under the package.
export function rendererPath(): string {
  const configured = process.env["VIDEOLA_RENDERER"];
  if (configured !== undefined && configured !== "") return configured;
  return fileURLToPath(new URL("../renderer/bundle.js", import.meta.url));
}

function requireRenderer(): string {
  const path = rendererPath();
  if (!existsSync(path)) {
    throw new RenderError(
      "rendererUnavailable",
      `no renderer bundle at ${path}; run \`pnpm --filter videola-server build\``,
    );
  }
  return path;
}

interface Page {
  readonly url: string;
  readonly stills: Uint8Array[];
  readonly finished: Promise<void>;
  close(): void;
}

// Everything the page needs, behind a path nobody can guess: the archive carries the whole project
// including its media, and anything else on this machine could otherwise read it out of a loopback
// port while a frame renders.
async function serve(job: StillJob, bundle: string): Promise<Page> {
  const nonce = randomBytes(16).toString("hex");
  const stills: Uint8Array[] = [];
  let settle: (reason: RenderError | undefined) => void = () => undefined;
  const reported = new Promise<RenderError | undefined>((resolve) => {
    settle = resolve;
  });

  const server = createServer((request, response) => {
    void answer(request, response).catch(() => response.writeHead(500).end());
  });

  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (!path.startsWith(`/${nonce}/`)) {
      response.writeHead(404).end();
      return;
    }
    const name = path.slice(nonce.length + 2);
    if (request.method === "POST") {
      const body = await collect(request);
      if (name === "still") stills.push(body);
      else settle(doneReason(body));
      response.writeHead(204).end();
      return;
    }
    if (name === "") return reply(response, "text/html", Buffer.from(PAGE));
    if (name === "bundle.js") return reply(response, "text/javascript", await readFile(bundle));
    if (name.endsWith(".wasm")) return reply(response, "application/wasm", await readFile(wasmPath()));
    if (name === "job") {
      const body = JSON.stringify({ times: job.times, width: job.width, height: job.height });
      return reply(response, "application/json", Buffer.from(body));
    }
    if (name === "archive") return reply(response, "application/zip", Buffer.from(job.archive));
    response.writeHead(404).end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/${nonce}/`,
    stills,
    finished: reported.then((error) => {
      if (error !== undefined) throw error;
    }),
    close(): void {
      server.closeAllConnections();
      server.close();
    },
  };
}

function doneReason(body: Uint8Array): RenderError | undefined {
  try {
    const report = JSON.parse(Buffer.from(body).toString("utf8")) as {
      ok?: boolean;
      reason?: string;
    };
    if (report.ok === true) return undefined;
    return new RenderError("renderFailed", report.reason ?? "the renderer gave no reason");
  } catch {
    return new RenderError("renderFailed", "the renderer reported something unreadable");
  }
}

function reply(response: ServerResponse, contentType: string, bytes: Buffer): void {
  response.writeHead(200, { "content-type": contentType, "content-length": bytes.length });
  response.end(bytes);
}

function collect(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    request.on("data", (chunk: Buffer) => parts.push(chunk));
    request.on("end", () => resolve(Buffer.concat(parts)));
    request.on("error", reject);
  });
}

// A headless Chrome without --dump-dom stays up until it is told otherwise, and on Windows it has
// children that outlive their parent's handle.
function stop(browser: ChildProcess): void {
  if (browser.pid === undefined) return;
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

// ponytail: a browser and a fresh profile per call, so a first still costs a Chrome start. Keeping
// one page alive between calls is what an agent checking its work every few seconds would want; it
// needs a lifecycle for the browser that a request-scoped renderer does not have. A profile per
// call rather than a shared one because a second Chrome on the same one hands its URL to the first
// and exits, and two frames may well be asked for at once.
export async function renderStills(job: StillJob): Promise<Uint8Array[]> {
  const bundle = requireRenderer();
  const chrome = chromePath();
  const profile = await mkdtemp(join(tmpdir(), "videola-render-"));
  const page = await serve(job, bundle);
  let browser: ChildProcess | undefined;
  try {
    browser = spawn(
      chrome,
      [
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        `--user-data-dir=${profile}`,
        page.url,
      ],
      { stdio: "ignore" },
    );
    await Promise.race([page.finished, expire(RENDER_TIMEOUT_MS)]);
    if (page.stills.length !== job.times.length) {
      throw new RenderError(
        "renderFailed",
        `asked for ${job.times.length} pictures and got ${page.stills.length}`,
      );
    }
    return page.stills;
  } finally {
    if (browser !== undefined) stop(browser);
    page.close();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

function expire(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new RenderError("renderTimeout", `the renderer took longer than ${ms} ms`)),
      ms,
      // Unreferenced, or the loser of the race holds the process open for the full timeout after a
      // render that finished in seconds.
    ).unref();
  });
}
