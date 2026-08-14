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
// Every control with this name, wherever it is. A menu bar repeats itself on purpose -- File ▸ Save
// and the Save button on the bar are the same action in the two places people look for it -- so a
// lookup that insists on exactly one match is asking the wrong question.
const named = (name: string): HTMLElement[] => screen.queryAllByRole("button", { name });
const inMenu = (name: string): boolean =>
  named(name).some((node) => node.closest(".v-topbar__menu") !== null);
const onBar = (name: string): boolean =>
  named(name).some((node) => node.closest(".v-topbar__menu") === null);
// The titles of the menu bar, which are <summary> elements and carry no button role.
const titles = (): string[] =>
  [...document.querySelectorAll(".v-topbar__menus > details > summary")].map(
    (node) => node.textContent ?? "",
  );

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
    expect(onBar("Speichern")).toBe(true);
  });

  // The names every editor uses, in the order they are used. This is the whole of "where is import":
  // somebody who has used any other editor already knows which title to open.
  it("carries a menu bar rather than one pile of actions", () => {
    render(<AppShell>content</AppShell>);
    expect(titles()).toEqual(["Datei", "Bearbeiten", "Einfügen", "Projekt", "Ansicht", "Hilfe"]);
  });

  it("puts each action under the title somebody would look in", () => {
    render(<AppShell onImportMedia={() => {}} onAddTrack={() => {}} onKeys={() => {}}>content</AppShell>);
    // Buttons and summaries both: a group inside a menu is a disclosure, and "Format ändern" is its
    // label rather than an action of its own.
    const under = (id: string, name: string): boolean =>
      [
        ...(document
          .querySelector(`[data-testid="menu-${id}"]`)
          ?.querySelectorAll("button, summary") ?? []),
      ].some((node) => node.textContent === name);

    expect(under("file", "Medien importieren")).toBe(true);
    expect(under("file", "Weitergeben …")).toBe(true);
    expect(under("edit", "Spur hinzufügen")).toBe(true);
    expect(under("insert", "Bauchbinde")).toBe(true);
    expect(under("project", "Format ändern")).toBe(true);
    expect(under("help", "Tastenkürzel")).toBe(true);
  });

  it("exposes the resolved layout mode on the root element", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByTestId("app-shell").dataset.layout).toBe("desktop");
  });

  it("switches every action label when the language changes", () => {
    render(<AppShell>content</AppShell>);
    // The one on the bar, which is the one somebody who cannot read the menu titles will find.
    act(() => screen.getByTestId("locale-switch").click());
    for (const name of ["New project", "Open", "Import media", "Add track", "Undo", "Redo", "Save"]) {
      expect(named(name).length).toBeGreaterThan(0);
    }
    expect(titles()).toEqual(["File", "Edit", "Insert", "Project", "View", "Help"]);
  });

  it("renders its children in the content area", () => {
    render(
      <AppShell>
        <p>Zeitleiste kommt hier hin</p>
      </AppShell>,
    );
    expect(screen.getByText("Zeitleiste kommt hier hin")).toBeTruthy();
  });

  const barButton = (name: string): HTMLElement => {
    const found = named(name).find((node) => node.closest(".v-topbar__menu") === null);
    if (found === undefined) throw new Error(`no ${name} on the bar`);
    return found;
  };

  it("disables undo and redo until an action reports otherwise", () => {
    render(<AppShell>content</AppShell>);
    expect(barButton("Rückgängig").hasAttribute("disabled")).toBe(true);
    expect(barButton("Wiederholen").hasAttribute("disabled")).toBe(true);
  });

  it("enables undo once the caller reports canUndo", () => {
    render(<AppShell canUndo>content</AppShell>);
    expect(barButton("Rückgängig").hasAttribute("disabled")).toBe(false);
  });

  it("enables redo once the caller reports canRedo", () => {
    render(<AppShell canRedo>content</AppShell>);
    expect(barButton("Wiederholen").hasAttribute("disabled")).toBe(false);
  });

  // The same two inside the Edit menu, where they are words rather than symbols: a menu entry that
  // cannot act has to say so, exactly like the button on the bar.
  it("greys out undo in the menu while there is nothing to undo", () => {
    render(<AppShell>content</AppShell>);
    const entry = named("Rückgängig").find((node) => node.closest(".v-topbar__menu") !== null);
    expect(entry?.hasAttribute("disabled")).toBe(true);
  });

  it("keeps every action reachable at phone width", () => {
    stubEnvironment(390);
    renderPhone();
    expect(screen.getByTestId("app-shell").dataset.layout).toBe("phone");
    for (const name of ["Neues Projekt", "Öffnen", "Medien importieren", "Spur hinzufügen", "Rückgängig", "Wiederholen", "Speichern", "Exportieren"]) {
      expect(named(name).length).toBeGreaterThan(0);
    }
  });

  // The bar itself may hold only the overflow toggle and the two controls a finger reaches for
  // constantly. Anything else on it is what pushed "Medien importie…" off the right edge.
  it("leaves nothing but undo and redo on the bar at phone width", () => {
    stubEnvironment(390);
    renderPhone();
    // By tag rather than by role: a <summary> is the native disclosure widget and carries no
    // button role, which is also why the browser harness cannot look it up as one.
    const controls = [...document.querySelectorAll(".v-topbar button, .v-topbar summary")]
      .filter((node) => node.closest(".v-topbar__menu") === null)
      .map((node) => node.getAttribute("aria-label") ?? node.textContent);
    expect(controls).toEqual(["Weitere Aktionen", "Rückgängig", "Wiederholen",
      "Deutsch / English", "Speichern"]);
  });

  it("moves exporting and the settings into the menu at phone width", () => {
    stubEnvironment(390);
    renderPhone();
    for (const name of ["Exportieren", "Hell"]) {
      expect(inMenu(name)).toBe(true);
      expect(onBar(name)).toBe(false);
    }
    // The language is in both places on purpose: under View like every other preference, and on the
    // bar because it is the one a person reaches for before they can read the menu titles.
    expect(inMenu("Deutsch / English")).toBe(true);
    expect(onBar("Deutsch / English")).toBe(true);
    // Saving stays on the bar even there: it is the one action nobody should have to look for, and
    // it is one button wide.
    expect(onBar("Speichern")).toBe(true);
  });

  // The desktop bar has room for those two, and burying an editor's save button where there is
  // space for it would be the same mistake in the other direction. The preferences are in View,
  // which is where a person looks for them and not a place they had to be found by accident.
  it("keeps saving and exporting on the bar on a desktop", () => {
    render(<AppShell onSave={() => {}} onExport={() => {}}>content</AppShell>);
    for (const name of ["Speichern", "Exportieren"]) {
      expect(onBar(name)).toBe(true);
    }
    expect(inMenu("Deutsch / English")).toBe(true);
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
