import { describe, expect, it } from "vitest";

import { lyricsInFile, parseLrc, parseLyricText } from "./lyrics";

/** An ID3v2.3 tag with one frame in it, the way a tagger writes one. */
function id3(frames: { id: string; body: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const frame of frames) {
    const header = new Uint8Array(10);
    header.set([...frame.id].map((c) => c.charCodeAt(0)), 0);
    const size = frame.body.length;
    header.set([(size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff], 4);
    parts.push(header, frame.body);
  }
  const body = concat(parts);
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
  const length = body.length;
  header.set(
    [(length >> 21) & 0x7f, (length >> 14) & 0x7f, (length >> 7) & 0x7f, length & 0x7f],
    6,
  );
  return concat([header, body, new Uint8Array(4)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function latin(value: string): Uint8Array {
  return new Uint8Array([...value].map((c) => c.charCodeAt(0)));
}

function uslt(text: string): Uint8Array {
  return concat([new Uint8Array([0]), latin("eng"), new Uint8Array([0]), latin(text)]);
}

function sylt(pieces: [string, number][]): Uint8Array {
  const parts: Uint8Array[] = [
    // Latin-1, language, milliseconds, "lyrics", an empty description.
    new Uint8Array([0]),
    latin("eng"),
    new Uint8Array([2, 1, 0]),
  ];
  for (const [text, when] of pieces) {
    parts.push(latin(text), new Uint8Array([0]));
    parts.push(new Uint8Array([(when >> 24) & 0xff, (when >> 16) & 0xff, (when >> 8) & 0xff, when & 0xff]));
  }
  return concat(parts);
}

/** An MP4 with the one atom path that carries lyrics, and nothing else in it. */
function mp4(text: string): Uint8Array {
  const words = new TextEncoder().encode(text);
  const data = atom("data", concat([new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), words]));
  const lyr = atom("©lyr", data);
  const ilst = atom("ilst", lyr);
  // `meta` carries a version and flags before its children, which is the trap in this format.
  const meta = atom("meta", concat([new Uint8Array([0, 0, 0, 0]), ilst]));
  return concat([atom("ftyp", latin("M4A ")), atom("moov", atom("udta", meta))]);
}

function atom(name: string, body: Uint8Array): Uint8Array {
  const size = body.length + 8;
  const header = new Uint8Array(8);
  header.set([(size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff], 0);
  header.set([...name].map((c) => c.charCodeAt(0)), 4);
  return concat([header, body]);
}

/** A FLAC file with a comment block, which is where the words live in one. */
function flac(comments: string[]): Uint8Array {
  const vendor = new TextEncoder().encode("videola");
  const parts: Uint8Array[] = [little(vendor.length), vendor, little(comments.length)];
  for (const comment of comments) {
    const bytes = new TextEncoder().encode(comment);
    parts.push(little(bytes.length), bytes);
  }
  const block = concat(parts);
  const header = new Uint8Array([0x84, (block.length >> 16) & 0xff, (block.length >> 8) & 0xff, block.length & 0xff]);
  return concat([latin("fLaC"), header, block]);
}

function little(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]);
}

describe("reading an .lrc", () => {
  it("takes the time and the words off each line", () => {
    const lyrics = parseLrc("[00:12.50]Standing in the hall of fame\n[00:16.00]And the world's gonna know");

    expect(lyrics.timed).toBe(true);
    expect(lyrics.lines[0]).toMatchObject({ at: 12_500, text: "Standing in the hall of fame" });
    expect(lyrics.lines[1]?.at).toBe(16_000);
  });

  // Two digits after the point are hundredths and three are milliseconds. Both are written, and a
  // reader that treated them the same would put every line of half the files a second out.
  it("reads hundredths and milliseconds as what they are", () => {
    expect(parseLrc("[00:01.5]a").lines[0]?.at).toBe(1050);
    expect(parseLrc("[00:01.50]a").lines[0]?.at).toBe(1500);
    expect(parseLrc("[00:01.500]a").lines[0]?.at).toBe(1500);
  });

  it("takes a chorus written once under several timestamps", () => {
    const lyrics = parseLrc("[00:30.00][01:10.00]Hall of fame");

    expect(lyrics.lines.map((line) => line.at)).toEqual([30_000, 70_000]);
    expect(lyrics.lines.every((line) => line.text === "Hall of fame")).toBe(true);
  });

  it("leaves the metadata lines out", () => {
    const lyrics = parseLrc("[ar:The Script]\n[ti:Hall of Fame]\n[00:05.00]Yeah, you could be the greatest");

    expect(lyrics.lines).toHaveLength(1);
    expect(lyrics.lines[0]?.text).toBe("Yeah, you could be the greatest");
  });

  // Enhanced files carry a timing inside every word. The words are what is wanted; where each one
  // falls is the renderer's job, and half a file's worth of angle brackets on screen is not.
  it("drops the word timings of an enhanced file but keeps the words", () => {
    const lyrics = parseLrc("[00:10.00]<00:10.00>You <00:10.40>could <00:10.90>be");

    expect(lyrics.lines[0]?.text).toBe("You could be");
  });

  it("gives every line an end, and no line more than twelve seconds", () => {
    const lyrics = parseLrc("[00:00.00]one\n[00:04.00]two\n[01:00.00]three");

    expect(lyrics.lines[0]?.until).toBe(4000);
    expect(lyrics.lines[1]?.until).toBe(16_000);
    expect(lyrics.lines[2]?.until).toBe(63_500);
  });

  it("finds nothing in a file that is not one", () => {
    expect(parseLrc("just some words\nand more").lines).toHaveLength(0);
  });
});

describe("reading the words out of a file", () => {
  it("takes unsynchronised lyrics out of an ID3 tag", () => {
    const found = lyricsInFile(id3([{ id: "USLT", body: uslt("line one\nline two") }]));

    expect(found?.from).toBe("uslt");
    expect(found?.timed).toBe(false);
    expect(found?.lines.map((line) => line.text)).toEqual(["line one", "line two"]);
  });

  // Synchronised lyrics are the same words with the times already in them, so they win wherever
  // both are there -- which on a tagged file is most of the time.
  it("prefers the synchronised frame over the plain one", () => {
    const found = lyricsInFile(
      id3([
        { id: "USLT", body: uslt("plain words") },
        { id: "SYLT", body: sylt([["first", 1000], ["second", 2500]]) },
      ]),
    );

    expect(found?.from).toBe("sylt");
    expect(found?.lines).toHaveLength(2);
    expect(found?.lines[1]).toMatchObject({ at: 2500, text: "second" });
  });

  it("reads an .lrc that somebody pasted into a tag as the timed lyrics it is", () => {
    const found = lyricsInFile(id3([{ id: "USLT", body: uslt("[00:02.00]one\n[00:05.00]two") }]));

    expect(found?.timed).toBe(true);
    expect(found?.lines[1]?.at).toBe(5000);
  });

  it("takes them out of an MP4 atom", () => {
    const found = lyricsInFile(mp4("first line\nsecond line"));

    expect(found?.from).toBe("mp4");
    expect(found?.lines).toHaveLength(2);
  });

  it("takes them out of a FLAC comment", () => {
    const found = lyricsInFile(flac(["ARTIST=Somebody", "LYRICS=[00:01.00]sung"]));

    expect(found?.lines[0]).toMatchObject({ at: 1000, text: "sung" });
  });

  // Untrusted bytes, all of it. A tag that lies about a length may not take the editor with it.
  it("says nothing rather than throwing on a file with no words in it", () => {
    expect(lyricsInFile(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
    expect(lyricsInFile(id3([{ id: "TIT2", body: latin("a title") }]))).toBeUndefined();
    expect(lyricsInFile(mp4(""))).toBeUndefined();
  });

  it("survives a frame that claims to be longer than the file", () => {
    const tag = id3([{ id: "USLT", body: uslt("words") }]);
    tag[10 + 4] = 0x7f;
    tag[10 + 5] = 0x7f;

    expect(() => lyricsInFile(tag)).not.toThrow();
  });
});

describe("words with no times at all", () => {
  it("keeps the order and drops the blank lines", () => {
    const lyrics = parseLyricText("  one  \n\n two \n");

    expect(lyrics.lines.map((line) => line.text)).toEqual(["one", "two"]);
    expect(lyrics.timed).toBe(false);
  });
});
