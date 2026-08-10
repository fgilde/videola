import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Rate } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { defaultBitrate, ExportDialog, percentOf } from "./ExportDialog";

import type { ExportDialogProps, ExportSelection } from "./ExportDialog";

const NTSC: Rate = { numerator: 30000, denominator: 1001 };
const FLAT: Rate = { numerator: 30, denominator: 1 };

const BOTH = [
  { id: "mp4", video: true, audio: true },
  { id: "webm", video: true, audio: true },
];

function show(overrides: Partial<ExportDialogProps> = {}): {
  exported: ExportSelection[];
  props: ExportDialogProps;
} {
  const exported: ExportSelection[] = [];
  const props: ExportDialogProps = {
    formats: BOTH,
    settings: { width: 1920, height: 1080, fps: FLAT },
    hasSelection: false,
    onExport: (selection) => exported.push(selection),
    onCancel: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <ExportDialog {...props} />
    </I18nProvider>,
  );
  return { exported, props };
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement;
}

describe("defaultBitrate", () => {
  it("grows with pixels and with the rate", () => {
    expect(defaultBitrate(1920, 1080, FLAT)).toBeGreaterThan(defaultBitrate(1280, 720, FLAT));
    expect(defaultBitrate(1920, 1080, { numerator: 60, denominator: 1 })).toBe(
      2 * defaultBitrate(1920, 1080, FLAT),
    );
  });

  it("reads the rate as a rational", () => {
    expect(defaultBitrate(1920, 1080, NTSC)).toBeLessThan(defaultBitrate(1920, 1080, FLAT));
    expect(defaultBitrate(1920, 1080, NTSC)).toBeGreaterThan(
      0.99 * defaultBitrate(1920, 1080, FLAT),
    );
  });

  it("refuses to divide by a broken rate", () => {
    expect(defaultBitrate(1920, 1080, { numerator: 30, denominator: 0 })).toBe(0);
  });
});

describe("percentOf", () => {
  it("reaches a hundred on the last frame", () => {
    expect(percentOf({ done: 30, total: 30 })).toBe(100);
    expect(percentOf({ done: 29, total: 30 })).toBe(96);
  });

  it("has nothing to report before the first frame", () => {
    expect(percentOf({ done: 0, total: 30 })).toBe(0);
    expect(percentOf({ done: 0, total: 0 })).toBe(0);
  });
});

