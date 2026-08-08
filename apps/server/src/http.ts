import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";

import type { Command } from "@videola/core";

import { Api, ApiError } from "./api";
import { COMMAND_CATALOG } from "./generated/commandCatalog";

export interface HttpOptions {
  readonly api: Api;
  readonly token?: string | undefined;
  readonly maxBodyBytes?: number;
}

// 512 MiB matches the per-entry cap the `.videola` reader applies to a media entry, so an upload
// the server accepts is one the core can also read back out of an archive.
const DEFAULT_MAX_BODY_BYTES = 512 * 1024 * 1024;

interface Reply {
  status: number;
  body: unknown;
  bytes?: Uint8Array;
  contentType?: string;
}

export function createRequestListener(options: HttpOptions): RequestListener {
  const { api } = options;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return (request, response) => {
    void handle(request, response).catch((error: unknown) => {
      send(response, { status: 500, body: { error: { code: "internal", message: text(error) } } });
    });
  };

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!authorised(request, options.token)) {
      send(response, {
        status: 401,
        body: { error: { code: "unauthorised", message: "a bearer token is required" } },
      });
      return;
    }
    try {
      send(response, await route(request, api, maxBodyBytes));
    } catch (error) {
      send(response, errorReply(error));
    }
  }
}

// Constant-time so a wrong token cannot be recovered one byte at a time from response timings.
// Lengths are compared first because `timingSafeEqual` throws on a mismatch — that comparison
// leaks only the length, which a client already knows about its own token.
function authorised(request: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined || token === "") return true;
  const offered = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
  const a = Buffer.from(offered);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function route(
  request: IncomingMessage,
  api: Api,
  maxBodyBytes: number,
): Promise<Reply> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter((part) => part !== "");
  const method = request.method ?? "GET";
  const body = async () => readJson(request, maxBodyBytes);

  if (segments[0] !== "api") return notFound();

  if (match(segments, ["api", "health"]) && method === "GET") {
    return { status: 200, body: { ok: true, storageRoot: await api.storage().root() } };
  }
  if (match(segments, ["api", "schema"]) && method === "GET") {
    return { status: 200, body: { commands: COMMAND_CATALOG } };
  }
  if (match(segments, ["api", "projects"])) {
    if (method === "GET") return { status: 200, body: { projects: api.list() } };
    if (method === "POST") return { status: 201, body: await createProject(api, await body()) };
    return notFound();
  }

  const id = segments[2];
  if (segments[0] !== "api" || segments[1] !== "projects" || id === undefined) return notFound();
  const action = segments[3];

  if (action === undefined) {
    if (method === "GET") {
      return { status: 200, body: { ...api.view(id), project: api.state(id) } };
    }
    if (method === "DELETE") {
      api.close(id);
      return { status: 200, body: { closed: id } };
    }
    return notFound();
  }
  if (action === "commands" && method === "POST") {
    const payload = asObject(await body());
    return { status: 200, body: api.apply(id, commandsOf(payload), revisionOf(payload)) };
  }
  if (action === "undo" && method === "POST") return { status: 200, body: api.undo(id) };
  if (action === "redo" && method === "POST") return { status: 200, body: api.redo(id) };
  if (action === "describe" && method === "GET") {
    return { status: 200, body: { description: api.describe(id) } };
  }
  if (action === "validate" && method === "GET") {
    return { status: 200, body: { findings: api.validate(id) } };
  }
  if (action === "frame" && method === "GET") {
    // One picture, as a picture: an agent or a browser that follows this URL gets something it can
    // look at, not base64 in a JSON envelope. The MCP tool is the one that renders several at once.
    const [png] = await api.frames(id, [flicksParam(url, "at")], numberParam(url, "width"));
    return { status: 200, body: undefined, bytes: png, contentType: "image/png" };
  }
  if (action === "peaks" && method === "GET") {
    const peaks = await api.audioPeaks(
      id,
      flicksParam(url, "from"),
      flicksParam(url, "to"),
      numberParam(url, "buckets"),
    );
    return { status: 200, body: peaks };
  }
  if (action === "media" && method === "POST") {
    return { status: 201, body: { mediaId: await importMedia(api, id, request, url, maxBodyBytes) } };
  }
  if (action === "file") {
    if (method === "GET") {
      return {
        status: 200,
        body: undefined,
        bytes: api.archive(id),
        contentType: "application/zip",
      };
    }
    if (method === "PUT") {
      const payload = asObject(await body());
      return { status: 200, body: await api.savePath(id, stringField(payload, "path")) };
    }
  }
  return notFound();
}

