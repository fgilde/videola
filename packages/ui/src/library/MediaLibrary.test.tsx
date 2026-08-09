import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { FLICKS_PER_SECOND } from "@videola/core";

import type { MediaAsset, MediaId, Rate } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { MediaLibrary } from "./MediaLibrary";

const NTSC: Rate = { numerator: 30000, denominator: 1001 };
const PROJECT_FPS: Rate = { numerator: 25, denominator: 1 };

function video(id: string, over: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: `med_${id.repeat(64).slice(0, 64)}`,
    originalName: `${id}.mp4`,
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 100n,
    duration: 2 * FLICKS_PER_SECOND,
    width: 640,
    height: 360,
    fps: { numerator: 30, denominator: 1 },
    sampleRate: null,
    channels: null,
    ...over,
  };
}

interface Handlers {
  onImport: Mock<() => void>;
  onAdd: Mock<(media: MediaId) => void>;
  onRelink: Mock<(media: MediaId) => void>;
}

function show(library: MediaAsset[], missing: MediaId[] = []): Handlers {
  const handlers: Handlers = { onImport: vi.fn(), onAdd: vi.fn(), onRelink: vi.fn() };
  render(
    <I18nProvider>
      <MediaLibrary library={library} missing={new Set(missing)} fps={PROJECT_FPS} {...handlers} />
    </I18nProvider>,
  );
  return handlers;
}

const entry = (asset: MediaAsset): HTMLElement =>
  screen.getByTestId("library").querySelector(`[data-media-id="${asset.id}"]`) as HTMLElement;

