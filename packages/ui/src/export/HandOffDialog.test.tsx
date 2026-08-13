import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { HandOffDialog, type HandOffKind } from "./HandOffDialog";

function show(available?: Partial<Record<HandOffKind, boolean>>): {
  chosen: HandOffKind[];
  closed: () => number;
} {
  const chosen: HandOffKind[] = [];
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <HandOffDialog
        available={available}
        onChoose={(kind) => chosen.push(kind)}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { chosen, closed: () => onClose.mock.calls.length };
}

const card = (kind: HandOffKind): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`[data-kind="${kind}"]`)!;

describe("the hand-off dialogue", () => {
  // The whole reason it exists: three menu lines reading "Export EDL", "Export FCPXML", "Export
  // Premiere XML" assume the reader already knows what those are.
  it("says what each file is and which program opens it", () => {
    show();

    expect(card("edl").textContent).toContain("Schnittliste");
    expect(card("edl").textContent).toContain("Timecode");
    expect(card("fcpxml").textContent).toContain("DaVinci Resolve");
    expect(card("xmeml").textContent).toContain("Premiere Pro");
  });

  it("offers every way out of the program, the cut and the parts", () => {
    show();

    expect([...document.querySelectorAll("[data-kind]")].map((node) => node.getAttribute("data-kind"))).toEqual([
      "fcpxml",
      "xmeml",
      "edl",
      "captions",
      "audiola",
    ]);
  });

  it("hands the chosen file up by name", () => {
    const { chosen } = show();

    fireEvent.click(card("xmeml"));

    expect(chosen).toEqual(["xmeml"]);
  });

  // A project with no subtitles has none to write, and a button that writes an empty file is worse
  // than a button that says why it is off.
  it("turns off what this project cannot write, and says why", () => {
    show({ captions: false });

    expect(card("captions").disabled).toBe(true);
    expect(card("captions").textContent).toContain("keine Untertitel");
    expect(card("fcpxml").disabled).toBe(false);
  });

  it("warns that no interchange file carries an effect", () => {
    show();

    expect(screen.getByText(/Keine dieser Dateien trägt Effekte/)).toBeTruthy();
  });

  it("closes on escape, like every other panel over the editor", () => {
    const { closed } = show();

    fireEvent.keyDown(screen.getByTestId("hand-off"), { key: "Escape" });

    expect(closed()).toBe(1);
  });
});
