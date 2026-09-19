/**
 * The words of a song, from wherever they already are.
 *
 * Most music carries them. An MP3 has them in an ID3 frame -- `SYLT` with a timestamp per line,
 * `USLT` without, sometimes a `TXXX` somebody invented; an M4A keeps them in the `©lyr` atom; FLAC
 * and Ogg put a `LYRICS` comment in the Vorbis block. A `.lrc` beside the file is the fourth place,
 * and the one people actually share.
 *
 * So the first thing this editor does with a song is look, rather than ask somebody to type the
 * words it is already holding. Only when none of those four has anything is there a reason to send
 * the audio anywhere for a transcript.
 *
 * Everything here reads untrusted bytes. A tag that lies about its own length, a frame that runs
 * past the end of the file, a text encoding nobody has used since 1998: each one yields nothing
 * from that tag and the next tag is still read.
 */

/** One line, and when it is sung. `until` is absent where the source only carried a start. */
export interface LyricLine {
  /** Milliseconds from the start of the song. */
  at: number;
  until?: number;
  text: string;
}

export interface Lyrics {
  lines: readonly LyricLine[];
  /** Whether the source carried timings, or these are lines in order and nothing more. */
  timed: boolean;
  /** Where they came from, for a dialogue that has to say so. */
  from: "sylt" | "uslt" | "mp4" | "vorbis" | "lrc" | "text";
}

/** Two and a half minutes of a line held on screen is not a line, it is a stuck picture. */
const MAX_LINE_MS = 12_000;
const DEFAULT_LINE_MS = 3_500;
const MAX_LINES = 5_000;

/**
 * An `.lrc`, plain or enhanced.
 *
 * `[mm:ss.xx] words` is the whole format, plus three things real files do: several timestamps on one
 * line for a chorus, metadata lines like `[ar:]` that are not lyrics at all, and word timings in
 * angle brackets, which are dropped to their line's own time here -- a word is drawn from the line
 * it belongs to, and the renderer spaces them itself.
 */
export function parseLrc(source: string): Lyrics {
  const lines: LyricLine[] = [];
  for (const raw of source.replaceAll("\r\n", "\n").split("\n")) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = raw
      .slice((stamps.at(-1)?.index ?? 0) + (stamps.at(-1)?.[0].length ?? 0))
      // Enhanced timings sit inside the words; the words are what is wanted.
      .replaceAll(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "")
      .trim();
    if (text === "") continue;
    for (const stamp of stamps) {
      const at = stampMs(stamp[1], stamp[2], stamp[3]);
      if (at !== undefined) lines.push({ at, text });
    }
    if (lines.length >= MAX_LINES) break;
  }
  return { lines: closed(lines), timed: lines.length > 0, from: "lrc" };
}

/**
 * Plain words, one line each, with no timings at all.
 *
 * What somebody pasted, or what an unsynchronised tag carried. Kept as its own case rather than
 * given made-up timings here: who decides where a line falls is a question for whatever put it on
 * the timeline, and this is the reader.
 */
export function parseLyricText(source: string, from: Lyrics["from"] = "text"): Lyrics {
  const lines = source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, MAX_LINES)
    .map((text) => ({ at: 0, text }));
  return { lines, timed: false, from };
}

/**
 * The words inside an audio file, or nothing where it carries none.
 *
 * Three containers, in the order they turn up in a music library. Nothing here decodes audio: it
 * walks the tag at the front of the file and stops as soon as it has found something worth reading.
 */
export function lyricsInFile(bytes: Uint8Array): Lyrics | undefined {
  return fromId3(bytes) ?? fromMp4(bytes) ?? fromVorbis(bytes);
}

// ------------------------------------------------------------------------------------- ID3v2

function fromId3(bytes: Uint8Array): Lyrics | undefined {
  if (bytes.length < 10 || text(bytes, 0, 3) !== "ID3") return undefined;
  const version = bytes[3] ?? 0;
  const size = syncSafe(bytes, 6);
  const end = Math.min(bytes.length, 10 + size);
  let at = 10;
  // An extended header sits between the header and the frames and says how long it is.
  if (((bytes[5] ?? 0) & 0x40) !== 0) at += version >= 4 ? syncSafe(bytes, at) : 4 + word32(bytes, at);
  let unsynced: Lyrics | undefined;
  while (at + 10 <= end) {
    const id = text(bytes, at, 4);
    if (id.trim() === "") break;
    const length = version >= 4 ? syncSafe(bytes, at + 4) : word32(bytes, at + 4);
    const body = at + 10;
    if (length <= 0 || body + length > end) break;
    const frame = bytes.subarray(body, body + length);
    // Synchronised lyrics win outright: they are the same words with the times already in them.
    if (id === "SYLT") {
      const synced = readSylt(frame);
      if (synced !== undefined) return synced;
    }
    if (id === "USLT" && unsynced === undefined) {
      const plain = readUslt(frame);
      if (plain !== undefined) unsynced = plain;
    }
    if (id === "TXXX" && unsynced === undefined) {
      const described = readTxxx(frame);
      if (described !== undefined) unsynced = described;
    }
    at = body + length;
  }
  return unsynced;
}

