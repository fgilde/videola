import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { UpdateOffer } from "./UpdateOffer";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

type Install = (onProgress: (fraction: number | undefined) => void) => Promise<void>;

function show(install: Install, onClose = (): void => undefined): void {
  render(
    <I18nProvider>
      <UpdateOffer version="0.6.0" install={install} onClose={onClose} />
    </I18nProvider>,
  );
}

const bar = (): HTMLProgressElement | null =>
  document.querySelector<HTMLProgressElement>(".v-update__bar");

describe("the update offer", () => {
  it("names the version and does nothing until it is asked to", () => {
    const install = vi.fn(async () => undefined);
    show(install);

    expect(screen.getByText("Videola 0.6.0 ist verfügbar")).toBeTruthy();
    expect(install).not.toHaveBeenCalled();
  });

  it("reports how far the download has got", async () => {
    let report: ((fraction: number | undefined) => void) | undefined;
    show(
      (onProgress) =>
        new Promise(() => {
          report = onProgress;
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Jetzt installieren" }));
    await waitFor(() => expect(report).toBeDefined());
    report?.(0.42);

    await waitFor(() => expect(bar()?.value).toBe(42));
    expect(screen.getByText(/42 %/)).toBeTruthy();
  });

  // Some hosts report bytes with no total. A bar that invented a number would be a bar that lies
  // about how long this takes, so it goes indeterminate instead.
  it("goes indeterminate where the host cannot say how big it is", async () => {
    let report: ((fraction: number | undefined) => void) | undefined;
    show(
      (onProgress) =>
        new Promise(() => {
          report = onProgress;
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Jetzt installieren" }));
    await waitFor(() => expect(report).toBeDefined());
    report?.(undefined);

    await waitFor(() => expect(bar()?.hasAttribute("value")).toBe(false));
  });

  // Closing mid-download would leave it running with nothing on screen to say so, and the next
  // check would start it over.
  it("cannot be dismissed while it is downloading", async () => {
    show(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Jetzt installieren" }));

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Schließen" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
  });

  it("says so when it is installed", async () => {
    show(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Jetzt installieren" }));

    await waitFor(() => expect(screen.getByText(/installiert/)).toBeTruthy());
  });

  // A failed update is not a broken editor: what is running keeps running, and the message says so.
  it("says the version in hand keeps working when it fails", async () => {
    show(async () => {
      throw new Error("no");
    });
    fireEvent.click(screen.getByRole("button", { name: "Jetzt installieren" }));

    await waitFor(() => expect(screen.getByText(/läuft weiter/)).toBeTruthy());
  });

  it("tells its host when it has been dismissed", () => {
    const onClose = vi.fn();
    show(async () => undefined, onClose);

    fireEvent.click(screen.getByRole("button", { name: "Jetzt nicht" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
