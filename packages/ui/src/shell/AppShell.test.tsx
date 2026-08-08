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

// Where a control sits, not merely that it exists. jsdom lays nothing out, so "the topbar fits"
// can only be answered in a real browser -- but "this button is inside the overflow menu rather
// than on the bar" is a DOM fact, and it is the one that decides whether the bar can fit at all.
const inMenu = (name: string): boolean =>
  screen.getByRole("button", { name }).closest(".v-topbar__menu") !== null;

function renderPhone(): void {
  render(
    <AppShell
      layoutPreference="phone"
      onNew={() => {}}
      onOpen={() => {}}
      onImportMedia={() => {}}
      onAddTrack={() => {}}
      onSave={() => {}}
      onExport={() => {}}
    >
      content
    </AppShell>,
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
    expect(screen.getByRole("button", { name: "Import media" })).toBeTruthy();
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

  it("keeps every action reachable at phone width", () => {
    stubEnvironment(390);
    renderPhone();
    expect(screen.getByTestId("app-shell").dataset.layout).toBe("phone");
    for (const name of ["Neues Projekt", "Öffnen", "Medien importieren", "Spur hinzufügen", "Rückgängig", "Wiederholen", "Speichern", "Exportieren"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  // The bar itself may hold only the overflow toggle and the two controls a finger reaches for
  // constantly. Anything else on it is what pushed "Medien importie…" off the right edge.
  it("leaves nothing but undo and redo on the bar at phone width", () => {
    stubEnvironment(390);
    renderPhone();
    // By tag rather than by role: a <summary> is the native disclosure widget and carries no
    // button role, which is also why the browser harness cannot look it up as one.
    const onBar = [...document.querySelectorAll(".v-topbar button, .v-topbar summary")]
      .filter((node) => node.closest(".v-topbar__menu") === null)
      .map((node) => node.getAttribute("aria-label") ?? node.textContent);
    expect(onBar).toEqual(["Weitere Aktionen", "Rückgängig", "Wiederholen"]);
  });

  it("moves saving, exporting and the settings into the menu at phone width", () => {
    stubEnvironment(390);
    renderPhone();
    for (const name of ["Speichern", "Exportieren", "Deutsch / English", "Hell"]) {
      expect(inMenu(name)).toBe(true);
    }
  });

  // The desktop bar has room for those three, and burying an editor's save button where there is
  // space for it would be the same mistake in the other direction.
  it("keeps saving, exporting and the settings on the bar on a desktop", () => {
    render(<AppShell onSave={() => {}} onExport={() => {}}>content</AppShell>);
    for (const name of ["Speichern", "Exportieren", "Deutsch / English", "Hell"]) {
      expect(inMenu(name)).toBe(false);
    }
    expect(inMenu("Medien importieren")).toBe(true);
  });

  it("hides the wordmark on a phone, where the width it costs is a button", () => {
    stubEnvironment(390);
    renderPhone();
    expect(screen.queryByRole("img", { name: "Videola" })).toBeNull();
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
