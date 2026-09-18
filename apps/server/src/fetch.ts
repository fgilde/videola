import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { isIP } from "node:net";
import { join } from "node:path";

/**
 * Material from a link, through `yt-dlp`.
 *
 * The browser cannot do this and never will: a page may not read another origin's video, and the
 * sites this reaches hand out a manifest rather than a file. So it happens here, on a machine
 * somebody runs themselves, and what arrives in the editor is an ordinary imported medium.
 *
 * `yt-dlp` is not bundled. The image installs it; a server without it answers "not set up" rather
 * than failing halfway into a download, because a tool that ships a downloader it cannot update is
 * a tool with a broken downloader three weeks later.
 *
 * What it is for is your own material -- a talk you gave, a stream you ran, footage a client sent as
 * a link. What it is not for is somebody else's work, and no software can tell the two apart.
 */

/** Everything that runs `yt-dlp`, so a check can drive this without a network or a binary. */
export type RunYtDlp = (
  args: readonly string[],
  /** Each line the tool writes while it works, which is where the progress is. */
  onLine?: (line: string) => void,
) => Promise<{
  stdout: string;
  stderr: string;
  code: number;
}>;

export interface FoundVideo {
  id: string;
  title: string;
  url: string;
  /** Seconds, absent for a live stream or where the site does not say. */
  duration?: number;
  uploader?: string;
  thumbnail?: string;
}

export type FetchKind = "video" | "audio";

export interface FetchRequest {
  url: string;
  kind: FetchKind;
  /** `auto`, `h264`, `h265`, `av1` or `vp9`. Video only, and a preference rather than a demand. */
  codec?: string;
  /** `mp4` or `any` for video; `m4a`, `mp3`, `opus`, `wav` or `flac` for audio. */
  format: string;
  /** A height for video -- 1080, 720, 480 -- `best` or `worst`; a bitrate in kbps for audio. */
  quality: string;
}

export interface FetchedMedium {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export const AUDIO_FORMATS = ["m4a", "mp3", "opus", "wav", "flac"] as const;
export const VIDEO_FORMATS = ["mp4", "any"] as const;
export const QUALITIES = ["best", "2160", "1440", "1080", "720", "480", "360"] as const;

// How many a search hands back. Enough to recognise the one you meant, few enough that the dialogue
// is a list rather than a page.
export const SEARCH_LIMIT = 12;

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
};

// What a codec preference means to yt-dlp. MeTube's map, because these are the spellings the sites
// really hand out: `avc` and `h264` are the same thing under two names, and a filter that knows only
// one of them falls through to whatever was there without saying so.
const CODEC_FILTERS: Record<string, string> = {
  h264: "[vcodec~='^(h264|avc)']",
  h265: "[vcodec~='^(h265|hevc)']",
  av1: "[vcodec~='^av0?1']",
  vp9: "[vcodec~='^vp0?9']",
};

export function formatSelector(request: FetchRequest): string {
  if (request.kind === "audio") {
    const format = request.format === "any" ? "" : `[ext=${request.format}]`;
    return `bestaudio${format}/bestaudio/best`;
  }
  const worst = request.quality === "worst";
  const height = worst || request.quality === "best" ? "" : `[height<=${request.quality}]`;
  const picture = worst ? "worstvideo" : "bestvideo";
  const sound = worst ? "worstaudio" : "bestaudio";
  const either = worst ? "worst" : "best";
  const container = request.format === "mp4" ? "[ext=mp4]" : "";
  const soundContainer = request.format === "mp4" ? "[ext=m4a]" : "";
  const codec = CODEC_FILTERS[request.codec ?? "auto"] ?? "";
  // The fallbacks matter more than the first branch, which is the lesson in MeTube's bug reports: a
  // selector that insists on a codec, a container and a height at once finds nothing on half the
  // videos out there, and a person then sees "nothing to download" about one that plays perfectly
  // well in a browser. Each step drops the narrowest demand it still has.
  return [
    `${picture}${codec}${container}${height}+${sound}${soundContainer}`,
    `${picture}${container}${height}+${sound}${soundContainer}`,
    `${either}${container}${height}`,
    either,
  ].join("/");
}

/** What `yt-dlp` is asked, in one place, so the two callers cannot drift apart. */
export function searchArgs(query: string, limit = SEARCH_LIMIT): string[] {
  // `ytsearch` rather than the Data API: no key to set up, no quota to run out of, and the same
  // extractor that will do the downloading is the one that answers the search.
  return [
    "--dump-json",
    "--flat-playlist",
    "--no-warnings",
    `ytsearch${Math.max(1, Math.min(limit, 50))}:${query}`,
  ];
}

