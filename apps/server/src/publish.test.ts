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
