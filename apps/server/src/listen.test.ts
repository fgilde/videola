import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { linesOfTranscript, transcribeLocally, type Run } from "./listen";

describe("reading what a local transcriber wrote", () => {
  it("takes faster-whisper's own shape, in seconds", () => {
    const lines = linesOfTranscript(
      JSON.stringify({
        segments: [
          { start: 0.5, end: 2.25, text: " Standing in the hall " },
          { start: 2.4, end: 4, text: "of fame" },
        ],
      }),
    );

    expect(lines).toEqual([
      { at: 500, until: 2250, text: "Standing in the hall" },
      { at: 2400, until: 4000, text: "of fame" },
    ]);
  });

  // A file that is already there is worth reading: whisper.cpp writes this one with `-oj`, in
  // milliseconds and under another name.
  it("takes whisper.cpp's own shape, in milliseconds", () => {
    const lines = linesOfTranscript(
      JSON.stringify({
        transcription: [{ offsets: { from: 1000, to: 3000 }, text: "And the world" }],
      }),
    );

    expect(lines).toEqual([{ at: 1000, until: 3000, text: "And the world" }]);
  });

  it("keeps a transcript that carries no times at all, for the editor to space out", () => {
    expect(linesOfTranscript(JSON.stringify({ text: "the whole song" }))).toEqual([
      { at: 0, until: 0, text: "the whole song" },
    ]);
  });

  it("drops the empty segments a silent passage produces", () => {
    const lines = linesOfTranscript(
      JSON.stringify({ segments: [{ start: 0, end: 1, text: "  " }, { start: 1, end: 2, text: "x" }] }),
    );

    expect(lines).toEqual([{ at: 1000, until: 2000, text: "x" }]);
  });

  it("says so rather than returning nothing when the command wrote something else", () => {
    expect(() => linesOfTranscript("not json at all")).toThrow(/not JSON/);
  });
});

describe("running one", () => {
  const audio = new Uint8Array([1, 2, 3, 4]);

  it("hands the command the audio it wrote out, and reads back what it wrote", async () => {
    let seen: { command: string; args: readonly string[]; bytes: number } | undefined;
    const run: Run = async (command, args) => {
      const input = args[args.indexOf("--input") + 1]!;
      seen = { command, args, bytes: (await readFile(input)).length };
      return { stdout: "", stderr: "", code: 0 };
    };

    await expect(
      transcribeLocally({ command: "whisper", model: "base" }, audio, "audio/mpeg", run),
    ).rejects.toThrow();

    expect(seen?.command).toBe("whisper");
    expect(seen?.bytes).toBe(4);
    expect(seen?.args).toContain("--model");
    expect(seen?.args).toContain("base");
  });

  it("reads the file the command wrote in preference to its output", async () => {
    const { writeFile } = await import("node:fs/promises");
    const run: Run = async (_command, args) => {
      const output = args[args.indexOf("--output") + 1]!;
      await writeFile(output, JSON.stringify({ segments: [{ start: 0, end: 1, text: "from the file" }] }));
      return { stdout: JSON.stringify({ segments: [{ start: 9, end: 9, text: "from stdout" }] }), stderr: "", code: 0 };
    };

    const lines = await transcribeLocally({ command: "w", model: undefined }, audio, "audio/mpeg", run);

    expect(lines).toEqual([{ at: 0, until: 1000, text: "from the file" }]);
  });

  it("falls back to what the command printed when it wrote no file", async () => {
    const run: Run = async () => ({
      stdout: JSON.stringify({ segments: [{ start: 1, end: 2, text: "printed" }] }),
      stderr: "",
      code: 0,
    });

    const lines = await transcribeLocally({ command: "w", model: undefined }, audio, "audio/mpeg", run);

    expect(lines).toEqual([{ at: 1000, until: 2000, text: "printed" }]);
  });

  // The reason, in the command's own words: "transcription failed" is not something anybody can
  // act on, and a missing model file is the usual cause.
  it("carries the command's own complaint when it fails", async () => {
    const run: Run = async () => ({ stdout: "", stderr: "model not found", code: 2 });

    await expect(
      transcribeLocally({ command: "w", model: undefined }, audio, "audio/mpeg", run),
    ).rejects.toThrow(/model not found/);
  });

  // A file called `.mp3` that is an `.m4a` is what makes a decoder give up.
  it("names the file after what the bytes are", async () => {
    let name = "";
    const run: Run = async (_command, args) => {
      name = args[args.indexOf("--input") + 1]!;
      return { stdout: JSON.stringify({ segments: [] }), stderr: "", code: 0 };
    };

    await transcribeLocally({ command: "w", model: undefined }, audio, "audio/flac", run);

    expect(name.endsWith(".flac")).toBe(true);
  });
});