/**
 * `SYLT`: an encoding byte, a language, a timestamp format, a content type, a description, and then
 * the text in pieces, each followed by four bytes saying when it is sung.
 *
 * Only the millisecond format is read. The other one counts MPEG frames, which cannot be turned
 * into a time without decoding the file, and a guess there would put every line in the wrong place.
 */
function readSylt(frame: Uint8Array): Lyrics | undefined {
  if (frame.length < 7) return undefined;
  const encoding = frame[0] ?? 0;
  if ((frame[4] ?? 0) !== 2) return undefined;
  let at = 6;
  const description = readString(frame, at, encoding);
  at = description.next;
  const lines: LyricLine[] = [];
  while (at + 4 <= frame.length && lines.length < MAX_LINES) {
    const piece = readString(frame, at, encoding);
    at = piece.next;
    if (at + 4 > frame.length) break;
    const when = word32(frame, at);
    at += 4;
    const words = piece.value.replaceAll(/[\r\n]+/g, " ").trim();
    if (words !== "") lines.push({ at: when, text: words });
  }
  if (lines.length === 0) return undefined;
  lines.sort((a, b) => a.at - b.at);
  return { lines: closed(lines), timed: true, from: "sylt" };
}

/** `USLT`: an encoding byte, a language, a description, and the whole song as one string. */
function readUslt(frame: Uint8Array): Lyrics | undefined {
  if (frame.length < 5) return undefined;
  const encoding = frame[0] ?? 0;
  const description = readString(frame, 4, encoding);
  const body = readString(frame, description.next, encoding).value;
  return bodyToLyrics(body, "uslt");
}

/** `TXXX`: anything at all, under a name. Only the ones whose name mentions lyrics are read. */
function readTxxx(frame: Uint8Array): Lyrics | undefined {
  if (frame.length < 2) return undefined;
  const encoding = frame[0] ?? 0;
  const described = readString(frame, 1, encoding);
  if (!/lyric|text/i.test(described.value)) return undefined;
  return bodyToLyrics(readString(frame, described.next, encoding).value, "uslt");
}

// ------------------------------------------------------------------------------------- MP4

/**
 * `©lyr`, inside `moov > udta > meta > ilst`.
 *
 * Walked as a tree rather than searched as bytes: the four characters of an atom name turn up
 * inside compressed audio often enough that a scan finds one in the middle of a drum fill.
 */
function fromMp4(bytes: Uint8Array): Lyrics | undefined {
  const found = findAtom(bytes, 0, bytes.length, ["moov", "udta", "meta", "ilst", "©lyr"]);
  if (found === undefined) return undefined;
  // Inside the name atom is a `data` atom: four bytes of type, four of locale, then the text.
  const data = findAtom(bytes, found.from, found.to, ["data"]);
  if (data === undefined || data.to - data.from < 8) return undefined;
  return bodyToLyrics(utf8(bytes.subarray(data.from + 8, data.to)), "mp4");
}

interface Span {
  from: number;
  to: number;
}

