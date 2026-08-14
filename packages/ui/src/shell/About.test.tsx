import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { About } from "./About";

// jsdom implements <dialog> without the modal behaviour, so `showModal` has to exist for the effect
// that opens it not to throw. What is checked here is the content and the two decisions in it, not
// the browser's own focus trap.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

function show(desktop: boolean, onClose = (): void => undefined): void {
  render(
    <I18nProvider>
      <About version="0.5.0" desktop={desktop} onClose={onClose} />
    </I18nProvider>,
  );
}

function hrefs(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(".v-about a")].map((link) => link.href);
}

describe("the about dialogue", () => {
  it("names the version this build stamps into its own files", () => {
    show(false);
    expect(screen.getByText("Ausgabe 0.5.0")).toBeTruthy();
  });

  it("links the site, the documentation, the source and the licence", () => {
    show(false);
    const links = hrefs().join(" ");
    expect(links).toContain("videola.app/");
    expect(links).toContain("guide/getting-started");
    expect(links).toContain("github.com/fgilde/videola");
    expect(links).toContain("LICENSE");
  });

  it("credits the author and the workshop, both reachable", () => {
    show(false);
    const links = hrefs().join(" ");
    expect(links).toContain("florian.gilde.org");
    expect(links).toContain("gilde.org");
    expect(screen.getByText(/Florian Gilde/)).toBeTruthy();
  });

  // In a browser there is something to fetch. In the desktop build the same button would offer to
  // install what is already running.
  it("offers a desktop build in the browser and not in the desktop build", () => {
    show(false);
    expect(screen.getByRole("link", { name: "Desktop-Version holen" })).toBeTruthy();
  });

  it("says nothing about downloading when it is already the desktop build", () => {
    show(true);
    expect(screen.queryByRole("link", { name: "Desktop-Version holen" })).toBeNull();
  });

  it("tells its host when it has closed, so the host can forget it", () => {
    const onClose = vi.fn();
    show(false, onClose);

    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Every link leaves the page, and a target of `_blank` without `noreferrer` hands the new window a
  // reference back to this one.
  it("opens every link in a new window without handing it this one", () => {
    show(false);
    for (const link of document.querySelectorAll<HTMLAnchorElement>(".v-about a")) {
      expect(link.target).toBe("_blank");
      expect(link.rel).toContain("noreferrer");
    }
  });
});
