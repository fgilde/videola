import { lyricsInFile, mediaBlob, mediaHash, parseLrc, parseLyricText } from "@videola/media";

import { call, type Connection } from "./publishing";

import type { MediaId } from "@videola/core";

/**
 * Where the words of a song come from, in the order they are worth trying.
 *
 * The file first, because most music carries them and reading a tag costs nothing. Then whatever
 * somebody pasted. Only then the server, which sends the audio to a transcription service -- the
 * one thing in this editor that leaves the machine, and the dialogue says so before it happens.
 */
export interface FoundLines {
  lines: { at: number; until?: number; text: string }[];
  timed: boolean;
  from: string;
}

/** The lyrics inside a medium's own file, or nothing where it carries none. */
export async function lyricsForMedia(media: MediaId): Promise<FoundLines | undefined> {
  const hash = mediaHash(media);
  if (hash === undefined) return undefined;
  const file = await mediaBlob(hash);
  if (file === undefined) return undefined;
  // The tag is at the front of the file and the whole song is behind it. Reading the first two
  // megabytes is a tag with room to spare and not a hundred megabytes of audio through a decoder.
  const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
  const found = lyricsInFile(head) ?? lyricsInFile(new Uint8Array(await file.arrayBuffer()));
  if (found === undefined) return undefined;
  return { lines: [...found.lines], timed: found.timed, from: found.from };
}

/** What somebody pasted: an `.lrc` if it looks like one, plain lines if it does not. */
export function lyricsFromText(text: string): FoundLines | undefined {
  const asLrc = parseLrc(text);
  if (asLrc.lines.length > 0) {
    return { lines: [...asLrc.lines], timed: true, from: "lrc" };
  }
  const plain = parseLyricText(text);
  if (plain.lines.length === 0) return undefined;
  return { lines: [...plain.lines], timed: false, from: "text" };
}

/**
 * Which transcriber the server behind this editor has, if it has one.
 *
 * Not a yes or a no: one of the two sends the song to a company and the other one does not, and
 * the sentence beside the button has to say which.
 */
export async function transcriberReady(connection: Connection): Promise<Transcriber> {
  try {
    const answer = await call(connection, "/api/lyrics/ready");
    const body = (await answer.json()) as { available?: boolean; engine?: string };
    if (body.available !== true) return undefined;
    return body.engine === "local" ? "local" : "cloud";
  } catch {
    // No server, or one that has never heard of this route: the dialogue offers the other ways.
    return undefined;
  }
}

export type Transcriber = "local" | "cloud" | undefined;

/** The audio, sent to the server, which has the key and does the listening. */
export async function transcribeMedia(
  connection: Connection,
  media: MediaId,
): Promise<FoundLines> {
  const hash = mediaHash(media);
  if (hash === undefined) throw new Error("error.noSuchMedia");
  const file = await mediaBlob(hash);
  if (file === undefined) throw new Error("error.noSuchMedia");
  const answer = await call(connection, "/api/lyrics/transcribe", {
    method: "POST",
    headers: { "content-type": file.type === "" ? "audio/mpeg" : file.type },
    body: await file.arrayBuffer(),
  });
  const body = (await answer.json()) as { lines?: { at: number; until: number; text: string }[] };
  const lines = body.lines ?? [];
  return { lines, timed: lines.some((line) => line.until > line.at), from: "transcript" };
}
