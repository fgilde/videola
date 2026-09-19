import { describe, expect, it } from "vitest";

import type { Destination } from "./destinations";
import { publish, type Fetch } from "./publish";

const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * A recorder in the shape of `fetch`.
 *
 * Every one of these publishers is an HTTP conversation, so what has to be checked is the
 * conversation: which URL, which method, which headers, and what was in the body. Against the real
 * YouTube none of it could be checked at all -- it needs an account, a quota and a video nobody
 * wanted uploaded.
 */
function recorder(answers: readonly Response[]): { http: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const http = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: init?.body,
    });
    const answer = answers[index];
    index += 1;
    if (answer === undefined) throw new Error(`no answer prepared for ${String(input)}`);
    return answer;
  }) as Fetch;
  return { http, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function destination(over: Partial<Destination>): Destination {
  return {
    id: "dst_1",
    kind: "youtube",
    name: "Mein Kanal",
    secrets: { clientId: "id", clientSecret: "secret", refreshToken: "refresh" },
    settings: {},
    created: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("publishing to YouTube", () => {
  it("trades the refresh token for an access token, opens a session, and sends the bytes", async () => {
    const { http, calls } = recorder([
      json({ access_token: "at_1" }),
      json({}, 200, { location: "https://upload.example/session" }),
      json({ id: "vid_9" }),
    ]);

    const result = await publish(
      { destination: destination({}), bytes: BYTES, title: "Sommer", description: "Ein Test" },
      http,
    );

    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0]?.body)).toContain("grant_type=refresh_token");
    // The refresh token goes to Google and nowhere else.
    expect(String(calls[0]?.body)).toContain("refresh_token=refresh");

    expect(calls[1]?.url).toContain("uploadType=resumable");
    expect(calls[1]?.headers.authorization).toBe("Bearer at_1");
    // The length is announced before a byte is sent, which is what makes the session resumable.
    expect(calls[1]?.headers["x-upload-content-length"]).toBe("8");
    expect(String(calls[1]?.body)).toContain("Sommer");

    expect(calls[2]?.url).toBe("https://upload.example/session");
    expect(calls[2]?.method).toBe("PUT");
    expect(calls[2]?.body).toBe(BYTES);

    expect(result).toEqual({ id: "vid_9", url: "https://www.youtube.com/watch?v=vid_9" });
  });

  // The one default in this file that is a safety decision rather than a convenience: a mistake that
  // publishes somebody's rough cut to the world cannot be taken back by an undo.
  it("uploads privately unless the destination says otherwise", async () => {
    const { http, calls } = recorder([
      json({ access_token: "at" }),
      json({}, 200, { location: "https://upload.example/s" }),
      json({ id: "v" }),
    ]);

    await publish({ destination: destination({}), bytes: BYTES, title: "Roh" }, http);

    expect(String(calls[1]?.body)).toContain('"privacyStatus":"private"');

    const chosen = recorder([
      json({ access_token: "at" }),
      json({}, 200, { location: "https://upload.example/s" }),
      json({ id: "v" }),
    ]);
    await publish(
      {
        destination: destination({ settings: { privacyStatus: "public", tags: "reise, sommer" } }),
        bytes: BYTES,
        title: "Fertig",
      },
      chosen.http,
    );

    expect(String(chosen.calls[1]?.body)).toContain('"privacyStatus":"public"');
    expect(String(chosen.calls[1]?.body)).toContain('"tags":["reise","sommer"]');
  });

  it("says what the platform said when it refuses", async () => {
    const { http } = recorder([json({ error: "invalid_grant" }, 400)]);

    await expect(
      publish({ destination: destination({}), bytes: BYTES, title: "Sommer" }, http),
    ).rejects.toThrow(/invalid_grant/);
  });

  it("refuses to pretend an upload happened when no session came back", async () => {
    const { http } = recorder([json({ access_token: "at" }), json({}, 200)]);

    await expect(
      publish({ destination: destination({}), bytes: BYTES, title: "Sommer" }, http),
    ).rejects.toThrow(/no upload session/);
  });
});

describe("publishing to Vimeo", () => {
  it("asks for an upload link and sends the bytes at it", async () => {
    const { http, calls } = recorder([
      json({ uri: "/videos/771", upload: { upload_link: "https://tus.example/771" } }),
      // 200 rather than the 204 tus really answers with: undici refuses to build a body-less
      // Response here, and what this checks is the conversation, not the status code.
      new Response("", { status: 200 }),
    ]);

    const result = await publish(
      {
        destination: destination({ kind: "vimeo", secrets: { accessToken: "pat" } }),
        bytes: BYTES,
        title: "Sommer",
      },
      http,
    );

    expect(calls[0]?.headers.authorization).toBe("Bearer pat");
    expect(String(calls[0]?.body)).toContain('"size":8');
    expect(calls[1]?.url).toBe("https://tus.example/771");
    expect(calls[1]?.headers["upload-offset"]).toBe("0");
    expect(result).toEqual({ id: "771", url: "https://vimeo.com/771" });
  });
});

