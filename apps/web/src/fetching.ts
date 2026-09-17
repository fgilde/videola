import { call, type Connection } from "./publishing";

/**
 * Material from a link, asked of a Videola server.
 *
 * The same seam publishing uses, for the same reason: a page may not read another origin's video,
 * and the sites this reaches hand out a manifest rather than a file. What comes back is bytes, and
 * the editor imports them exactly as it imports a file somebody dropped on the window.
 *
 * Every call here is a question a server with no `yt-dlp` cannot answer, so `fetchReady` comes
 * first: a dialogue that offers what this install cannot do is worse than one that says so.
 */

export interface FoundVideo {
  id: string;
  title: string;
  url: string;
  duration?: number;
  uploader?: string;
  thumbnail?: string;
}

export type FetchKind = "video" | "audio";

export interface FetchChoice {
  url: string;
  kind: FetchKind;
  format: string;
  quality: string;
}

export const VIDEO_FORMATS = ["mp4", "any"] as const;
export const AUDIO_FORMATS = ["m4a", "mp3", "opus", "wav", "flac"] as const;
export const QUALITIES = ["best", "2160", "1440", "1080", "720", "480", "360"] as const;

/** Whether the server behind this editor can fetch at all, and with which version of the tool. */
export async function fetchReady(
  connection: Connection,
): Promise<{ available: boolean; version?: string }> {
  try {
    const answer = await call(connection, "/api/fetch/ready");
    return (await answer.json()) as { available: boolean; version?: string };
  } catch {
    // No server, no connection, no answer. All three mean the same thing to the dialogue.
    return { available: false };
  }
}

export async function searchVideos(
  connection: Connection,
  query: string,
): Promise<readonly FoundVideo[]> {
  const answer = await call(connection, `/api/fetch/search?q=${encodeURIComponent(query)}`);
  const body = (await answer.json()) as { results?: FoundVideo[] };
  return body.results ?? [];
}

export async function describeLink(connection: Connection, url: string): Promise<FoundVideo> {
  const answer = await call(connection, `/api/fetch/describe?url=${encodeURIComponent(url)}`);
  return (await answer.json()) as FoundVideo;
}

/**
 * The material itself, as a File the import can take.
 *
 * The name comes from the server's `content-disposition`, which carries what the site called it --
 * so the library entry reads "Die Bühne, zweiter Abend" rather than a hash or a video id.
 */
export async function fetchMedium(
  connection: Connection,
  choice: FetchChoice,
): Promise<File> {
  const query = new URLSearchParams({
    url: choice.url,
    kind: choice.kind,
    format: choice.format,
    quality: choice.quality,
  });
  const answer = await call(connection, `/api/fetch?${query.toString()}`, { method: "POST" });
  const type = answer.headers.get("content-type") ?? "application/octet-stream";
  const bytes = await answer.arrayBuffer();
  return new File([bytes], nameFrom(answer.headers.get("content-disposition"), choice), { type });
}

/** Whether what somebody typed is a link to fetch or words to search for. */
export function looksLikeLink(text: string): boolean {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed) || /^[\w-]+\.[a-z]{2,}\//i.test(trimmed);
}

// `filename*=UTF-8''...` where the server could write one, because that is the half that survives
// an umlaut; the plain `filename="..."` is the fallback for anything that did not.
export function nameFrom(disposition: string | null, choice: FetchChoice): string {
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "");
  if (extended?.[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // A malformed header is not worth failing an import over.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition ?? "");
  if (plain?.[1] !== undefined) return plain[1];
  return choice.kind === "audio" ? `sound.${choice.format}` : `video.${choice.format}`;
}
