import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

function stubEnvironment(width = 1440): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("any-pointer: fine") || query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    stubEnvironment();
  });

  it("renders the title and the German action labels by default", () => {
    render(<AppShell>content</AppShell>);
    // The brand is an image, so the product name has to survive as its accessible name.
    expect(screen.getByRole("img", { name: "Videola" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  });

  it("exposes the resolved layout mode on the root element", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByTestId("app-shell").dataset.layout).toBe("desktop");
  });

  it("switches every action label when the language changes", () => {
    render(<AppShell>content</AppShell>);
    act(() => screen.getByRole("button", { name: "Deutsch / English" }).click());
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add track" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("renders its children in the content area", () => {
    render(
      <AppShell>
        <p>Zeitleiste kommt hier hin</p>
      </AppShell>,
    );
    expect(screen.getByText("Zeitleiste kommt hier hin")).toBeTruthy();
  });

  it("disables undo and redo until an action reports otherwise", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole("button", { name: "Rückgängig" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Wiederholen" }).hasAttribute("disabled")).toBe(true);
  });

  it("enables undo once the caller reports canUndo", () => {
    render(<AppShell canUndo>content</AppShell>);
    expect(screen.getByRole("button", { name: "Rückgängig" }).hasAttribute("disabled")).toBe(false);
  });

  it("enables redo once the caller reports canRedo", () => {
    render(<AppShell canRedo>content</AppShell>);
    expect(screen.getByRole("button", { name: "Wiederholen" }).hasAttribute("disabled")).toBe(false);
  });

  // jsdom does no layout, so this only guards against a button vanishing from the DOM (e.g.
  // a future collapse-to-menu). It cannot see the CSS overflow-x fix that keeps buttons
  // reachable on real phone widths - only a real-browser check catches that regressing.
  it("keeps every action button in the DOM at phone width", () => {
    stubEnvironment(390);
    render(
      <AppShell layoutPreference="phone" onNew={() => {}} onOpen={() => {}} onImport={() => {}}>
        content
      </AppShell>,
    );
    expect(screen.getByTestId("app-shell").dataset.layout).toBe("phone");
    for (const name of ["Neues Projekt", "Öffnen", "Spur hinzufügen", "Rückgängig", "Wiederholen", "Speichern"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("toggles the theme when the appearance button is clicked", () => {
    render(<AppShell>content</AppShell>);
    // stubEnvironment's matchMedia reports dark, so the shell starts in dark mode and the
    // button is labelled with the state it would switch to.
    act(() => screen.getByRole("button", { name: "Hell" }).click());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Dunkel" })).toBeTruthy();
  });
});
