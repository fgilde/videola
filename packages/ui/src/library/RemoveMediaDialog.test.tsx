import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { RemoveMediaDialog } from "./RemoveMediaDialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

function show(clips: number, tracks: string[]) {
  const handlers = { onRemove: vi.fn(), onClose: vi.fn() };
  render(
    <I18nProvider>
      <RemoveMediaDialog name="song.mp3" clips={clips} tracks={tracks} {...handlers} />
    </I18nProvider>,
  );
  return handlers;
}

describe("the question before a medium in use goes", () => {
  it("says how many clips go with it and on which rows", () => {
    show(3, ["V1", "A2"]);

    expect(screen.getByText(/3 Clips auf V1, A2/)).toBeTruthy();
  });

  it("speaks of one clip as one", () => {
    show(1, ["A1"]);

    expect(screen.getByText(/1 Clip auf A1\. Der Clip/)).toBeTruthy();
  });

  it("removes only when that is what was chosen", () => {
    const handlers = show(2, ["V1"]);

    fireEvent.click(screen.getByRole("button", { name: "Behalten" }));

    expect(handlers.onRemove).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("removes and closes when it is confirmed", () => {
    const handlers = show(2, ["V1"]);

    fireEvent.click(screen.getByTestId("remove-media-confirm"));

    expect(handlers.onRemove).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
});