describe("ExportDialog", () => {
  it("offers only what the machine can encode", () => {
    show({ formats: [{ id: "mp4", video: false, audio: false }, ...BOTH.slice(1)] });
    const options = [...(field("Format") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["webm"]);
  });

  it("says why MP4 is missing, in the catalogue's words", () => {
    show({ formats: [{ id: "mp4", video: false, audio: false }, ...BOTH.slice(1)] });
    expect(screen.getByText(/kein H\.264/)).toBeTruthy();
  });

  it("says nothing about a fallback when the preferred format works", () => {
    show();
    expect(screen.queryByText(/kein H\.264/)).toBeNull();
  });

  it("warns when the sound cannot be encoded", () => {
    show({ formats: [{ id: "mp4", video: true, audio: false }] });
    expect(screen.getByText(/stumm/)).toBeTruthy();
  });

  it("refuses to start when nothing can be encoded at all", () => {
    show({ formats: [{ id: "mp4", video: false, audio: false }] });
    expect(screen.getByText(/keines der angebotenen Formate/)).toBeTruthy();
    expect((screen.getByText("Export starten") as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts with the project's own settings", () => {
    const { exported } = show({ settings: { width: 1280, height: 720, fps: NTSC } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]).toMatchObject({ formatId: "mp4", width: 1280, height: 720, fps: NTSC });
  });

  it("fills the size fields from a preset, and keeps the project's frame rate", () => {
    const { exported } = show({ settings: { width: 1280, height: 720, fps: NTSC } });
    fireEvent.change(field("Vorgabe"), { target: { value: "vertical" } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]).toMatchObject({ width: 1080, height: 1920, fps: NTSC });
  });

  // A bitrate typed for 720p is not the bitrate for 4K. The field goes back to being derived, which is
  // the one thing a preset cannot honestly leave alone.
  it("lets the bitrate follow the size a preset chose, even after one was typed", () => {
    const { exported } = show();
    fireEvent.change(field("Bitrate (Mbit/s)"), { target: { value: "4" } });
    fireEvent.change(field("Vorgabe"), { target: { value: "uhd" } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]?.videoBitrate).toBe(defaultBitrate(3840, 2160, FLAT));
  });

  it("stays on its own heading after a pick, so it names an action and not a state", () => {
    show();
    fireEvent.change(field("Vorgabe"), { target: { value: "hd" } });
    expect((field("Vorgabe") as HTMLSelectElement).value).toBe("");
  });

  it("keeps the frame rate rational when one is chosen", () => {
    const { exported } = show();
    fireEvent.change(field("Bilder pro Sekunde"), { target: { value: "30000/1001" } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]?.fps).toEqual(NTSC);
  });

  it("reports the bitrate in bits per second, not in megabits", () => {
    const { exported } = show();
    fireEvent.change(field("Bitrate (Mbit/s)"), { target: { value: "12" } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]?.videoBitrate).toBe(12_000_000);
  });

  it("follows the resolution until the bitrate is set by hand", () => {
    const { exported } = show();
    fireEvent.change(field("Breite"), { target: { value: "960" } });
    fireEvent.change(field("Höhe"), { target: { value: "540" } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]?.videoBitrate).toBe(defaultBitrate(960, 540, FLAT));

    fireEvent.change(field("Bitrate (Mbit/s)"), { target: { value: "3" } });
    fireEvent.change(field("Breite"), { target: { value: "1920" } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[1]?.videoBitrate).toBe(3_000_000);
  });

  it("keeps both edges even, because every codec here halves the chroma", () => {
    const { exported } = show();
    fireEvent.change(field("Breite"), { target: { value: "961" } });
    fireEvent.change(field("Höhe"), { target: { value: "543" } });
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]).toMatchObject({ width: 960, height: 542 });
  });

  it("offers the selection only when there is one", () => {
    show();
    expect(screen.queryByLabelText("Auswahl")).toBeNull();
  });

  it("exports the selection when it is chosen", () => {
    const { exported } = show({ hasSelection: true });
    fireEvent.click(screen.getByLabelText("Auswahl"));
    fireEvent.click(screen.getByText("Export starten"));
    expect(exported[0]?.range).toBe("selection");
  });

  it("shows how far along a run is", () => {
    show({ progress: { done: 15, total: 30 } });
    expect(screen.getByRole("status").textContent).toContain("50");
  });

  it("swaps closing for cancelling while a run is on", () => {
    const { props } = show({ progress: { done: 1, total: 30 } });
    expect(screen.queryByText("Schließen")).toBeNull();
    fireEvent.click(screen.getByText("Abbrechen"));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("cannot be started twice", () => {
    show({ progress: { done: 1, total: 30 } });
    expect((screen.getByText("Export starten") as HTMLButtonElement).disabled).toBe(true);
  });

  it("leaves the settings alone while a run is on", () => {
    show({ progress: { done: 1, total: 30 } });
    expect((field("Breite") as HTMLInputElement).disabled).toBe(true);
    expect((field("Format") as HTMLSelectElement).disabled).toBe(true);
  });

  it("closes on escape", () => {
    const { props } = show();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("does not abandon a run on escape", () => {
    const { props } = show({ progress: { done: 1, total: 30 } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("shows a failure as the catalogue's sentence, not as a key", () => {
    show({ error: "error.exportFailed" });
    expect(screen.getByRole("alert").textContent).toBe("Der Export ist fehlgeschlagen.");
  });
});

describe("what becomes of the captions", () => {
  const CAPTIONABLE = [
    { id: "mp4", video: true, audio: true, subtitles: true },
    { id: "webm", video: true, audio: true, subtitles: true },
  ];

  it("is not asked at all in a project with no captions", () => {
    show({ formats: CAPTIONABLE });
    expect(screen.queryByLabelText("Ins Bild")).toBeNull();
  });

  it("burns them into the picture unless told otherwise", () => {
    const { exported } = show({ formats: CAPTIONABLE, hasCaptions: true });
    fireEvent.click(screen.getByRole("button", { name: "Export starten" }));
    expect(exported[0]?.captions).toBe("burned");
  });

  it("carries the choice of a separate track through to the run", () => {
    const { exported } = show({ formats: CAPTIONABLE, hasCaptions: true });
    fireEvent.click(screen.getByLabelText("Als eigene Spur"));
    fireEvent.click(screen.getByRole("button", { name: "Export starten" }));
    expect(exported[0]?.captions).toBe("separate");
  });

  it("carries the choice to leave them out", () => {
    const { exported } = show({ formats: CAPTIONABLE, hasCaptions: true });
    fireEvent.click(screen.getByLabelText("Weglassen"));
    fireEvent.click(screen.getByRole("button", { name: "Export starten" }));
    expect(exported[0]?.captions).toBe("none");
  });

  // A switch the writer cannot honour must not be offered, and must not start a run that quietly
  // does something else. Both halves, because the radio alone leaves the choice reachable by a
  // format changed after it was made.
  it("greys the separate track out where the format cannot carry one, and never sends it", () => {
    const { exported } = show({
      formats: [{ id: "mp4", video: true, audio: true, subtitles: false }],
      hasCaptions: true,
    });
    const separate = screen.getByLabelText("Als eigene Spur") as HTMLInputElement;
    expect(separate.disabled).toBe(true);
    expect(screen.getByText("Dieses Format kann keine eigene Untertitelspur tragen")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Export starten" }));
    expect(exported[0]?.captions).toBe("burned");
  });
});
