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
    case "peertube":
      return await toPeerTube(request, http);
    case "mastodon":
      return await toMastodon(request, http);
    case "bluesky":
      return await toBluesky(request, http);
    case "telegram":
      return await toTelegram(request, http);
    case "facebook":
      return await toFacebook(request, http);
    case "webhook":
      return await toWebhook(request, http);
  }
}

/**
 * PeerTube: one multipart POST, and the only destination here that asks nobody's permission.
 *
 * The instance is somebody's own machine running free software, so there is no application to
 * register, no review and no quota -- which makes it the one place a video editor under the GPL can
 * send a video without a company in the middle.
 */
async function toPeerTube(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const { secrets, settings } = request.destination;
  const instance = instanceUrl(settings.instance);
  const form = new FormData();
  form.set("name", request.title);
  if (request.description !== undefined) form.set("description", request.description);
  if (settings.channelId !== undefined) form.set("channelId", settings.channelId);
  // Private unless the destination says otherwise, the same default every publisher here takes: a
  // mistake that puts a rough cut in front of the world cannot be taken back by an undo.
  form.set("privacy", settings.privacy ?? "3");
  form.set("videofile", videoBlob(request), `${safeName(request.title)}.mp4`);

  const sent = await http(`${instance}/api/v1/videos/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${secrets.accessToken ?? ""}` },
    body: form,
  });
  if (!sent.ok) throw new Error(`peertube refused the video: ${await said(sent)}`);
  const created = (await sent.json()) as { video?: { uuid?: string; shortUUID?: string } };
  const uuid = created.video?.shortUUID ?? created.video?.uuid;
  if (uuid === undefined) return {};
  return { id: uuid, url: `${instance}/w/${uuid}` };
}

/**
 * Mastodon: the file, then the post that carries it.
 *
 * Two requests and a wait between them -- the instance transcodes, and a status naming a media id
 * the instance has not finished with is a status with nothing attached.
 */
async function toMastodon(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const { secrets, settings } = request.destination;
  const instance = instanceUrl(settings.instance);
  const auth = { authorization: `Bearer ${secrets.accessToken ?? ""}` };
  const form = new FormData();
  form.set("file", videoBlob(request), `${safeName(request.title)}.mp4`);
  if (request.description !== undefined) form.set("description", request.description);

  const uploaded = await http(`${instance}/api/v2/media`, {
    method: "POST",
    headers: auth,
    body: form,
  });
  if (!uploaded.ok) throw new Error(`mastodon refused the file: ${await said(uploaded)}`);
  const media = (await uploaded.json()) as { id?: string };
  if (media.id === undefined) throw new Error("mastodon returned no media id");
  // 202 means "still transcoding": the media exists, and attaching it now posts an empty status.
  // Asked for rather than slept through, so a fast instance costs nothing.
  if (uploaded.status === 202) await settled(`${instance}/api/v1/media/${media.id}`, auth, http);

  const posted = await http(`${instance}/api/v1/statuses`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      status: caption(request),
      media_ids: [media.id],
      visibility: settings.visibility ?? "private",
    }),
  });
  if (!posted.ok) throw new Error(`mastodon refused the post: ${await said(posted)}`);
  const status = (await posted.json()) as { id?: string; url?: string };
  return {
    ...(status.id === undefined ? {} : { id: status.id }),
    ...(status.url === undefined ? {} : { url: status.url }),
  };
}

/**
 * Bluesky: an app password, a token for the video service, the file, and a post.
 *
 * No developer account anywhere -- the app password comes from the account's own settings page,
 * which makes this the shortest setup on the list. The video goes to the network's video service
 * rather than into the repository as a blob, because that is what every client knows how to play.
 */
async function toBluesky(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const { secrets, settings } = request.destination;
  const service = instanceUrl(settings.service ?? "https://bsky.social");
  const opened = await http(`${service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: settings.handle ?? "",
      password: secrets.appPassword ?? "",
    }),
  });
  if (!opened.ok) throw new Error(`bluesky refused the app password: ${await said(opened)}`);
  const account = (await opened.json()) as { accessJwt?: string; did?: string };
  if (account.accessJwt === undefined || account.did === undefined) {
    throw new Error("bluesky returned no session");
  }

  // The video service is a different audience than the account's own server, so it takes a token of
  // its own -- issued by that server, for that one method.
  const granted = await http(
    `${service}/xrpc/com.atproto.server.getServiceAuth?aud=did:web:video.bsky.app` +
      `&lxm=app.bsky.video.uploadVideo`,
    { headers: { authorization: `Bearer ${account.accessJwt}` } },
  );
  if (!granted.ok) throw new Error(`bluesky refused a video token: ${await said(granted)}`);
  const issued = (await granted.json()) as { token?: string };
  if (issued.token === undefined) throw new Error("bluesky returned no video token");

  const name = `${safeName(request.title)}.mp4`;
  const upload = await http(
    `https://video.bsky.app/xrpc/app.bsky.video.uploadVideo` +
      `?did=${encodeURIComponent(account.did)}&name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${issued.token}`,
        "content-type": request.contentType ?? "video/mp4",
      },
      body: request.bytes as unknown as BodyInit,
    },
  );
  if (!upload.ok) throw new Error(`bluesky rejected the video: ${await said(upload)}`);
  const job = (await upload.json()) as { jobStatus?: { jobId?: string; blob?: unknown } };
  const blob = await processed(job.jobStatus, http);

  const posted = await http(`${service}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${account.accessJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      repo: account.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        // Three hundred graphemes is the whole post, so the title leads and the description
        // follows it for as far as there is room.
        text: caption(request).slice(0, 300),
        createdAt: new Date().toISOString(),
        embed: { $type: "app.bsky.embed.video", video: blob },
      },
    }),
  });
  if (!posted.ok) throw new Error(`bluesky refused the post: ${await said(posted)}`);
  const record = (await posted.json()) as { uri?: string };
  const rkey = record.uri?.split("/").pop();
  const handle = settings.handle ?? account.did;
  return {
    ...(record.uri === undefined ? {} : { id: record.uri }),
    ...(rkey === undefined ? {} : { url: `https://bsky.app/profile/${handle}/post/${rkey}` }),
  };
}

