import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { FetchDialog, looksLikeLink, type FetchDialogProps } from "./FetchDialog";

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

function show(over: Partial<FetchDialogProps> = {}): {
  onSearch: ReturnType<typeof vi.fn>;
  onRead: ReturnType<typeof vi.fn>;
  onFetch: ReturnType<typeof vi.fn>;
} {
  const handlers = { onSearch: vi.fn(), onRead: vi.fn(), onFetch: vi.fn() };
  render(
    <I18nProvider>
      <FetchDialog
        available
        results={[]}
        onClose={() => undefined}
        {...handlers}
        {...over}
      />
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

describe("FetchDialog", () => {
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

    type("die bühne");
    fireEvent.keyDown(screen.getByLabelText("Link oder Suche"), { key: "Enter" });

    expect(handlers.onSearch).toHaveBeenCalledWith("die bühne");
  });

  it("shows a result with its picture, its channel and how long it runs", () => {
    show({ results: FOUND });

    const first = screen.getByText("Die Bühne, zweiter Abend").closest("button");
    expect(first).not.toBeNull();
    expect(first?.querySelector("img")?.getAttribute("src")).toBe("https://i.example/abc.jpg");
    expect(first?.textContent).toContain("Ein Kanal");
    expect(first?.textContent).toContain("12:34");
  });

  it("asks for nothing until a result has been chosen", () => {
    show({ results: FOUND });

    expect((screen.getByRole("button", { name: "In die Bibliothek" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fetches the one that was chosen, with the format asked for", () => {
    const handlers = show({ results: FOUND });

    fireEvent.click(screen.getByText("Die Probe"));
    fireEvent.change(screen.getByLabelText("Höchstens"), { target: { value: "720" } });
    fireEvent.click(screen.getByRole("button", { name: "In die Bibliothek" }));

    expect(handlers.onFetch).toHaveBeenCalledWith({
      url: "https://www.youtube.com/watch?v=def",
      kind: "video",
      format: "mp4",
      quality: "720",
    });
  });

  it("offers sound formats once sound alone is what is wanted, and no resolution", () => {
    const handlers = show({ results: FOUND });
    fireEvent.click(screen.getByText("Die Probe"));

    fireEvent.change(screen.getByLabelText("Was geholt wird"), { target: { value: "audio" } });

    // A height means nothing to a sound file, and mp4 is not a sound format: the choice moves with
    // the kind rather than staying on a word the tool would refuse.
    expect(screen.queryByLabelText("Höchstens")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "In die Bibliothek" }));
    expect(handlers.onFetch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "audio", format: "m4a" }),
    );
  });

  it("takes a single answer as the choice, because one link is one video", () => {
    const handlers = show({ results: [FOUND[1]!] });

    fireEvent.click(screen.getByRole("button", { name: "In die Bibliothek" }));

    expect(handlers.onFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://www.youtube.com/watch?v=def" }),
    );
  });

  it("says so where the server cannot fetch, instead of offering what cannot happen", () => {
    show({ available: false });

    expect(screen.getByTestId("fetch-unavailable")).not.toBeNull();
    expect((screen.getByLabelText("Link oder Suche") as HTMLInputElement).disabled).toBe(true);
  });

  it("puts the server's own words up when something failed", () => {
    show({ error: "Video unavailable" });

    expect(screen.getByRole("alert").textContent).toBe("Video unavailable");
  });

  it("says which wait this is", () => {
    show({ busy: "fetching", results: [FOUND[1]!] });

    expect((screen.getByRole("button", { name: "Wird geladen …" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
