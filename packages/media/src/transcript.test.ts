import { beforeEach, describe, expect, it } from "vitest";

import { installFakeOpfs } from "./fake-opfs";
import { heldTranscript, keepTranscript, sungText, wavFile, windowsOf } from "./transcript";

const RATE = 100;
const HASH = "c".repeat(64);

function loud(seconds: number): Float32Array {
  return new Float32Array(seconds * RATE).fill(0.5);
}

describe("cutting a song for a transcriber", () => {
  it("leaves a song of thirty seconds or less in one piece", () => {
    expect(windowsOf(loud(30), RATE)).toEqual([{ start: 0, end: 3000 }]);
  });

  it("cuts a longer one at its quietest spot between twenty and thirty seconds", () => {
    const song = loud(50);
    song.fill(0, 2400, 2410);

    const windows = windowsOf(song, RATE);

    expect(windows[0]).toEqual({ start: 0, end: 2405 });
    expect(windows[1]).toEqual({ start: 2405, end: 5000 });
  });

  it("never cuts a piece longer than thirty seconds, however loud the song", () => {
    const windows = windowsOf(loud(200), RATE);

    expect(windows.every((window) => window.end - window.start <= 30 * RATE)).toBe(true);
    expect(windows.every((window) => window.end - window.start >= 20 * RATE || window.end === 20000)).toBe(true);
    expect(windows[windows.length - 1]?.end).toBe(200 * RATE);
    windows.slice(1).forEach((window, index) => expect(window.start).toBe(windows[index]?.end));
  });

  it("starts where an earlier run stopped", () => {
    expect(windowsOf(loud(40), RATE, 25)).toEqual([{ start: 2500, end: 4000 }]);
  });

  it("has nothing left to cut where the whole song is behind it", () => {
    expect(windowsOf(loud(40), RATE, 40)).toEqual([]);
  });
});

describe("what counts as a sung line", () => {
  it("keeps words and tidies their spacing", () => {
    expect(sungText("  Standing in   the hall ")).toBe("Standing in the hall");
  });

  it("drops what whisper writes over an instrumental", () => {
    expect(sungText("♪ ♪")).toBeUndefined();
    expect(sungText("[Music]")).toBeUndefined();
    expect(sungText("(instrumental)")).toBeUndefined();
    expect(sungText("Thanks for watching!")).toBeUndefined();
  });

  it("keeps the words beside a note", () => {
    expect(sungText("♪ Hall of fame ♪")).toBe("Hall of fame");
  });
});

describe("a WAV file", () => {
  it("says its rate and length, and carries the samples as 16-bit", () => {
    const file = wavFile(new Float32Array([0, 1, -1, 2]), 16000);
    const view = new DataView(file.buffer);

    expect(String.fromCharCode(...file.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([2, 3, 4, 5].map((i) => view.getInt16(44 + (i - 2) * 2, true))).toEqual([0, 32767, -32767, 32767]);
  });
});

describe("keeping a transcript", () => {
  beforeEach(() => {
    installFakeOpfs();
  });

  it("reads back what was kept", async () => {
    const held = { model: "base", until: 31, done: false, lines: [{ at: 0, until: 900, text: "hi" }] };
    await keepTranscript(HASH, "local", held);

    expect(await heldTranscript(HASH, "local", "base")).toEqual(held);
  });

  it("keeps each transcriber's apart", async () => {
    await keepTranscript(HASH, "cloud", { model: "base", until: 9, done: true, lines: [] });

    expect(await heldTranscript(HASH, "local", "base")).toBeUndefined();
  });

  it("forgets one another model heard", async () => {
    await keepTranscript(HASH, "local", { model: "tiny", until: 9, done: true, lines: [] });

    expect(await heldTranscript(HASH, "local", "base")).toBeUndefined();
  });
});