function findAtom(bytes: Uint8Array, from: number, to: number, path: readonly string[]): Span | undefined {
  const [wanted, ...rest] = path;
  if (wanted === undefined) return { from, to };
  let at = from;
  while (at + 8 <= to) {
    const size = word32(bytes, at);
    const name = text(bytes, at + 4, 4);
    // A size of zero means "to the end of the file"; a size of one means a 64-bit size follows,
    // which is a four-gigabyte tag and not something this is going to read.
    const length = size === 0 ? to - at : size;
    if (length < 8 || at + length > to) return undefined;
    if (name === wanted) {
      // `meta` carries a version and flags before its children; every other atom here does not.
      const skip = name === "meta" ? 12 : 8;
      return findAtom(bytes, at + skip, at + length, rest);
    }
    at += length;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------- Vorbis

/**
 * A `LYRICS=` or `UNSYNCEDLYRICS=` comment in a FLAC metadata block or an Ogg page.
 *
 * FLAC is read properly -- its blocks carry their own lengths. Ogg is not: the comment header is
 * inside a page whose segments would have to be reassembled, so what happens there is that the
 * FLAC reader finds nothing and the file yields no lyrics, which is the honest answer.
 */
function fromVorbis(bytes: Uint8Array): Lyrics | undefined {
  if (text(bytes, 0, 4) !== "fLaC") return undefined;
  let at = 4;
  while (at + 4 <= bytes.length) {
    const header = bytes[at] ?? 0;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const length = ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const body = at + 4;
    if (body + length > bytes.length) return undefined;
    if (type === 4) {
      const found = readVorbisComments(bytes.subarray(body, body + length));
      if (found !== undefined) return found;
    }
    if (last) return undefined;
    at = body + length;
  }
  return undefined;
}

function readVorbisComments(block: Uint8Array): Lyrics | undefined {
  let at = 0;
  const vendor = little32(block, at);
  at += 4 + vendor;
  if (at + 4 > block.length) return undefined;
  const count = little32(block, at);
  at += 4;
  for (let index = 0; index < count && at + 4 <= block.length; index += 1) {
    const length = little32(block, at);
    at += 4;
    if (at + length > block.length) return undefined;
    const entry = utf8(block.subarray(at, at + length));
    at += length;
    const split = entry.indexOf("=");
    if (split < 0) continue;
    const name = entry.slice(0, split).toUpperCase();
    if (name === "LYRICS" || name === "UNSYNCEDLYRICS" || name === "SYNCEDLYRICS") {
      const found = bodyToLyrics(entry.slice(split + 1), "vorbis");
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

// ------------------------------------------------------------------------------------- shared

/** A blob of text from a tag: an `.lrc` if it is one, plain lines if it is not. */
function bodyToLyrics(body: string, from: Lyrics["from"]): Lyrics | undefined {
  const trimmed = body.trim();
  if (trimmed === "") return undefined;
  if (/\[\d{1,3}:\d{1,2}/.test(trimmed)) {
    const parsed = parseLrc(trimmed);
    if (parsed.lines.length > 0) return { ...parsed, from: from === "mp4" ? "mp4" : "lrc" };
  }
  const plain = parseLyricText(trimmed, from);
  return plain.lines.length === 0 ? undefined : plain;
}

/** Each line runs until the next one starts, and no line outstays its welcome. */
function closed(lines: readonly LyricLine[]): LyricLine[] {
  return lines.map((line, index) => {
    const next = lines[index + 1];
    const until =
      next === undefined
        ? line.at + DEFAULT_LINE_MS
        : Math.min(next.at, line.at + MAX_LINE_MS);
    return { ...line, until: Math.max(until, line.at + 200) };
  });
}

function stampMs(minutes?: string, seconds?: string, fraction?: string): number | undefined {
  const m = Number(minutes);
  const s = Number(seconds);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return undefined;
  // Two digits are hundredths, three are milliseconds -- both are written in the wild.
  const digits = fraction ?? "";
  const rest = digits === "" ? 0 : Number(digits) * (digits.length === 3 ? 1 : 10);
  return Math.round(m * 60_000 + s * 1000 + rest);
}

function readString(bytes: Uint8Array, at: number, encoding: number): { value: string; next: number } {
  // 0 is Latin-1, 1 is UTF-16 with a byte order mark, 2 is UTF-16BE, 3 is UTF-8.
  if (encoding === 1 || encoding === 2) {
    let end = at;
    while (end + 1 < bytes.length && !(bytes[end] === 0 && bytes[end + 1] === 0)) end += 2;
    return { value: utf16(bytes.subarray(at, end), encoding === 1), next: Math.min(end + 2, bytes.length) };
  }
  let end = at;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  const slice = bytes.subarray(at, end);
  const value = encoding === 3 ? utf8(slice) : latin1(slice);
  return { value, next: Math.min(end + 1, bytes.length) };
}

function utf16(bytes: Uint8Array, hasMark: boolean): string {
  const big = hasMark ? bytes[0] === 0xfe && bytes[1] === 0xff : true;
  const from = hasMark && (bytes[0] === 0xff || bytes[0] === 0xfe) ? 2 : 0;
  let out = "";
  for (let at = from; at + 1 < bytes.length; at += 2) {
    const first = bytes[at] ?? 0;
    const second = bytes[at + 1] ?? 0;
    out += String.fromCharCode(big ? (first << 8) | second : (second << 8) | first);
  }
  return out;
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function text(bytes: Uint8Array, at: number, length: number): string {
  return latin1(bytes.subarray(at, at + length));
}

function word32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
  );
}

function little32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)
  );
}

/** ID3 sizes are seven bits per byte, so a length can never look like a frame sync. */
function syncSafe(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) & 0x7f) << 21) |
    (((bytes[at + 1] ?? 0) & 0x7f) << 14) |
    (((bytes[at + 2] ?? 0) & 0x7f) << 7) |
    ((bytes[at + 3] ?? 0) & 0x7f)
  );
}