/**
 * Telegram: one request to a bot.
 *
 * The shortest publisher here, and the one that answers "send it to the team" rather than "publish
 * it to the world": a chat id is a person, a group or a channel, and the bot has to be in it.
 */
async function toTelegram(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const { secrets, settings } = request.destination;
  const form = new FormData();
  form.set("chat_id", settings.chatId ?? "");
  form.set("caption", caption(request).slice(0, 1024));
  form.set("video", videoBlob(request), `${safeName(request.title)}.mp4`);

  const sent = await http(`https://api.telegram.org/bot${secrets.botToken ?? ""}/sendVideo`, {
    method: "POST",
    body: form,
  });
  if (!sent.ok) throw new Error(`telegram refused the video: ${await said(sent)}`);
  const answer = (await sent.json()) as { result?: { message_id?: number } };
  const id = answer.result?.message_id;
  return id === undefined ? {} : { id: String(id) };
}

/** A Facebook Page, with that Page's own token: the Graph API takes the file in one form. */
async function toFacebook(request: PublishRequest, http: Fetch): Promise<PublishResult> {
  const { secrets, settings } = request.destination;
  const form = new FormData();
  form.set("title", request.title);
  if (request.description !== undefined) form.set("description", request.description);
  // Unpublished unless the destination says otherwise, for the same reason every other default
  // here is private.
  form.set("published", settings.published ?? "false");
  form.set("access_token", secrets.pageToken ?? "");
  form.set("source", videoBlob(request), `${safeName(request.title)}.mp4`);

  const sent = await http(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(settings.pageId ?? "me")}/videos`,
    { method: "POST", body: form },
  );
  if (!sent.ok) throw new Error(`facebook refused the video: ${await said(sent)}`);
  const created = (await sent.json()) as { id?: string };
  return created.id === undefined
    ? {}
    : { id: created.id, url: `https://www.facebook.com/${created.id}` };
}

// An instance address as a base URL: typed with or without a scheme, and never with a trailing
// slash. Somebody types "chaos.social", and a destination that only worked when they typed the
// scheme would be a destination that fails at the moment a video is waiting.
function instanceUrl(raw: string | undefined): string {
  const given = (raw ?? "").trim().replace(/\/+$/, "");
  if (given === "") return "";
  return /^https?:\/\//.test(given) ? given : `https://${given}`;
}

function videoBlob(request: PublishRequest): Blob {
  return new Blob([request.bytes as unknown as BlobPart], {
    type: request.contentType ?? "video/mp4",
  });
}

// What the post says, where the platform is one that posts rather than one that hosts.
function caption(request: PublishRequest): string {
  return [request.title, request.description].filter((line) => line !== undefined && line !== "").join("\n\n");
}

/** Mastodon answers 202 while it is still transcoding and 200 once the file can be attached. */
async function settled(
  url: string,
  auth: Record<string, string>,
  http: Fetch,
  tries = 30,
): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const asked = await http(url, { headers: auth });
    if (asked.status === 200) return;
    if (!asked.ok) throw new Error(`mastodon lost the file: ${await said(asked)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("mastodon is still transcoding after a minute");
}

/** The video service answers with a job; the blob it becomes is what a post can carry. */
async function processed(
  status: { jobId?: string; blob?: unknown } | undefined,
  http: Fetch,
  tries = 60,
): Promise<unknown> {
  if (status?.blob !== undefined) return status.blob;
  const jobId = status?.jobId;
  if (jobId === undefined) throw new Error("bluesky returned no upload job");
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const asked = await http(
      `https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(jobId)}`,
    );
    if (!asked.ok) throw new Error(`bluesky lost the upload: ${await said(asked)}`);
    const job = (await asked.json()) as {
      jobStatus?: { state?: string; blob?: unknown; error?: string };
    };
    if (job.jobStatus?.blob !== undefined) return job.jobStatus.blob;
    if (job.jobStatus?.state === "JOB_STATE_FAILED") {
      throw new Error(
        `bluesky could not process the video: ${job.jobStatus.error ?? "no reason given"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("bluesky is still processing the video after two minutes");
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