describe("MediaLibrary", () => {
  it("shows every medium with its name, its length and its size in pixels", () => {
    const a = video("a");
    const b = video("b", { originalName: "b.mp4", duration: FLICKS_PER_SECOND, width: 1920, height: 1080 });
    show([a, b]);

    expect(within(entry(a)).getByText("a.mp4")).toBeTruthy();
    expect(within(entry(a)).getByText(/00:00:02\.00/)).toBeTruthy();
    expect(within(entry(a)).getByText(/640 × 360/)).toBeTruthy();
    expect(within(entry(b)).getByText(/00:00:01\.00/)).toBeTruthy();
    expect(within(entry(b)).getByText(/1920 × 1080/)).toBeTruthy();
  });

  // The lesson from the transport's timecode: at frame 30 a rational 30000/1001 and a round 30
  // land on the same string, so a rate read from the wrong place would walk straight through.
  it("counts a medium's length in that medium's own frame rate", () => {
    const ntsc = video("a", { duration: Math.round((1000 * 1001 * FLICKS_PER_SECOND) / 30000), fps: NTSC });
    show([ntsc]);

    expect(within(entry(ntsc)).getByText(/00:00:33\.10/)).toBeTruthy();
  });

  // A medium without a picture -- an audio file -- has no frame rate of its own, and the project's
  // timebase is the one its clip will live in.
  it("falls back to the project's frame rate where a medium has none", () => {
    const audio = video("a", {
      kind: "audio",
      mime: "audio/mp4",
      duration: FLICKS_PER_SECOND,
      width: null,
      height: null,
      fps: null,
      sampleRate: 48_000,
      channels: 2,
    });
    show([audio]);

    expect(within(entry(audio)).getByText(/00:00:01\.00/)).toBeTruthy();
    expect(within(entry(audio)).getByText(/48000 Hz/)).toBeTruthy();
    expect(within(entry(audio)).queryByText(/×/)).toBeNull();
  });

  it("offers the import that fills it while it is still empty", () => {
    const { onImport } = show([]);

    expect(screen.getByText(/Noch keine Medien/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Medien importieren" }));

    expect(onImport).toHaveBeenCalled();
  });

  it("puts the medium on the timeline it was asked for", () => {
    const a = video("a");
    const b = video("b", { originalName: "b.mp4" });
    const { onAdd } = show([a, b]);

    fireEvent.click(within(entry(b)).getByRole("button", { name: "Auf die Zeitleiste" }));

    expect(onAdd.mock.calls).toEqual([[b.id]]);
  });

  // Nothing downstream can honour a clip whose bytes are gone: no picture, no sound, no export.
  // Saying so and offering the way out beats a button that adds a black rectangle.
  it("marks a medium whose bytes are gone, refuses to place it, and offers the relink", () => {
    const a = video("a");
    const gone = video("b", { originalName: "b.mp4" });
    const { onRelink } = show([a, gone], [gone.id]);

    expect(within(entry(gone)).getByText("Daten fehlen")).toBeTruthy();
    expect(within(entry(a)).queryByText("Daten fehlen")).toBeNull();
    expect(
      within(entry(gone)).getByRole("button", { name: "Auf die Zeitleiste" }),
    ).toHaveProperty("disabled", true);
    expect(within(entry(a)).queryByRole("button", { name: "Neu verknüpfen" })).toBeNull();

    fireEvent.click(within(entry(gone)).getByRole("button", { name: "Neu verknüpfen" }));

    expect(onRelink.mock.calls).toEqual([[gone.id]]);
  });
});

// A proxy costs minutes of a fan spinning. Which media have one, and which one the machine is busy
// with, is the difference between an explained wait and an unexplained one.
describe("MediaLibrary and proxies", () => {
  function showProxies(
    library: MediaAsset[],
    proxies: Map<MediaId, "building" | "ready">,
    over: Partial<{ useOriginals: boolean; onUseOriginals: Mock<(on: boolean) => void> }> = {},
  ): void {
    render(
      <I18nProvider>
        <MediaLibrary
          library={library}
          missing={new Set()}
          fps={PROJECT_FPS}
          proxies={proxies}
          onImport={vi.fn()}
          onAdd={vi.fn()}
          onRelink={vi.fn()}
          {...over}
        />
      </I18nProvider>,
    );
  }

  it("says which medium has a proxy and which one is being given one", () => {
    const ready = video("a");
    const building = video("b", { originalName: "b.mp4" });
    const neither = video("c", { originalName: "c.mp4" });
    showProxies(
      [ready, building, neither],
      new Map([
        [ready.id, "ready"],
        [building.id, "building"],
      ]),
    );

    expect(within(entry(ready)).getByText("Proxy")).toBeTruthy();
    expect(within(entry(building)).getByText("Proxy wird erzeugt")).toBeTruthy();
    expect(within(entry(neither)).queryByText(/Proxy/)).toBeNull();
    expect(entry(neither).dataset.proxy).toBe("none");
  });

  // A medium without a proxy is not a broken medium. Nothing about the entry may say otherwise.
  it("leaves a medium without a proxy exactly as usable as one with", () => {
    const neither = video("c", { originalName: "c.mp4" });
    showProxies([neither], new Map());

    expect(
      within(entry(neither)).getByRole("button", { name: "Auf die Zeitleiste" }),
    ).toHaveProperty("disabled", false);
  });

  it("offers no switch where nothing can be switched", () => {
    showProxies([video("a")], new Map());

    expect(screen.queryByRole("button", { name: "Originale benutzen" })).toBeNull();
  });

  // The button names the state it is in, not the one it would go to: pressed means the preview is
  // on the originals.
  it("shows the switch as pressed while the preview is on the originals", () => {
    const onUseOriginals = vi.fn<(on: boolean) => void>();
    showProxies([video("a")], new Map(), { useOriginals: true, onUseOriginals });
    const button = screen.getByRole("button", { name: "Originale benutzen" });

    expect(button.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button);

    expect(onUseOriginals.mock.calls).toEqual([[false]]);
  });

  it("asks for the originals when the switch is off and pressed", () => {
    const onUseOriginals = vi.fn<(on: boolean) => void>();
    showProxies([video("a")], new Map(), { useOriginals: false, onUseOriginals });
    const button = screen.getByRole("button", { name: "Originale benutzen" });

    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);

    expect(onUseOriginals.mock.calls).toEqual([[true]]);
  });
});
