import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { EffectBrowser, type EffectOffer } from "./EffectBrowser";

const OFFERS: readonly EffectOffer[] = [
  {
    id: "brightness",
    name: { de: "Helligkeit", en: "Brightness" },
    blurb: { de: "Hebt oder senkt das Bild.", en: "Lifts or lowers the picture." },
    category: "color",
    inputs: 1,
  },
  {
    id: "blur",
    name: { de: "Weichzeichnen", en: "Blur" },
    blurb: { de: "Zeichnet das Bild weich.", en: "Softens the picture." },
    category: "detail",
    inputs: 1,
  },
  {
    id: "crossfade",
    name: { de: "Überblendung", en: "Cross dissolve" },
    blurb: { de: "Blendet über.", en: "Dissolves into this one." },
    category: "transition",
    inputs: 2,
  },
];

const TILES = new Map([
  ["brightness", "blob:brightness"],
  ["blur", "blob:blur"],
  ["crossfade", "blob:crossfade"],
]);

function show(over: Partial<Parameters<typeof EffectBrowser>[0]> = {}): {
  onAdd: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <EffectBrowser
        offers={OFFERS}
        taken={[]}
        tiles={TILES}
        onAdd={onAdd}
        onClose={onClose}
        {...over}
      />
    </I18nProvider>,
  );
  return { onAdd, onClose };
}

function headings(): string[] {
  return screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent ?? "");
}

function tileNames(): string[] {
  return screen.getAllByRole("heading", { level: 4 }).map((node) => node.textContent ?? "");
}

afterEach(() => {
  localStorage.clear();
});

describe("EffectBrowser", () => {
  it("sorts the offers under their categories, most reached-for first", () => {
    show();
    expect(headings()).toEqual(["Farbe", "Schärfe und Unschärfe", "Übergänge"]);
  });

  it("puts every offer under the heading of its own category", () => {
    show();
    const detail = screen.getByRole("heading", { level: 3, name: "Schärfe und Unschärfe" })
      .parentElement as HTMLElement;
    expect(within(detail).getAllByRole("heading", { level: 4 }).map((n) => n.textContent)).toEqual([
      "Weichzeichnen",
    ]);
  });

  it("says what each effect does, not only what it is called", () => {
    show();
    expect(screen.getByText("Hebt oder senkt das Bild.")).toBeTruthy();
  });

  it("shows the tile it was handed for each effect", () => {
    show();
    expect(screen.getByTestId("fx-tile-blur").getAttribute("src")).toBe("blob:blur");
  });

  // A tile that has not been drawn yet must not be faked with a stand-in picture: the frame is
  // there and empty, and the only thing that says "not yet" is the state on it.
  it("shows no picture at all while the tiles are still being drawn", () => {
    show({ tiles: undefined });
    expect(screen.queryByTestId("fx-tile-blur")).toBeNull();
    expect(document.querySelectorAll(".v-fx__picture[data-pending]").length).toBe(3);
  });

  it("leaves an effect whose tile could not be made without one rather than showing a stand-in", () => {
    show({ tiles: new Map([["blur", "blob:blur"]]) });
    expect(screen.queryByTestId("fx-tile-brightness")).toBeNull();
    expect(screen.getByTestId("fx-tile-blur")).toBeTruthy();
  });

  it("searches the sentence under the name, not only the name", () => {
    show();
    fireEvent.change(screen.getByLabelText("Suchen"), { target: { value: "zeichnet das bild weich" } });
    expect(tileNames()).toEqual(["Weichzeichnen"]);
  });

  it("finds an effect by its English name while the surface is German", () => {
    show();
    fireEvent.change(screen.getByLabelText("Suchen"), { target: { value: "blur" } });
    expect(tileNames()).toEqual(["Weichzeichnen"]);
  });

  it("says so when nothing matches, and names what was typed", () => {
    show();
    fireEvent.change(screen.getByLabelText("Suchen"), { target: { value: "zzz" } });
    expect(screen.getByText("Nichts gefunden für „zzz“.")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 4 })).toEqual([]);
  });

  it("hands the chosen effect's id back", () => {
    const { onAdd } = show();
    const tile = document.querySelector('[data-effect-id="blur"]') as HTMLElement;
    fireEvent.click(within(tile).getByRole("button", { name: "Hinzufügen" }));
    expect(onAdd).toHaveBeenCalledWith("blur");
  });

  // A transition replaces the one the clip has rather than joining a chain, and the button says so
  // before it is pressed.
  it("offers a transition as a transition", () => {
    show();
    expect(screen.getByRole("button", { name: "Als Übergang setzen" })).toBeTruthy();
  });

  it("refuses a second copy of an effect the clip already carries", () => {
    const { onAdd } = show({ taken: ["brightness"] });
    const button = screen.getByRole("button", { name: "Bereits gesetzt" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = show();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("is a dialog that takes the focus, so the keyboard is inside it", () => {
    show();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
  });

  it("shows an effect from a category this build has no name for rather than hiding it", () => {
    show({
      offers: [
        ...OFFERS,
        {
          id: "lut",
          name: { de: "LUT", en: "LUT" },
          blurb: { de: "Farbtabelle.", en: "Colour table." },
          category: "grade",
          inputs: 1,
        },
      ],
    });
    expect(headings()).toEqual(["Farbe", "Schärfe und Unschärfe", "Übergänge", "grade"]);
    expect(tileNames()).toContain("LUT");
  });

  // Both catalogues carry every key this dialog asks for; a heading that fell back to its bare id
  // would be the surface admitting one of them is short an entry.
  it("names its categories in English too", () => {
    localStorage.setItem("videola.locale", "en");
    show();
    expect(headings()).toEqual(["Colour", "Sharpness and blur", "Transitions"]);
    expect(screen.getByRole("button", { name: "Set as transition" })).toBeTruthy();
  });
});