// The instance kinds. Neither of these asks anybody's permission -- one is free software on
// somebody's own machine, the other a network with no gatekeeper -- which is the reason they are
// here at all.
describe("publishing to a PeerTube instance", () => {
  it("posts the file to the instance with the channel and a privacy it was given", async () => {
    const { http, calls } = recorder([json({ video: { uuid: "uuid-1", shortUUID: "short1" } })]);

    const result = await publish(
      {
        destination: destination({
          kind: "peertube",
          secrets: { accessToken: "tok" },
          settings: { instance: "tube.example.org", channelId: "7", privacy: "1" },
        }),
        bytes: BYTES,
        title: "Sommer",
      },
      http,
    );

    expect(calls[0]?.url).toBe("https://tube.example.org/api/v1/videos/upload");
    expect(calls[0]?.headers.authorization).toBe("Bearer tok");
    const form = calls[0]?.body as FormData;
    expect(form.get("name")).toBe("Sommer");
    expect(form.get("channelId")).toBe("7");
    expect(form.get("privacy")).toBe("1");
    expect(result).toEqual({ id: "short1", url: "https://tube.example.org/w/short1" });
  });

  // Somebody types the host, not a URL, and a destination that only worked with the scheme typed
  // would fail at the moment a finished video is waiting on it.
  it("takes an instance typed without a scheme, and one with a trailing slash", async () => {
    const { http, calls } = recorder([json({ video: { uuid: "u" } }), json({ video: { uuid: "u" } })]);
    const send = (instance: string) =>
      publish(
        {
          destination: destination({
            kind: "peertube",
            secrets: { accessToken: "tok" },
            settings: { instance },
          }),
          bytes: BYTES,
          title: "Sommer",
        },
        http,
      );

    await send("tube.example.org/");
    await send("http://tube.example.org");

    expect(calls.map((call) => call.url)).toEqual([
      "https://tube.example.org/api/v1/videos/upload",
      "http://tube.example.org/api/v1/videos/upload",
    ]);
  });

  // Private unless the destination says otherwise, the rule every publisher here follows.
  it("uploads privately where nothing says otherwise", async () => {
    const { http, calls } = recorder([json({ video: { uuid: "u" } })]);

    await publish(
      {
        destination: destination({
          kind: "peertube",
          secrets: { accessToken: "tok" },
          settings: { instance: "tube.example.org" },
        }),
        bytes: BYTES,
        title: "Sommer",
      },
      http,
    );

    expect((calls[0]?.body as FormData).get("privacy")).toBe("3");
  });
});

describe("publishing to a Mastodon instance", () => {
  it("uploads the file and then posts it, with the media it just made", async () => {
    const { http, calls } = recorder([
      json({ id: "media_1" }),
      json({ id: "status_1", url: "https://chaos.social/@me/1" }),
    ]);

    const result = await publish(
      {
        destination: destination({
          kind: "mastodon",
          secrets: { accessToken: "tok" },
          settings: { instance: "chaos.social", visibility: "unlisted" },
        }),
        bytes: BYTES,
        title: "Sommer",
        description: "Ein Schnitt",
      },
      http,
    );

    expect(calls[0]?.url).toBe("https://chaos.social/api/v2/media");
    expect(calls[1]?.url).toBe("https://chaos.social/api/v1/statuses");
    const posted = JSON.parse(String(calls[1]?.body)) as Record<string, unknown>;
    expect(posted.media_ids).toEqual(["media_1"]);
    expect(posted.visibility).toBe("unlisted");
    expect(posted.status).toBe("Sommer\n\nEin Schnitt");
    expect(result).toEqual({ id: "status_1", url: "https://chaos.social/@me/1" });
  });

  // 202 is "still transcoding". Posting then attaches a media the instance has not finished with,
  // which is a post with nothing in it.
  it("waits for a file the instance is still transcoding", async () => {
    const { http, calls } = recorder([
      json({ id: "media_1" }, 202),
      json({ id: "media_1" }, 200),
      json({ id: "status_1" }),
    ]);

    await publish(
      {
        destination: destination({
          kind: "mastodon",
          secrets: { accessToken: "tok" },
          settings: { instance: "chaos.social" },
        }),
        bytes: BYTES,
        title: "Sommer",
      },
      http,
    );

    expect(calls[1]?.url).toBe("https://chaos.social/api/v1/media/media_1");
    expect(calls[2]?.url).toBe("https://chaos.social/api/v1/statuses");
  });
});

