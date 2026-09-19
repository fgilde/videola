import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TranscribedLine } from "./transcribe";

/**
 * The words of a song, written down by a program on this machine.
 *
 * The other half of the answer to "there are no lyrics anywhere in this file". One way sends the
 * audio to ElevenLabs; this one sends it nowhere. Whisper is what people run for it, through
 * whisper.cpp or faster-whisper, and neither belongs in this repository: a model is gigabytes, a
 * Python environment is somebody else's, and a video editor that shipped either would be a video
 * editor nobody could install. So the contract is a command line.
 *
 * `VIDEOLA_WHISPER` is called as
 *
 *   <command> --input <audio file> --output <json file> [--model <name>]
 *
 * and is expected to write `{"segments":[{"start":1.2,"end":3.4,"text":"..."}]}`, in seconds --
 * which is what faster-whisper hands back, so a wrapper around it is three lines. whisper.cpp's
 * own `-oj` file is read as well, because a file that is already there is worth reading.
 */
export interface LocalTranscriber {
  command: string;
  model: string | undefined;
}

/** How long a transcription may take before it is given up on. A song is minutes of audio. */
const LIMIT_MS = 15 * 60 * 1000;

export async function transcribeLocally(
  transcriber: LocalTranscriber,
  audio: Uint8Array,
  contentType: string | undefined,
  run: Run = spawnAndWait,
): Promise<TranscribedLine[]> {
  const folder = await mkdtemp(join(tmpdir(), "videola-listen-"));
  const input = join(folder, `audio${extensionFor(contentType)}`);
  const output = join(folder, "transcript.json");
  try {
    await writeFile(input, audio);
    const args = [
      "--input",
      input,
      "--output",
      output,
      ...(transcriber.model === undefined ? [] : ["--model", transcriber.model]),
    ];
    const answer = await run(transcriber.command, args);
    if (answer.code !== 0) {
      throw new Error(
        `${transcriber.command} exited ${answer.code}: ${(answer.stderr || answer.stdout).slice(0, 300)}`,
      );
    }
    // The file first, because a transcript of a whole song down a pipe is a pipe that can be cut
    // off halfway; stdout is the fallback for a command that writes there instead.
    const written = await readFile(output, "utf8").catch(() => answer.stdout);
    return linesOfTranscript(written);
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Whatever the command wrote, as lines.
 *
 * Two shapes, because two programs: seconds and `segments` from faster-whisper and anything
 * written to this contract, milliseconds and `transcription` from whisper.cpp's own `-oj`. A
 * segment is already a line -- a whisper segment is a phrase -- so nothing is regrouped here the
 * way a word-by-word transcript has to be.
 */
export function linesOfTranscript(written: string): TranscribedLine[] {
  const body = parse(written);
  if (body === undefined) throw new Error("the transcriber wrote something that is not JSON");
  const lines: TranscribedLine[] = [];
  for (const segment of body.segments ?? []) {
    const text = (segment.text ?? "").trim();
    if (text === "") continue;
    lines.push({
      at: Math.max(0, Math.round((segment.start ?? 0) * 1000)),
      until: Math.max(0, Math.round((segment.end ?? segment.start ?? 0) * 1000)),
      text,
    });
  }
  for (const segment of body.transcription ?? []) {
    const text = (segment.text ?? "").trim();
    if (text === "") continue;
    lines.push({
      at: Math.max(0, Math.round(segment.offsets?.from ?? 0)),
      until: Math.max(0, Math.round(segment.offsets?.to ?? segment.offsets?.from ?? 0)),
      text,
    });
  }
  if (lines.length === 0 && typeof body.text === "string" && body.text.trim() !== "") {
    // A transcript with no timings is still worth something: the words in order, and the editor
    // spaces them over the song itself.
    return [{ at: 0, until: 0, text: body.text.trim() }];
  }
  return lines.sort((a, b) => a.at - b.at);
}

interface Transcript {
  segments?: { start?: number; end?: number; text?: string }[];
  transcription?: { offsets?: { from?: number; to?: number }; text?: string }[];
  text?: string;
}

function parse(written: string): Transcript | undefined {
  try {
    const body: unknown = JSON.parse(written);
    return typeof body === "object" && body !== null ? (body as Transcript) : undefined;
  } catch {
    return undefined;
  }
}

// Whisper builds read the container rather than the extension, but a file called `.mp3` that is an
// `.m4a` is the kind of thing that makes a decoder give up, so the name says what the bytes are.
function extensionFor(contentType: string | undefined): string {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "audio/wav" || type === "audio/x-wav") return ".wav";
  if (type === "audio/flac") return ".flac";
  if (type === "audio/ogg" || type === "audio/opus") return ".ogg";
  if (type === "audio/mp4" || type === "audio/m4a" || type === "audio/x-m4a") return ".m4a";
  if (type === "video/mp4") return ".mp4";
  if (type === "video/webm" || type === "audio/webm") return ".webm";
  return ".mp3";
}

export type Run = (
  command: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string; code: number }>;

const spawnAndWait: Run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} took longer than ${Math.round(LIMIT_MS / 60000)} minutes`));
    }, LIMIT_MS);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT" ? new Error(`${command} is not on this server`) : error,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
