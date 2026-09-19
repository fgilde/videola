import type { Fetch } from "./publish";

/**
 * The words in a recording, with the times they are said at.
 *
 * For the one case the four places lyrics usually live cannot answer: a song whose file carries no
 * tag, no `.lrc` and no synchronised frame. ElevenLabs' transcription is what does the listening;
 * the key belongs to whoever runs the server, and it stays there -- a key in a browser is a key in
 * everybody's browser.
 *
 * Words come back one at a time. What a lyric video needs is lines, so they are grouped here: a
 * gap long enough to be a breath ends a line, and so does a line that has gone on long enough to
 * fill the screen. That grouping is the whole difference between a transcript and something worth
 * putting on a timeline.
 */
export interface TranscribedLine {
  /** Milliseconds from the start of the audio. */
  at: number;
  until: number;
  text: string;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

/** A pause this long or longer is where one line ends and the next begins. */
const BREATH_MS = 700;
/** And no line runs past this, however continuous the singing. */
const LONGEST_MS = 6000;
const MOST_WORDS = 10;

export async function transcribe(
  key: string,
  audio: Uint8Array,
  options: { contentType?: string; language?: string } = {},
  http: Fetch = fetch,
): Promise<TranscribedLine[]> {
  const form = new FormData();
  form.set(
    "file",
    new Blob([audio as unknown as BlobPart], { type: options.contentType ?? "audio/mpeg" }),
    "audio",
  );
  // The model that returns word timings; without them there is nothing to put on a timeline.
  form.set("model_id", "scribe_v1");
  form.set("timestamps_granularity", "word");
  if (options.language !== undefined && options.language !== "") {
    form.set("language_code", options.language);
  }

  const answer = await http("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!answer.ok) {
    throw new Error(`elevenlabs refused the audio: ${answer.status} ${(await answer.text()).slice(0, 300)}`);
  }
  const body = (await answer.json()) as { words?: TranscriptWord[]; text?: string };
  const words = (body.words ?? []).filter(
    (word) => word.type !== "spacing" && typeof word.text === "string" && word.text.trim() !== "",
  );
  if (words.length === 0) {
    // A transcript with no timings is still worth something: the words in order, and the editor can
    // space them over the clip itself.
    const whole = (body.text ?? "").trim();
    return whole === "" ? [] : [{ at: 0, until: 0, text: whole }];
  }
  return linesOf(words);
}

export function linesOf(words: readonly TranscriptWord[]): TranscribedLine[] {
  const lines: TranscribedLine[] = [];
  let current: TranscriptWord[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    lines.push({
      at: Math.round(first.start * 1000),
      until: Math.round(last.end * 1000),
      text: current.map((word) => word.text.trim()).join(" "),
    });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    const gap = previous === undefined ? 0 : (word.start - previous.end) * 1000;
    const span = current.length === 0 ? 0 : (word.end - (current[0]?.start ?? 0)) * 1000;
    if (gap >= BREATH_MS || span > LONGEST_MS || current.length >= MOST_WORDS) flush();
    current.push(word);
  }
  flush();
  return lines;
}
