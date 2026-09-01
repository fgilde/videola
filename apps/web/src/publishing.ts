/**
 * Talking to a Videola server about where finished videos go.
 *
 * The editor is a browser program that keeps everything locally, and this is the one thing it cannot
 * do alone: an upload to YouTube needs a client secret, and a secret in a browser is not a secret. So
 * the server holds the destinations and does the talking, and this file is the thin half that hands
 * it the bytes.
 *
 * The connection is a URL and a token, kept in `localStorage` because it is a preference of this
 * browser and not a part of any project. Empty by default: an editor opened at videola.app has no
 * server, and offering to publish would be offering something that cannot happen.
 */
const KEY = "videola.publishing";

export interface Connection {
  /** Where the server is. Same origin by default, which is where a self-hosted editor is served. */
  url: string;
  /** What `VIDEOLA_TOKEN` was set to. Sent as a bearer token, kept in this browser and nowhere else. */
  token: string;
}

export interface DestinationSummary {
  id: string;
  kind: "youtube" | "vimeo" | "webhook";
  name: string;
  note?: string;
  settings: Readonly<Record<string, string>>;
  created: string;
  /** Which secrets it holds, by name. The server never says what they are. */
  holds: readonly string[];
}

export interface NewDestination {
  kind: DestinationSummary["kind"];
  name: string;
  note?: string;
  secrets: Record<string, string>;
  settings: Record<string, string>;
}

export function readConnection(): Connection {
  try {
    const held = localStorage.getItem(KEY);
    if (held === null) return { url: "", token: "" };
    const parsed = JSON.parse(held) as Partial<Connection>;
    return { url: parsed.url ?? "", token: parsed.token ?? "" };
  } catch {
    // A browser with storage switched off is a browser without a server connection, not a broken one.
    return { url: "", token: "" };
  }
}

export function writeConnection(connection: Connection): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(connection));
  } catch {
    // Nothing to do about it, and nothing worth stopping for: the connection lasts this session.
  }
}

/** The origin the editor was served from, which is the server itself in a self-hosted install. */
export function sameOrigin(): string {
  return typeof location === "undefined" ? "" : location.origin;
}

export async function listDestinations(
  connection: Connection,
): Promise<readonly DestinationSummary[]> {
  const answer = await call(connection, "/api/destinations");
  const body = (await answer.json()) as { destinations?: DestinationSummary[] };
  return body.destinations ?? [];
}

export async function addDestination(
  connection: Connection,
  given: NewDestination,
): Promise<DestinationSummary> {
  const answer = await call(connection, "/api/destinations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(given),
  });
  return (await answer.json()) as DestinationSummary;
}

export async function removeDestination(connection: Connection, id: string): Promise<void> {
  await call(connection, `/api/destinations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface Published {
  id?: string;
  url?: string;
}

/**
 * The finished video, sent where it was told to go.
 *
 * The bytes travel as the body rather than in a JSON envelope: an export is megabytes, and base64
 * would make it a third bigger for nothing. The title and the description are a line each and go in
 * the query, where a person reading a server log can see what was published without opening a file.
 */
export async function publishVideo(
  connection: Connection,
  destination: string,
  video: { bytes: Uint8Array; title: string; description?: string; mimeType: string },
): Promise<Published> {
  const query = new URLSearchParams({ title: video.title });
  if (video.description !== undefined && video.description !== "") {
    query.set("description", video.description);
  }
  const answer = await call(
    connection,
    `/api/destinations/${encodeURIComponent(destination)}/publish?${query.toString()}`,
    {
      method: "POST",
      headers: { "content-type": video.mimeType },
      body: video.bytes as unknown as BodyInit,
    },
  );
  return (await answer.json()) as Published;
}

async function call(connection: Connection, path: string, init?: RequestInit): Promise<Response> {
  const base = connection.url === "" ? sameOrigin() : connection.url.replace(/\/+$/, "");
  const answer = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(connection.token === "" ? {} : { authorization: `Bearer ${connection.token}` }),
    },
  });
  if (!answer.ok) throw new Error(await reason(answer));
  return answer;
}

// What the server said, not what the browser assumed. A 401 here means the token is wrong, and saying
// so is the difference between a person fixing it in ten seconds and giving up on the feature.
async function reason(answer: Response): Promise<string> {
  const text = await answer.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message !== undefined) return parsed.error.message;
  } catch {
    // Not JSON. The status alone is more useful than a parse error nobody asked about.
  }
  return `${answer.status} ${text.slice(0, 200)}`.trim();
}