export function describeArgs(url: string): string[] {
  return ["--dump-single-json", "--no-playlist", "--no-warnings", url];
}

export async function searchVideos(
  query: string,
  run: RunYtDlp,
  limit = SEARCH_LIMIT,
): Promise<FoundVideo[]> {
  if (query.trim() === "") return [];
  const answer = await run(searchArgs(query.trim(), limit));
  if (answer.code !== 0) throw new Error(said(answer.stderr, "the search failed"));
  return answer.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => asFound(JSON.parse(line) as Record<string, unknown>))
    .filter((found): found is FoundVideo => found !== undefined);
}

/** What a link points at, before anybody has downloaded anything. */
export async function describeVideo(url: string, run: RunYtDlp): Promise<FoundVideo> {
  await allowed(url);
  const answer = await run(describeArgs(url));
  if (answer.code !== 0) throw new Error(said(answer.stderr, "this link could not be read"));
  const found = asFound(JSON.parse(answer.stdout) as Record<string, unknown>);
  if (found === undefined) throw new Error("this link does not point at a video");
  return found;
}

/**
 * The material itself, as bytes this process holds and hands on.
 *
 * Into a temporary directory and out again rather than streaming: `yt-dlp` writes a file, merges
 * two streams into it where it has to, and the name it chooses carries the container it ended up
 * with. A stream would have to guess at that name, and a guess is what decides whether the editor
 * can decode what it just imported.
 */
export async function fetchMedium(
  request: FetchRequest,
  run: RunYtDlp,
  /** How far along, in whole percent. A ten minute video is a wait somebody wants a number for. */
  onProgress?: (percent: number) => void,
): Promise<FetchedMedium> {
  await allowed(request.url);
  const into = await mkdtemp(join(tmpdir(), "videola-fetch-"));
  const watch =
    onProgress === undefined
      ? undefined
      : (line: string): void => {
          const percent = percentOf(line);
          if (percent !== undefined) onProgress(percent);
        };
  try {
    // Twice, where the first attempt hit a 403.
    //
    // YouTube signs the URL of every fragment and the signature goes stale; it also serves some
    // clients a stream the same client is then refused. Both come back as "HTTP Error 403:
    // Forbidden" in the middle of a download that was working a moment ago -- the same link then
    // succeeds on the next try, which is exactly what makes it infuriating rather than informative.
    // The retries below cover a stale fragment, and asking as a different player client covers the
    // rest. Nothing is guessed about which happened: the second attempt simply changes both.
    let answer = await run(downloadArgs(request, into, []), watch);
    if (answer.code !== 0 && forbidden(answer.stderr)) {
      answer = await run(
        downloadArgs(request, into, ["--extractor-args", "youtube:player_client=web_safari,web"]),
        watch,
      );
    }
    if (answer.code !== 0) throw new Error(said(answer.stderr, "the download failed"));
    const written = await readdir(into);
    const filename = written[0];
    if (filename === undefined) throw new Error("the download produced no file");
    const bytes = new Uint8Array(await readFile(join(into, filename)));
    return { bytes, filename, contentType: contentTypeOf(filename) };
  } finally {
    // Whatever happened. A failed merge leaves both streams behind, and a directory per attempt in
    // the system's temporary space is a disk that fills up over a month of use.
    await rm(into, { recursive: true, force: true });
  }
}

export function forbidden(stderr: string): boolean {
  return /403|forbidden/i.test(stderr);
}

/** What the tool is handed for a download, so both attempts differ in one argument and nothing else. */
export function downloadArgs(
  request: FetchRequest,
  into: string,
  extra: readonly string[],
): string[] {
  return [
      // One line per update rather than a carriage return over the same one: a progress bar written
      // for a terminal arrives here as one enormous line nobody can parse.
      "--newline",
      "--no-playlist",
      "--no-warnings",
      "--no-part",
      // A stale fragment URL is the ordinary reason a download stops halfway, and asking again is
      // the ordinary cure: yt-dlp fetches a fresh URL for the fragment it retries.
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--extractor-retries",
      "3",
      ...extra,
      "-f",
      formatSelector(request),
      ...(request.kind === "audio" && request.format !== "any"
        ? [
            "--extract-audio",
            "--audio-format",
            request.format,
            // A bitrate where one was asked for. yt-dlp reads 0-10 as a VBR level and anything
            // larger as kbps, which is how MeTube passes these through too.
            ...(request.quality === "best" ? [] : ["--audio-quality", `${request.quality}K`]),
          ]
        : []),
      // Merged into the container somebody asked for, because a separate video and audio file is not
      // a medium anything here can place on a track.
      ...(request.kind === "video" && request.format === "mp4" ? ["--merge-output-format", "mp4"] : []),
      "-o",
      join(into, "%(title).120B.%(ext)s"),
      request.url,
  ];
}

