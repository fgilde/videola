import type { Destination } from "./destinations";

/**
 * Sending a finished video somewhere, per kind of destination.
 *
 * Every one of these is an HTTP conversation and nothing else — no SDK, no client library, no OAuth
 * dance in a browser window. That is a decision worth stating: Google's own client library is a great
 * many megabytes of transitive dependencies to make three requests this file makes in twenty lines,
 * and it would take the server's ability to run offline with it. What the account holder pastes in
 * once is what Google's own flow would have written anyway.
 *
 * `fetch` is injected so the checks can watch what would go over the wire. A publisher that could
 * only be tested against the real YouTube is a publisher nobody tests.
 */
export interface PublishRequest {
  destination: Destination;
  bytes: Uint8Array;
  title: string;
  description?: string;
  /** MP4 unless somebody exported WebM, which both platforms take as happily. */
  contentType?: string;
}

export interface PublishResult {
  /** What the platform calls it now: a YouTube video id, a Vimeo id, or whatever a webhook says. */
  id?: string;
  /** Where a person can go and look at it. */
  url?: string;
}

export type Fetch = typeof fetch;

export async function publish(request: PublishRequest, http: Fetch = fetch): Promise<PublishResult> {
  switch (request.destination.kind) {
    case "youtube":
      return await toYouTube(request, http);
    case "vimeo":
      return await toVimeo(request, http);
    case "webhook":
      return await toWebhook(request, http);
  }
}

/**
 * YouTube, in three requests: a token, a resumable session, and the bytes.
 *
 * Resumable rather than one multipart POST even though the whole file is in memory here: the simple
 * endpoint refuses anything past a handful of megabytes, and a video is not that. What this does not
 * do is resume — an interrupted upload starts again. The session URL would have to outlive the
 * request for that, which is a job queue, and a job queue is a different feature.
 */
async function toYouTube(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const { secrets, settings } = request.destination;
  const token = await accessToken(secrets, http);

  const metadata = {
    snippet: {
      title: request.title,
      description: request.description ?? "",
      ...(settings.categoryId === undefined ? {} : { categoryId: settings.categoryId }),
      ...(settings.tags === undefined
        ? {}
        : {
            tags: settings.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter((tag) => tag !== ""),
          }),
    },
    // Private unless the destination says otherwise, and that default is deliberate: a mistake that
    // publishes somebody's rough cut to the world cannot be taken back by an undo.
    status: { privacyStatus: settings.privacyStatus ?? "private" },
  };

  const opened = await http(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-upload-content-type": request.contentType ?? "video/mp4",
        "x-upload-content-length": String(request.bytes.length),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!opened.ok) throw new Error(`youtube refused the upload: ${await said(opened)}`);
  const session = opened.headers.get("location");
  if (session === null) throw new Error("youtube opened no upload session");

  const sent = await http(session, {
    method: "PUT",
    headers: {
      "content-type": request.contentType ?? "video/mp4",
      "content-length": String(request.bytes.length),
    },
    body: request.bytes as unknown as BodyInit,
  });
  if (!sent.ok) throw new Error(`youtube rejected the video: ${await said(sent)}`);
  const created = (await sent.json()) as { id?: string };
  if (created.id === undefined) return {};
  return { id: created.id, url: `https://www.youtube.com/watch?v=${created.id}` };
}

/** A refresh token is what the account holder pasted; an access token is what expires in an hour. */
async function accessToken(
  secrets: Readonly<Record<string, string>>,
  http: Fetch,
): Promise<string> {
  const answer = await http("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: secrets.clientId ?? "",
      client_secret: secrets.clientSecret ?? "",
      refresh_token: secrets.refreshToken ?? "",
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!answer.ok) throw new Error(`google refused the refresh token: ${await said(answer)}`);
  const token = (await answer.json()) as { access_token?: string };
  if (token.access_token === undefined) throw new Error("google returned no access token");
  return token.access_token;
}

/** Vimeo: ask for an upload link, then send the bytes at it. tus, but only the one-shot half. */
async function toVimeo(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const created = await http("https://api.vimeo.com/me/videos", {
    method: "POST",
    headers: {
      authorization: `Bearer ${request.destination.secrets.accessToken ?? ""}`,
      "content-type": "application/json",
      accept: "application/vnd.vimeo.*+json;version=3.4",
    },
    body: JSON.stringify({
      upload: { approach: "tus", size: request.bytes.length },
      name: request.title,
      description: request.description ?? "",
      // Nobody but the account holder, unless the destination says otherwise. Same reason as above.
      privacy: { view: request.destination.settings.privacy ?? "nobody" },
    }),
  });
  if (!created.ok) throw new Error(`vimeo refused the upload: ${await said(created)}`);
  const video = (await created.json()) as { uri?: string; upload?: { upload_link?: string } };
  const link = video.upload?.upload_link;
  if (link === undefined) throw new Error("vimeo opened no upload link");

  const sent = await http(link, {
    method: "PATCH",
    headers: {
      "tus-resumable": "1.0.0",
      "upload-offset": "0",
      "content-type": "application/offset+octet-stream",
    },
    body: request.bytes as unknown as BodyInit,
  });
  if (!sent.ok) throw new Error(`vimeo rejected the video: ${await said(sent)}`);
  const id = video.uri?.split("/").pop();
  if (id === undefined) return {};
  return { id, url: `https://vimeo.com/${id}` };
}

/**
 * Anywhere else: the file as a multipart form, with the title and the description beside it.
 *
 * The shape every uploader on the web already understands, so a destination that is "my own site" or
 * "a script on the NAS" needs nothing written here. Extra headers come from the destination's own
 * settings, because that is where an API key belongs when the platform wants one.
 */
async function toWebhook(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const form = new FormData();
  form.set("title", request.title);
  if (request.description !== undefined) form.set("description", request.description);
  form.set(
    "file",
    new Blob([request.bytes as unknown as BlobPart], {
      type: request.contentType ?? "video/mp4",
    }),
    `${safeName(request.title)}.mp4`,
  );

  const answer = await http(request.destination.secrets.url ?? "", {
    method: "POST",
    headers: headersFrom(request.destination.settings),
    body: form,
  });
  if (!answer.ok) throw new Error(`the destination refused the video: ${await said(answer)}`);
  const text = await answer.text();
  const parsed = looksLikeJson(text) ? (JSON.parse(text) as { id?: string; url?: string }) : {};
  return {
    ...(parsed.id === undefined ? {} : { id: parsed.id }),
    ...(parsed.url === undefined ? {} : { url: parsed.url }),
  };
}

// A setting named `header.<name>` becomes a header. A setting rather than a secret, because a header
// somebody wants to read back while working out a 401 is not a token — and the ones that are tokens
// belong in the URL a signer handed out, which is a secret here and is treated as one.
function headersFrom(settings: Readonly<Record<string, string>>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("header.")) headers[key.slice("header.".length)] = value;
  }
  return headers;
}

function safeName(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned === "" ? "video" : cleaned.slice(0, 60);
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

// What a platform said when it refused, trimmed: the whole body of a Google error is a page of JSON,
// and the part that helps is at the front of it.
async function said(answer: Response): Promise<string> {
  const text = await answer.text().catch(() => "");
  return `${answer.status} ${text.slice(0, 300)}`;
}
