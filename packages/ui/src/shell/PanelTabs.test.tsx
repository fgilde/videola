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

    expect(pressed()).toEqual({
      Medien: "false",
      Zeitleiste: "true",
      Eigenschaften: "false",
      Mischpult: "false",
      Messgeräte: "false",
    });
  });

  it("marks the library once that is the one showing", () => {
    show("library");

    expect(pressed()).toEqual({
      Medien: "true",
      Zeitleiste: "false",
      Eigenschaften: "false",
      Mischpult: "false",
      Messgeräte: "false",
    });
  });

  // The properties panel is what carries effects, keyframes and transitions. Without a tab of its
  // own it was squeezed between the transport and this bar, which made the phone a viewer.
  it("puts the properties panel one tap away", () => {
    const onSelect = show("timeline");

    fireEvent.click(screen.getByText("Eigenschaften"));

    expect(onSelect.mock.calls).toEqual([["inspector"]]);
  });

  it("marks the mixer once that is the one showing", () => {
    show("mixer");

    expect(pressed()).toEqual({
      Medien: "false",
      Zeitleiste: "false",
      Eigenschaften: "false",
      Mischpult: "true",
      Messgeräte: "false",
    });
  });

  // Without a tab the scopes exist on a desktop and nowhere else, and grading on a phone is
  // exactly the case where guessing at the picture is worst.
  it("puts the scopes one tap away", () => {
    const onSelect = show("timeline");

    fireEvent.click(screen.getByText("Messgeräte"));

    expect(onSelect.mock.calls).toEqual([["scopes"]]);
  });

  it("reports the panel that was asked for", () => {
    const onSelect = show("timeline");

    fireEvent.click(screen.getByText("Medien"));

    expect(onSelect.mock.calls).toEqual([["library"]]);
  });
});