describe("publishing to Bluesky", () => {
  it("opens a session, takes a token for the video service, uploads and posts", async () => {
    const { http, calls } = recorder([
      json({ accessJwt: "jwt", did: "did:plc:me" }),
      json({ token: "service-jwt" }),
      json({ jobStatus: { jobId: "job_1" } }),
      json({ jobStatus: { state: "JOB_STATE_COMPLETED", blob: { $type: "blob", ref: "r" } } }),
      json({ uri: "at://did:plc:me/app.bsky.feed.post/3kabc" }),
    ]);

    const result = await publish(
      {
        destination: destination({
          kind: "bluesky",
          secrets: { appPassword: "abcd-efgh" },
          settings: { handle: "me.bsky.social" },
        }),
        bytes: BYTES,
        title: "Sommer",
      },
      http,
    );

    expect(calls[0]?.url).toBe("https://bsky.social/xrpc/com.atproto.server.createSession");
    expect(JSON.parse(String(calls[0]?.body)).password).toBe("abcd-efgh");
    expect(calls[1]?.url).toContain("com.atproto.server.getServiceAuth");
    expect(calls[2]?.url).toContain("app.bsky.video.uploadVideo");
    expect(calls[2]?.headers.authorization).toBe("Bearer service-jwt");
    const record = JSON.parse(String(calls[4]?.body)) as {
      record: { embed: { video: unknown; $type: string } };
    };
    expect(record.record.embed.$type).toBe("app.bsky.embed.video");
    expect(record.record.embed.video).toEqual({ $type: "blob", ref: "r" });
    expect(result.url).toBe("https://bsky.app/profile/me.bsky.social/post/3kabc");
  });

  // A video the service could not process is not a post with a hole in it.
  it("stops where the video service gives up", async () => {
    const { http } = recorder([
      json({ accessJwt: "jwt", did: "did:plc:me" }),
      json({ token: "service-jwt" }),
      json({ jobStatus: { jobId: "job_1" } }),
      json({ jobStatus: { state: "JOB_STATE_FAILED", error: "too long" } }),
    ]);

    await expect(
      publish(
        {
          destination: destination({
            kind: "bluesky",
            secrets: { appPassword: "abcd-efgh" },
            settings: { handle: "me.bsky.social" },
          }),
          bytes: BYTES,
          title: "Sommer",
        },
        http,
      ),
    ).rejects.toThrow(/too long/);
  });
});

describe("publishing to a Telegram chat", () => {
  it("sends the video to the chat the destination names", async () => {
    const { http, calls } = recorder([json({ result: { message_id: 42 } })]);

    const result = await publish(
      {
        destination: destination({
          kind: "telegram",
          secrets: { botToken: "123:abc" },
          settings: { chatId: "-100999" },
        }),
        bytes: BYTES,
        title: "Sommer",
      },
      http,
    );

    expect(calls[0]?.url).toBe("https://api.telegram.org/bot123:abc/sendVideo");
    expect((calls[0]?.body as FormData).get("chat_id")).toBe("-100999");
    expect(result).toEqual({ id: "42" });
  });
});

describe("publishing to a Facebook Page", () => {
  it("posts the file to the Page, unpublished unless it was told otherwise", async () => {
    const { http, calls } = recorder([json({ id: "1234" })]);

    const result = await publish(
      {
        destination: destination({
          kind: "facebook",
          secrets: { pageToken: "page-tok" },
          settings: { pageId: "99" },
        }),
        bytes: BYTES,
        title: "Sommer",
      },
      http,
    );

    expect(calls[0]?.url).toBe("https://graph.facebook.com/v21.0/99/videos");
    const form = calls[0]?.body as FormData;
    expect(form.get("published")).toBe("false");
    expect(form.get("access_token")).toBe("page-tok");
    expect(result.id).toBe("1234");
  });
});

describe("publishing to anywhere else", () => {
  it("posts the file as a form, with the headers the destination carries", async () => {
    const { http, calls } = recorder([json({ id: "abc", url: "https://mine.example/v/abc" })]);

    const result = await publish(
      {
        destination: destination({
          kind: "webhook",
          secrets: { url: "https://mine.example/upload" },
          settings: { "header.x-api-key": "k1", privacy: "ignored here" },
        }),
        bytes: BYTES,
        title: "Mein Film",
      },
      http,
    );

    expect(calls[0]?.url).toBe("https://mine.example/upload");
    expect(calls[0]?.headers["x-api-key"]).toBe("k1");
    // Only the settings that name a header become one.
    expect(calls[0]?.headers.privacy).toBeUndefined();
    const form = calls[0]?.body as FormData;
    expect(form.get("title")).toBe("Mein Film");
    expect((form.get("file") as File).name).toBe("Mein-Film.mp4");
    expect(result).toEqual({ id: "abc", url: "https://mine.example/v/abc" });
  });

  // A webhook that answers with a receipt in plain text is a webhook, not a fault.
  it("takes an answer that is not JSON without complaining", async () => {
    const { http } = recorder([new Response("thanks", { status: 200 })]);

    const result = await publish(
      {
        destination: destination({ kind: "webhook", secrets: { url: "https://mine.example/u" } }),
        bytes: BYTES,
        title: "Ohne Antwort",
      },
      http,
    );

    expect(result).toEqual({});
  });
});