/** The runner the server really uses. Absent binary and non-zero exit are both ordinary answers. */
export function ytDlp(command = process.env.VIDEOLA_YTDLP ?? "yt-dlp"): RunYtDlp {
  return async (args, onLine) =>
    await new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let pending = "";
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (onLine === undefined) return;
        // Whole lines only: a download writes its percentage in pieces, and half a line is a
        // percentage nobody can read.
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      });
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.on("error", (error: NodeJS.ErrnoException) => {
        reject(
          error.code === "ENOENT"
            ? new Error(`${command} is not installed on this server`)
            : error,
        );
      });
      child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    });
}

/** Whether this server has the tool at all, asked before a dialogue offers to use it. */
export async function ytDlpVersion(run: RunYtDlp): Promise<string | undefined> {
  try {
    const answer = await run(["--version"]);
    return answer.code === 0 ? answer.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where this server may be pointed.
 *
 * A downloader that fetches whatever it is handed is a way into the network it runs on: a link to
 * `http://192.168.1.1/` or to a cloud metadata address turns an editor into a probe. The check is on
 * the address the name really resolves to, because a hostname somebody controls can point anywhere.
 */
export async function allowed(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("this is not a link");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http and https links can be fetched");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) !== 0 ? [host] : await resolved(host);
  if (addresses.some(isPrivateAddress)) {
    throw new Error("this link points into the server's own network");
  }
}

async function resolved(host: string): Promise<string[]> {
  try {
    return (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    // A name that does not resolve is not a way in. `yt-dlp` will fail on it in its own words,
    // which are better than any this could invent.
    return [];
  }
}

export function isPrivateAddress(address: string): boolean {
  const plain = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(plain) === 6) {
    return (
      plain === "::" ||
      plain === "::1" ||
      plain.startsWith("fc") ||
      plain.startsWith("fd") ||
      plain.startsWith("fe80")
    );
  }
  const parts = plain.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Link-local, which is where a cloud instance keeps its credentials.
  if (a === 169 && b === 254) return true;
  return a === 100 && b >= 64 && b <= 127;
}

function asFound(entry: Record<string, unknown>): FoundVideo | undefined {
  const id = typeof entry.id === "string" ? entry.id : undefined;
  const title = typeof entry.title === "string" ? entry.title : undefined;
  if (id === undefined || title === undefined) return undefined;
  const url =
    typeof entry.webpage_url === "string"
      ? entry.webpage_url
      : typeof entry.url === "string" && entry.url.startsWith("http")
        ? entry.url
        : `https://www.youtube.com/watch?v=${id}`;
  return {
    id,
    title,
    url,
    ...(typeof entry.duration === "number" ? { duration: entry.duration } : {}),
    ...(typeof entry.uploader === "string" ? { uploader: entry.uploader } : {}),
    ...(thumbnailOf(entry) === undefined ? {} : { thumbnail: thumbnailOf(entry) }),
  };
}

function thumbnailOf(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.thumbnail === "string") return entry.thumbnail;
  const list = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  const last = list[list.length - 1] as { url?: unknown } | undefined;
  return typeof last?.url === "string" ? last.url : undefined;
}

function contentTypeOf(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME[extension] ?? "application/octet-stream";
}

/**
 * How far along a download line says it is.
 *
 * Two streams are fetched for a merged video, so the percentage runs to a hundred twice; the caller
 * is told what the line says and decides what to make of it. Lines that are not progress -- and most
 * of them are not -- come back undefined rather than as a zero that would jerk a bar backwards.
 */
export function percentOf(line: string): number | undefined {
  const found = /^\[download\]\s+([\d.]+)%/.exec(line.trim());
  if (found?.[1] === undefined) return undefined;
  const percent = Number(found[1]);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : undefined;
}

// yt-dlp says what went wrong in its last line, and the lines before it are progress. A message
// that carried all of it would be a wall of text in a banner.
function said(stderr: string, fallback: string): string {
  const last = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .pop();
  return last === undefined ? fallback : last.replace(/^ERROR:\s*/i, "");
}
