import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { DropZone } from "./DropZone";

const VIDEO = new File([new Uint8Array([0])], "clip.mp4", { type: "video/mp4" });

function transfer(types: string[], files: File[] = []): DataTransfer {
  return { types, files, dropEffect: "none" } as unknown as DataTransfer;
}

function show(): { onFiles: ReturnType<typeof vi.fn>; zone: HTMLElement } {
  const onFiles = vi.fn();
  render(
    <I18nProvider>
      <DropZone onFiles={onFiles}>
        <p>Editor</p>
      </DropZone>
    </I18nProvider>,
  );
  return { onFiles, zone: screen.getByText("Editor").parentElement as HTMLElement };
}

const overlay = (): HTMLElement | null => screen.queryByText("Videodatei hier ablegen");

describe("DropZone", () => {
  it("hands the dropped files over", () => {
    const { onFiles, zone } = show();

    fireEvent.drop(zone, { dataTransfer: transfer(["Files"], [VIDEO]) });

    expect(onFiles).toHaveBeenCalledWith([VIDEO]);
  });

  // Without the cancelled default the browser leaves the editor and opens the file in a player
  // of its own, which looks exactly like a crash to whoever dropped it.
  it("keeps the browser from opening the file instead", () => {
    const { zone } = show();

    const over = fireEvent.dragOver(zone, { dataTransfer: transfer(["Files"]) });
    const dropped = fireEvent.drop(zone, { dataTransfer: transfer(["Files"], [VIDEO]) });

    expect([over, dropped]).toEqual([false, false]);
  });

  it("shows where to let go while a file is over the editor", () => {
    const { zone } = show();
    expect(overlay()).toBeNull();

    fireEvent.dragEnter(zone, { dataTransfer: transfer(["Files"]) });

    expect(overlay()).not.toBeNull();
  });

  // dragleave fires on every crossing into a child, so a pointer travelling across the editor
  // would put the hint out while the file is still over it.
  it("keeps the hint up while the pointer crosses the editor's own children", () => {
    const { zone } = show();
    const child = screen.getByText("Editor");

    fireEvent.dragEnter(zone, { dataTransfer: transfer(["Files"]) });
    fireEvent.dragEnter(child, { dataTransfer: transfer(["Files"]) });
    fireEvent.dragLeave(zone, { dataTransfer: transfer(["Files"]) });

    expect(overlay()).not.toBeNull();

    fireEvent.dragLeave(zone, { dataTransfer: transfer(["Files"]) });

    expect(overlay()).toBeNull();
  });

  it("takes the hint down again after a drop", () => {
    const { zone } = show();

    fireEvent.dragEnter(zone, { dataTransfer: transfer(["Files"]) });
    fireEvent.drop(zone, { dataTransfer: transfer(["Files"], [VIDEO]) });

    expect(overlay()).toBeNull();
  });

  // Dragging a clip along the timeline is a drag over this same element, and it carries no
  // files. Answering it would light up the overlay on every edit.
  it("ignores a drag that carries no files at all", () => {
    const { onFiles, zone } = show();

    fireEvent.dragEnter(zone, { dataTransfer: transfer(["text/plain"]) });
    const over = fireEvent.dragOver(zone, { dataTransfer: transfer(["text/plain"]) });
    fireEvent.drop(zone, { dataTransfer: transfer(["text/plain"]) });

    expect(overlay()).toBeNull();
    expect(over).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("reports nothing for a drop that turned out to be empty", () => {
    const { onFiles, zone } = show();

    fireEvent.drop(zone, { dataTransfer: transfer(["Files"], []) });

    expect(onFiles).not.toHaveBeenCalled();
  });
});
