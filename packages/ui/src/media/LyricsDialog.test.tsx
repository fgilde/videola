import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import {
  LyricsDialog,
  parseClock,
  type FoundLyrics,
  type LyricsDialogProps,
  type LyricsDraft,
} from "./LyricsDialog";

const SONGS = [
  { id: "med_a", originalName: "hall-of-fame.mp3", kind: "audio" },
  { id: "med_b", originalName: "table.cube", kind: "lut" },
] as unknown as LyricsDialogProps["library"];

function show(over: Partial<LyricsDialogProps> = {}): {
  looked: string[];
  transcribed: unknown[][];
  taken: string[];
  created: LyricsDraft[];
  edited: FoundLyrics[];
} {
  const edited: FoundLyrics[] = [];
  const looked: string[] = [];
  const transcribed: unknown[][] = [];
  const taken: string[] = [];
  const created: LyricsDraft[] = [];
  render(
    <I18nProvider>
      <LyricsDialog
        library={SONGS}
        onLookInFile={(media) => looked.push(media)}
        transcribers={["local"]}
        onTranscribe={(media, transcriber, listen) => transcribed.push([media, transcriber, listen])}
        onStopTranscribing={vi.fn()}
        onText={(text) => taken.push(text)}
        onLines={(found) => edited.push(found)}
        onCreate={(draft) => created.push(draft)}
        onClose={vi.fn()}
        {...over}
      />
    </I18nProvider>,
  );
  return { looked, transcribed, taken, created, edited };
}

beforeEach(() => {
  localStorage.clear();
});

