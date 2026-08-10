import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { Shortcuts } from "./Shortcuts";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

function show(onClose = (): void => undefined): void {
  render(
    <I18nProvider>
      <Shortcuts onClose={onClose} />
    </I18nProvider>,
  );
}

const keys = (): string[] =>
  [...document.querySelectorAll("kbd")].map((node) => node.textContent ?? "");

describe("the shortcut sheet", () => {
  // Every row has to be a key the editor really answers: `shortcut` in Timeline.tsx and
  // `useTransportKeys` in Transport.tsx are the whole roster. A sheet listing a key nobody handles
  // sends somebody looking for a fault in their keyboard.
  it("lists the transport keys the transport handles", () => {
    show();
    expect(keys()).toContain("Space");
    expect(keys()).toContain("J / K / L");
    expect(keys()).toContain("← / →");
    expect(keys()).toContain("Shift + ← / →");
  });

  it("lists the editing keys the timeline handles", () => {
    show();
    for (const key of [
      "Del / ⌫",
      "Shift + Del",
      "Strg/Cmd + C",
      "Strg/Cmd + X",
      "Strg/Cmd + V",
      "Strg/Cmd + G",
      "Shift + Strg/Cmd + G",
      "N",
      "M",
    ]) {
      expect(keys(), key).toContain(key);
    }
  });

  it("gives every key something it does", () => {
    show();
    const rows = [...document.querySelectorAll(".v-keys__row")];
    expect(rows.length).toBe(keys().length);
    for (const row of rows) {
      expect(row.querySelector("dd")?.textContent?.length ?? 0).toBeGreaterThan(4);
    }
  });

  // A key that only works while the timeline has the focus is a key somebody will report as broken.
  it("says which keys need the timeline to have the focus", () => {
    show();
    expect(screen.getByText(/Fokus in der Zeitleiste/)).toBeTruthy();
  });

  it("tells its host when it has closed", () => {
    const onClose = vi.fn();
    show(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
