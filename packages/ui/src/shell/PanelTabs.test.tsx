import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { PanelTabs, type EditorPanel } from "./PanelTabs";

function show(panel: EditorPanel): Mock<(panel: EditorPanel) => void> {
  const onSelect: Mock<(panel: EditorPanel) => void> = vi.fn();
  render(
    <I18nProvider>
      <PanelTabs panel={panel} onSelect={onSelect} />
    </I18nProvider>,
  );
  return onSelect;
}

const pressed = (): Record<string, string | null> =>
  Object.fromEntries(
    screen
      .getAllByRole("button")
      .map((button) => [button.textContent, button.getAttribute("aria-pressed")]),
  );

describe("PanelTabs", () => {
  it("offers every panel and says which one is showing", () => {
    show("timeline");

    expect(pressed()).toEqual({ Medien: "false", Zeitleiste: "true", Mischpult: "false" });
  });

  it("marks the library once that is the one showing", () => {
    show("library");

    expect(pressed()).toEqual({ Medien: "true", Zeitleiste: "false", Mischpult: "false" });
  });

  it("marks the mixer once that is the one showing", () => {
    show("mixer");

    expect(pressed()).toEqual({ Medien: "false", Zeitleiste: "false", Mischpult: "true" });
  });

  it("reports the panel that was asked for", () => {
    const onSelect = show("timeline");

    fireEvent.click(screen.getByText("Medien"));

    expect(onSelect.mock.calls).toEqual([["library"]]);
  });
});
