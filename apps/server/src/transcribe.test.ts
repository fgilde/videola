import { describe, expect, it } from "vitest";

import { linesOf, transcribe } from "./transcribe";
import type { Fetch } from "./publish";

function words(pairs: [string, number, number][]): { text: string; start: number; end: number }[] {
  return pairs.map(([text, start, end]) => ({ text, start, end }));
}

describe("turning a transcript into lines worth putting on a timeline", () => {
  // A breath is where a line ends. Without that, a transcript is one paragraph and a lyric video is
  // a wall of text that never changes.
  it("breaks a line where the singer takes a breath", () => {
    const lines = linesOf(
      words([
        ["Standing", 1.0, 1.4],
        ["in", 1.4, 1.5],
        ["the", 1.5, 1.7],
        ["hall", 1.7, 2.0],
        ["of", 2.0, 2.1],
        ["fame", 2.1, 2.6],
        ["And", 4.0, 4.3],
        ["the", 4.3, 4.4],
        ["world's", 4.4, 4.9],
      ]),
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ at: 1000, until: 2600, text: "Standing in the hall of fame" });
    expect(lines[1]?.text).toBe("And the world's");
  });

  // And where nobody takes one: a rap with no gaps in it would otherwise be one line a minute long.
  it("breaks a line that has gone on too long even without a gap", () => {
    const lines = linesOf(
      words(Array.from({ length: 30 }, (_, index) => [`w${index}`, index * 0.3, index * 0.3 + 0.28])),
    );

    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(line.until - line.at).toBeLessThanOrEqual(6300);
      expect(line.text.split(" ").length).toBeLessThanOrEqual(10);
    }
  });

  it("has nothing to say about nothing", () => {
    expect(linesOf([])).toEqual([]);
  });
});

describe("asking ElevenLabs", () => {
  function watched(answer: Response): { http: Fetch; calls: { url: string; headers: Record<string, string>; body: unknown }[] } {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const http = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: String(input),
        headers: { ...((init?.headers ?? {}) as Record<string, string>) },
        body: init?.body,
      });
      return answer;
    }) as Fetch;
    return { http, calls };
  }

  it("sends the audio with the key in a header and the word timings asked for", async () => {
    const { http, calls } = watched(
      new Response(
        JSON.stringify({ words: [{ text: "one", start: 0, end: 0.4 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const lines = await transcribe("k3y", new Uint8Array([1, 2, 3]), { language: "de" }, http);

    expect(calls[0]?.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0]?.headers["xi-api-key"]).toBe("k3y");
    const form = calls[0]?.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v1");
    expect(form.get("timestamps_granularity")).toBe("word");
    expect(form.get("language_code")).toBe("de");
    expect(lines).toEqual([{ at: 0, until: 400, text: "one" }]);
  });

  // The spacing entries are punctuation between words, not words. Left in, every line would come
  // back with gaps in the middle of it.
  it("leaves the spacing entries out", async () => {
    const { http } = watched(
      new Response(
        JSON.stringify({
          words: [
            { text: "one", start: 0, end: 0.3 },
            { text: " ", start: 0.3, end: 0.31, type: "spacing" },
            { text: "two", start: 0.31, end: 0.6 },
          ],
        }),
        { status: 200 },
      ),
    );

    const lines = await transcribe("k3y", new Uint8Array([1]), {}, http);

    expect(lines[0]?.text).toBe("one two");
  });

  // A transcript with no timings is still the words in order, which the editor can space itself.
  it("keeps the words where no timings came back", async () => {
    const { http } = watched(
      new Response(JSON.stringify({ text: "the whole song" }), { status: 200 }),
    );

    expect(await transcribe("k3y", new Uint8Array([1]), {}, http)).toEqual([
      { at: 0, until: 0, text: "the whole song" },
    ]);
  });

  it("says what the service said when it refuses", async () => {
    const { http } = watched(new Response("no quota left", { status: 402 }));

    await expect(transcribe("k3y", new Uint8Array([1]), {}, http)).rejects.toThrow(/402/);
  });
});
