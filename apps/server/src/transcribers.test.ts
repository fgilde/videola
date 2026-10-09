import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Api } from "./api";
import type { Run } from "./listen";

const AUDIO = new Uint8Array([1, 2, 3]);

const whisper: Run = async (_command, args) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(args[args.indexOf("--output") + 1]!, JSON.stringify({ segments: [{ start: 1, end: 2, text: "here" }] }));
  return { stdout: "", stderr: "", code: 0 };
};

const elevenLabs = (async () =>
  new Response(JSON.stringify({ words: [{ text: "away", start: 3, end: 4 }] }), { status: 200 })) as typeof fetch;

async function api(options: { key?: boolean; whisper?: boolean }): Promise<Api> {
  return new Api({
    storageRoot: await mkdtemp(join(tmpdir(), "videola-transcribers-")),
    fetch: elevenLabs,
    runWhisper: whisper,
    ...(options.key === true ? { elevenLabsKey: "key" } : {}),
    ...(options.whisper === true ? { whisper: { command: "whisper", model: undefined } } : {}),
  });
}

describe("the transcribers a server offers", () => {
  it("names none where nothing is set", async () => {
    expect((await api({})).transcribers()).toEqual([]);
  });

  it("names both where both are set, the one that keeps the audio here first", async () => {
    expect((await api({ key: true, whisper: true })).transcribers()).toEqual(["server", "cloud"]);
  });

  it("uses the one that was asked for", async () => {
    const both = await api({ key: true, whisper: true });

    expect((await both.transcribeAudio(AUDIO, { engine: "cloud" }))[0]?.text).toBe("away");
    expect((await both.transcribeAudio(AUDIO, { engine: "server" }))[0]?.text).toBe("here");
  });

  it("uses the one on this machine where none was named", async () => {
    expect((await (await api({ key: true, whisper: true })).transcribeAudio(AUDIO))[0]?.text).toBe("here");
  });

  // The one fall-back that must never happen: asked to keep the audio here, sending it to a company.
  it("never sends the audio to ElevenLabs when the server's own transcriber was asked for", async () => {
    await expect((await api({ key: true })).transcribeAudio(AUDIO, { engine: "server" })).rejects.toThrow(
      /no transcriber called server/,
    );
  });

  it("refuses one it does not have rather than falling back to the other", async () => {
    await expect((await api({ whisper: true })).transcribeAudio(AUDIO, { engine: "cloud" })).rejects.toThrow(
      /no transcriber called cloud/,
    );
  });
});
