import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { LyricsDialog, type LyricsDialogProps, type LyricsDraft } from "./LyricsDialog";

const SONGS = [
  { id: "med_a", originalName: "hall-of-fame.mp3", kind: "audio" },
  { id: "med_b", originalName: "table.cube", kind: "lut" },
] as unknown as LyricsDialogProps["library"];

function show(over: Partial<LyricsDialogProps> = {}): {
  looked: string[];
  transcribed: string[];
  taken: string[];
  created: LyricsDraft[];
} {
  const looked: string[] = [];
  const transcribed: string[] = [];
  const taken: string[] = [];
  const created: LyricsDraft[] = [];
  render(
    <I18nProvider>
      <LyricsDialog
        library={SONGS}
        onLookInFile={(media) => looked.push(media)}
        onTranscribe={(media) => transcribed.push(media)}
        onText={(text) => taken.push(text)}
        onCreate={(draft) => created.push(draft)}
        onClose={vi.fn()}
        {...over}
      />
    </I18nProvider>,
  );
  return { looked, transcribed, taken, created };
}

describe("the lyric video dialogue", () => {
  // A lookup table is not a song. Offering one would be a picker that fails on the press.
  it("offers the songs and nothing else", () => {
    show();

    const songs = screen.getByTestId("lyrics-song") as HTMLSelectElement;

    expect([...songs.options].map((option) => option.textContent)).toEqual(["hall-of-fame.mp3"]);
  });

  it("looks in the file first, for the song that is chosen", () => {
    const { looked } = show();

    fireEvent.click(screen.getByTestId("lyrics-from-file"));

    expect(looked).toEqual(["med_a"]);
  });

  // Sending the audio away is the last resort, and on a server that cannot do it the button is not
  // there at all -- with a sentence saying what would make it appear.
  it("says why transcription is missing rather than offering it", () => {
    show();

    expect(screen.queryByTestId("lyrics-transcribe")).toBeNull();
    expect(screen.getByTestId("lyrics-no-transcriber").textContent).toContain(
      "VIDEOLA_ELEVENLABS_KEY",
    );
  });

  it("offers transcription where the server can do it", () => {
    const { transcribed } = show({ transcriber: "cloud" });

    fireEvent.click(screen.getByTestId("lyrics-transcribe"));

    expect(transcribed).toEqual(["med_a"]);
  });

  // One of the two sends the song to a company and the other does not. The button has to say
  // which before it is pressed, not in a release note.
  it("says which of the two would do the listening", () => {
    show({ transcriber: "local" });
    expect(screen.getByTestId("lyrics-transcribe").textContent).toBe("Lokal transkribieren");

    cleanup();
    show({ transcriber: "cloud" });
    expect(screen.getByTestId("lyrics-transcribe").textContent).toBe("Bei ElevenLabs transkribieren");
  });

  it("takes pasted words when there are some to take", () => {
    const { taken } = show();
    const paste = screen.getByTestId("lyrics-take-text") as HTMLButtonElement;
    expect(paste.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("lyrics-text"), { target: { value: "[00:01.00]one" } });
    fireEvent.click(paste);

    expect(taken).toEqual(["[00:01.00]one"]);
  });

  // Whether the times came with the words decides what happens on the timeline, so the dialogue
  // says which it is before anybody presses the button.
  it("says whether what it found carries times", () => {
    show({ found: { lines: [{ at: 1000, text: "one" }], timed: true, from: "sylt" } });

    expect(screen.getByTestId("lyrics-lines").textContent).toContain("one");
    expect(document.body.textContent).toContain("Mit Zeiten");
  });

  it("says when it does not", () => {
    show({ found: { lines: [{ at: 0, text: "one" }], timed: false, from: "text" } });

    expect(document.body.textContent).toContain("Ohne Zeiten");
  });

  it("will not make a video out of no lines", () => {
    show();

    expect((screen.getByTestId("lyrics-create") as HTMLButtonElement).disabled).toBe(true);
  });

  it("hands over the song, the style and the look it was set to", () => {
    const { created } = show({
      found: { lines: [{ at: 0, text: "one" }], timed: true, from: "lrc" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Karaoke" }));
    fireEvent.change(screen.getByTestId("lyrics-color"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByTestId("lyrics-with-visualizer"));
    fireEvent.click(screen.getByTestId("lyrics-create"));

    expect(created).toEqual([
      {
        media: "med_a",
        style: "karaoke",
        color: "#ff0000",
        accent: "#a048f8",
        background: "#050609",
        position: "middle",
        uppercase: false,
        withVisualizer: false,
        subtitles: true,
        size: 0.13,
        intensity: 0.6,
        glow: 0.5,
        tilt: 0.5,
      },
    ]);
  });

  // A slider for a setting the style ignores teaches somebody that the settings do nothing, so
  // each style is asked which of the four it answers to.
  it("shows the knobs the chosen style answers to and no others", () => {
    show({ found: { lines: [{ at: 0, text: "one" }], timed: true, from: "lrc" } });

    fireEvent.click(screen.getByRole("button", { name: "Karaoke" }));
    expect(screen.queryByTestId("lyrics-knob-tilt")).toBeNull();
    expect(screen.getByTestId("lyrics-knob-intensity")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Wachsend (3D)" }));
    expect(screen.getByTestId("lyrics-knob-tilt")).toBeTruthy();
    expect(screen.getByTestId("lyrics-knob-glow")).toBeTruthy();
  });

  it("hands the settings over with the rest, so the video is made as it was previewed", () => {
    const { created } = show({
      found: { lines: [{ at: 0, text: "one" }], timed: true, from: "lrc" },
    });

    fireEvent.change(screen.getByTestId("lyrics-knob-intensity"), { target: { value: "0.9" } });
    fireEvent.click(screen.getByTestId("lyrics-subtitles"));
    fireEvent.click(screen.getByTestId("lyrics-create"));

    expect(created[0]?.intensity).toBe(0.9);
    // Off, because the words are already the size of the frame; the row stays, out of the picture.
    expect(created[0]?.subtitles).toBe(false);
  });
});