describe("the lyric video dialogue", () => {
  it("remembers the language and the size for the next time", () => {
    show();
    fireEvent.change(screen.getByTestId("lyrics-language"), { target: { value: "fr" } });
    fireEvent.change(screen.getByTestId("lyrics-size"), { target: { value: "base" } });
    cleanup();

    show();

    expect((screen.getByTestId("lyrics-language") as HTMLSelectElement).value).toBe("fr");
    expect((screen.getByTestId("lyrics-size") as HTMLSelectElement).value).toBe("base");
  });

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

  // Whisper in the browser is always there, so there is always a way to have the words heard.
  it("offers one button where there is one way to listen", () => {
    const { transcribed } = show();

    const button = screen.getByTestId("lyrics-transcribe");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("title")).toContain("bleibt auf diesem Gerät");

    fireEvent.click(button);

    expect(transcribed).toEqual([["med_a", "local", { language: "de", size: "small" }]]);
  });

  // Left to guess, Whisper took a German song for English and translated it.
  it("tells the transcriber the language and the size that were chosen", () => {
    const { transcribed } = show();

    fireEvent.change(screen.getByTestId("lyrics-language"), { target: { value: "en" } });
    fireEvent.change(screen.getByTestId("lyrics-size"), { target: { value: "turbo" } });
    fireEvent.click(screen.getByTestId("lyrics-transcribe"));

    expect(transcribed).toEqual([["med_a", "local", { language: "en", size: "turbo" }]]);
  });

  it("offers no browser model where nothing listens in the browser", () => {
    show({ transcribers: ["cloud"] });

    expect(screen.queryByTestId("lyrics-size")).toBeNull();
    expect(screen.getByTestId("lyrics-language")).toBeTruthy();
  });

  // One of them sends the song to a company. Which one is chosen, and the menu says where it goes.
  it("offers a menu where there is more than one, each saying where the song goes", () => {
    const { transcribed } = show({ transcribers: ["local", "cloud"] });

    const menu = screen.getByTestId("lyrics-transcribe");
    expect(menu.tagName).toBe("DETAILS");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Hier im Browser (Whisper) — der Ton bleibt auf diesem Gerät",
      "Bei ElevenLabs — der Ton geht an ElevenLabs",
    ]);

    fireEvent.click(items[1]!);

    expect(transcribed).toEqual([["med_a", "cloud", { language: "de", size: "small" }]]);
  });

  it("says how far a transcription has got, and can stop it", () => {
    const onStopTranscribing = vi.fn();
    show({ busy: "transcribe", hearing: { phase: "listening", fraction: 0.42 }, onStopTranscribing });

    expect(screen.getByTestId("lyrics-hearing").textContent).toContain("42 %");
    expect((document.querySelector("progress") as HTMLProgressElement).value).toBe(42);

    fireEvent.click(screen.getByTestId("lyrics-stop"));

    expect(onStopTranscribing).toHaveBeenCalledOnce();
  });

  it("draws the bar without a number where nobody can know one", () => {
    show({ busy: "transcribe", hearing: { phase: "sending" } });

    expect(screen.getByTestId("lyrics-hearing").textContent).toContain("Wird transkribiert");
    expect(document.querySelector("progress")?.hasAttribute("value")).toBe(false);
  });

  it("does not start a second one while one runs", () => {
    show({ busy: "transcribe", hearing: { phase: "decoding" } });

    expect((screen.getByTestId("lyrics-transcribe") as HTMLButtonElement).disabled).toBe(true);
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

    expect((screen.getByLabelText("Text von Zeile 1") as HTMLInputElement).value).toBe("one");
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

  describe("correcting the lines by hand", () => {
    const found: FoundLyrics = {
      lines: [
        { at: 1000, until: 2500, text: "Ich stehe hier" },
        { at: 3000, until: 4000, text: "Die Stat" },
      ],
      timed: true,
      from: "transcript",
    };

    it("takes a corrected word", () => {
      const { edited } = show({ found });

      fireEvent.change(screen.getByLabelText("Text von Zeile 2"), { target: { value: "Die Stadt" } });

      expect(edited.at(-1)?.lines[1]).toEqual({ at: 3000, until: 4000, text: "Die Stadt" });
      expect(edited.at(-1)?.lines[0]).toEqual(found.lines[0]);
    });

    it("takes a corrected start and end", () => {
      const { edited } = show({ found });

      fireEvent.blur(screen.getByLabelText("Beginn von Zeile 1"), { target: { value: "0:01.20" } });
      fireEvent.blur(screen.getByLabelText("Ende von Zeile 1"), { target: { value: "2,75" } });

      expect(edited[0]?.lines[0]?.at).toBe(1200);
      expect(edited[1]?.lines[0]?.until).toBe(2750);
    });

    it("ignores a time that is not one", () => {
      const { edited } = show({ found });

      fireEvent.blur(screen.getByLabelText("Beginn von Zeile 1"), { target: { value: "gleich" } });

      expect(edited).toEqual([]);
    });

    it("shows the times it has, to the hundredth", () => {
      show({ found: { ...found, lines: [{ at: 83450, until: 84000, text: "x" }] } });

      expect((screen.getByLabelText("Beginn von Zeile 1") as HTMLInputElement).value).toBe("1:23.45");
    });

    it("removes a line and adds one after the last", () => {
      const { edited } = show({ found });

      fireEvent.click(screen.getByRole("button", { name: "Zeile 1 entfernen" }));
      fireEvent.click(screen.getByTestId("lyrics-add-line"));

      expect(edited[0]?.lines).toEqual([found.lines[1]]);
      expect(edited[1]?.lines.at(-1)).toEqual({ at: 4500, until: 6500, text: "" });
    });

    it("offers no times for lines that came without any", () => {
      show({ found: { lines: [{ at: 0, text: "one" }], timed: false, from: "text" } });

      expect(screen.queryByLabelText("Beginn von Zeile 1")).toBeNull();
      expect(screen.getByLabelText("Text von Zeile 1")).toBeTruthy();
    });
  });
});

describe("reading a typed time", () => {
  it("reads minutes and seconds, seconds alone, and a decimal comma", () => {
    expect(parseClock("1:23.45")).toBe(83450);
    expect(parseClock("83.45")).toBe(83450);
    expect(parseClock(" 2,5 ")).toBe(2500);
  });

  it("reads nothing else", () => {
    expect(parseClock("")).toBeUndefined();
    expect(parseClock("1:2:3")).toBeUndefined();
    expect(parseClock("-1")).toBeUndefined();
  });
});