function flicksParam(url: URL, name: string): number {
  const raw = url.searchParams.get(name);
  if (raw === null) throw new ApiError(400, "badRequest", `${name} is required`);
  return integer(raw, name);
}

function numberParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  return raw === null ? undefined : integer(raw, name);
}

function integer(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ApiError(400, "badRequest", `${name} must be a whole number, not ${raw}`);
  }
  return value;
}

async function createProject(api: Api, payload: unknown): Promise<unknown> {
  const fields = asObject(payload);
  const path = fields["path"];
  if (path === undefined || path === null) return api.create();
  if (typeof path !== "string") {
    throw new ApiError(400, "badRequest", "path must be a string");
  }
  return api.openPath(path);
}

// Bytes come as the raw body rather than in JSON: base64 in a JSON field would inflate a video by
// a third and force the whole thing through a string before the core ever sees it. The name and
// type ride along in the query string, where they cost nothing.
async function importMedia(
  api: Api,
  id: string,
  request: IncomingMessage,
  url: URL,
  maxBodyBytes: number,
): Promise<string> {
  const path = url.searchParams.get("path");
  if (path !== null) {
    return api.importPath(id, path, url.searchParams.get("mime") ?? undefined);
  }
  const name = url.searchParams.get("name");
  const mime = url.searchParams.get("mime");
  if (name === null || mime === null) {
    throw new ApiError(400, "badRequest", "give either ?path= or both ?name= and ?mime=");
  }
  return api.importBytes(id, name, mime, await readBytes(request, maxBodyBytes));
}

function commandsOf(payload: Record<string, unknown>): readonly Command[] {
  const commands = payload["commands"] ?? (payload["command"] === undefined ? undefined : [payload["command"]]);
  if (!Array.isArray(commands)) {
    throw new ApiError(400, "badRequest", "expected a `command` object or a `commands` array");
  }
  return commands as readonly Command[];
}

function revisionOf(payload: Record<string, unknown>): number | undefined {
  const value = payload["ifRevision"];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ApiError(400, "badRequest", "ifRevision must be an integer");
  }
  return value;
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value === "") {
    throw new ApiError(400, "badRequest", `${key} must be a non-empty string`);
  }
  return value;
}

function asObject(payload: unknown): Record<string, unknown> {
  if (payload === undefined) return {};
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ApiError(400, "badRequest", "expected a JSON object");
  }
  return payload as Record<string, unknown>;
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const bytes = await readBytes(request, maxBodyBytes);
  if (bytes.byteLength === 0) return undefined;
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new ApiError(400, "badJson", text(error));
  }
}

// Counted while the chunks arrive rather than trusting Content-Length: a request may send more
// than it declares, or declare nothing at all, and either way the process must not grow without
// bound before anyone checks.
async function readBytes(request: IncomingMessage, maxBodyBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > maxBodyBytes) {
      request.destroy();
      throw new ApiError(413, "bodyTooLarge", `request body exceeds ${maxBodyBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function match(segments: readonly string[], expected: readonly string[]): boolean {
  return segments.length === expected.length && expected.every((part, at) => segments[at] === part);
}

function notFound(): Reply {
  return { status: 404, body: { error: { code: "noSuchRoute", message: "no such route" } } };
}

function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: "internal", message: text(error) } } };
}

function send(response: ServerResponse, reply: Reply): void {
  if (reply.bytes !== undefined) {
    response.writeHead(reply.status, {
      "content-type": reply.contentType ?? "application/octet-stream",
      "content-length": String(reply.bytes.byteLength),
    });
    response.end(Buffer.from(reply.bytes));
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body ?? {}), "utf8");
  response.writeHead(reply.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(payload.byteLength),
  });
  response.end(payload);
}

function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
