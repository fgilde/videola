import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { ImportDialog, looksLikeLink, type ImportDialogProps } from "./ImportDialog";

const FOUND = [
  {
    id: "abc",
    title: "Die Bühne, zweiter Abend",
    url: "https://www.youtube.com/watch?v=abc",
    duration: 754,
    uploader: "Ein Kanal",
    thumbnail: "https://i.example/abc.jpg",
  },
  {
    id: "def",
    title: "Die Probe",
    url: "https://www.youtube.com/watch?v=def",
    duration: 61,
  },
];

function show(over: Partial<ImportDialogProps> = {}): {
  onFiles: ReturnType<typeof vi.fn>;
  onPick: ReturnType<typeof vi.fn>;
  onSearch: ReturnType<typeof vi.fn>;
  onRead: ReturnType<typeof vi.fn>;
  onFetch: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onFiles: vi.fn(),
    onPick: vi.fn(),
    onSearch: vi.fn(),
    onRead: vi.fn(),
    onFetch: vi.fn(),
  };
  render(
    <I18nProvider>
      <ImportDialog canFetch results={[]} onClose={() => undefined} {...handlers} {...over} />
    </I18nProvider>,
  );
  return handlers;
}

function type(text: string): void {
  fireEvent.change(screen.getByLabelText("Link oder Suche"), { target: { value: text } });
}

describe("looksLikeLink", () => {
  it("knows a link from a search", () => {
    expect(looksLikeLink("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(looksLikeLink("youtube.com/watch?v=abc")).toBe(true);
    expect(looksLikeLink("die bühne zweiter abend")).toBe(false);
    // Two words with a dot in them is a search somebody typed, not an address.
    expect(looksLikeLink("mr. bean")).toBe(false);
    expect(looksLikeLink("")).toBe(false);
  });
});

describe("ImportDialog", () => {
  it("offers both ways in at once", () => {
    show();

    // The whole point of merging the two: a person with a file and a person with a link are in the
    // same dialogue, and neither had to find a menu entry the other one uses.
    expect(screen.getByTestId("import-drop")).not.toBeNull();
    expect(screen.getByLabelText("Link oder Suche")).not.toBeNull();
  });

  it("takes files dropped on it", () => {
    const handlers = show();
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });

    fireEvent.drop(screen.getByTestId("import-drop"), { dataTransfer: { files: [file] } });

    expect(handlers.onFiles).toHaveBeenCalledWith([file]);
  });

  it("opens the picker for anybody who would rather click", () => {
    const handlers = show();

    fireEvent.click(screen.getByRole("button", { name: "Dateien wählen" }));

    expect(handlers.onPick).toHaveBeenCalled();
  });

  it("searches for words and reads a link, from the one field", () => {
    const handlers = show();

    type("die bühne");
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }));
    expect(handlers.onSearch).toHaveBeenCalledWith("die bühne");

    type("https://ok.test/v");
    fireEvent.click(screen.getByRole("button", { name: "Link lesen" }));
    expect(handlers.onRead).toHaveBeenCalledWith("https://ok.test/v");
  });

  it("takes the return key as the question", () => {
    const handlers = show();

    type("https://ok.test/v");
    fireEvent.keyDown(screen.getByLabelText("Link oder Suche"), { key: "Enter" });

    expect(handlers.onRead).toHaveBeenCalledWith("https://ok.test/v");
  });

  it("shows a result with its picture, its channel and how long it runs", () => {
    show({ results: FOUND });

    const first = screen.getByText("Die Bühne, zweiter Abend").closest("button");
    expect(first?.querySelector("img")?.getAttribute("src")).toBe("https://i.example/abc.jpg");
    expect(first?.textContent).toContain("Ein Kanal");
    expect(first?.textContent).toContain("12:34");
  });

  it("downloads the one that was chosen, with every option it was given", () => {
    const handlers = show({ results: FOUND });

    fireEvent.click(screen.getByText("Die Probe"));
    fireEvent.change(screen.getByLabelText("Codec"), { target: { value: "h264" } });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "mp4" } });
    fireEvent.change(screen.getByLabelText("Qualität"), { target: { value: "1080" } });
    fireEvent.click(screen.getByRole("button", { name: "Laden und importieren" }));

    expect(handlers.onFetch).toHaveBeenCalledWith({
      url: "https://www.youtube.com/watch?v=def",
      kind: "video",
      codec: "h264",
      format: "mp4",
      quality: "1080",
    });
  });

  it("offers bitrates rather than heights once sound alone is wanted", () => {
    const handlers = show({ results: FOUND });
    fireEvent.click(screen.getByText("Die Probe"));

    fireEvent.change(screen.getByLabelText("Art"), { target: { value: "audio" } });

    // No codec and no resolution for a sound file, and the qualities are the ones that format has:
    // MP3 goes to 320, M4A does not.
    expect(screen.queryByLabelText("Codec")).toBeNull();
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "mp3" } });
    fireEvent.change(screen.getByLabelText("Qualität"), { target: { value: "320" } });
    fireEvent.click(screen.getByRole("button", { name: "Laden und importieren" }));

    expect(handlers.onFetch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "audio", format: "mp3", quality: "320" }),
    );
  });

  it("takes a single answer as the choice, because one link is one video", () => {
    const handlers = show({ results: [FOUND[1]!] });

    fireEvent.click(screen.getByRole("button", { name: "Laden und importieren" }));

    expect(handlers.onFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://www.youtube.com/watch?v=def" }),
    );
  });

  it("shows how far a download has got", () => {
    show({ busy: "fetching", percent: 42, results: [FOUND[1]!] });

    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByRole("button", { name: /42/ })).not.toBeNull();
  });

  it("hands somebody without a server the command that starts one", () => {
    show({ canFetch: false });

    const setup = screen.getByTestId("import-no-server");
    // A command rather than a sentence about a missing binary: "install yt-dlp" is advice, and this
    // is the thing to paste.
    expect(setup.textContent).toContain("docker run");
    expect(setup.textContent).toContain("ghcr.io/fgilde/videola");
    // And the other half of the dialogue still works, because a file on this machine needs no server.
    expect(screen.getByTestId("import-drop")).not.toBeNull();
  });

  it("puts the server's own words up when something failed", () => {
    show({ error: "Video unavailable" });

    expect(screen.getByRole("alert").textContent).toBe("Video unavailable");
  });
});
