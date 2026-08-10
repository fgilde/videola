import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { commandKey } from "./useCommandKeys";

function event(key: string, over: Partial<KeyboardEventInit> = {}): Parameters<typeof commandKey>[0] {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over };
}

describe("what a modifier combination means", () => {
  it("reads the four everybody's fingers know, on either modifier", () => {
    expect(commandKey(event("z", { ctrlKey: true }))).toBe("undo");
    expect(commandKey(event("Z", { metaKey: true }))).toBe("undo");
    expect(commandKey(event("z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(commandKey(event("y", { ctrlKey: true }))).toBe("redo");
    expect(commandKey(event("s", { ctrlKey: true }))).toBe("save");
    expect(commandKey(event("o", { ctrlKey: true }))).toBe("open");
    expect(commandKey(event("e", { ctrlKey: true }))).toBe("export");
  });

  // Unmodified letters belong to the timeline: "s" cuts and "m" drops a marker, and a project-wide
  // handler that answered them as well would run two edits for one keystroke.
  it("takes nothing that is not a modifier combination", () => {
    expect(commandKey(event("z"))).toBeUndefined();
    expect(commandKey(event("s"))).toBeUndefined();
    expect(commandKey(event("z", { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(commandKey(event("k", { ctrlKey: true }))).toBeUndefined();
  });
});

describe("the keys the shell answers", () => {
  // The shell asks the browser about the pointer and the theme, and jsdom answers neither.
  beforeEach(() => {
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("any-pointer: fine"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  it("undoes and redoes from wherever the focus is", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <AppShell layoutPreference="desktop" onUndo={onUndo} onRedo={onRedo} canUndo canRedo>
        <p>editor</p>
      </AppShell>,
    );

    fireEvent.keyDown(screen.getByText("editor"), { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  // An empty history is not a reason to hand the keystroke back to the browser: Ctrl+Z there would
  // undo somebody's typing in a field that no longer has the focus.
  it("takes the key with nothing to undo, and does nothing with it", () => {
    const onUndo = vi.fn();
    render(
      <AppShell layoutPreference="desktop" onUndo={onUndo}>
        <p>editor</p>
      </AppShell>,
    );

    const taken = !fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });

    expect(onUndo).not.toHaveBeenCalled();
    expect(taken).toBe(true);
  });

  // The browser's own save dialogue over an editor is the one thing Ctrl+S must never produce.
  it("keeps Ctrl+S away from the browser", () => {
    const onSave = vi.fn();
    render(
      <AppShell layoutPreference="desktop" onSave={onSave}>
        <p>editor</p>
      </AppShell>,
    );

    const taken = !fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(taken).toBe(true);
  });

  it("leaves a field's own undo alone", () => {
    const onUndo = vi.fn();
    render(
      <AppShell layoutPreference="desktop" onUndo={onUndo} canUndo>
        <input aria-label="words" />
      </AppShell>,
    );

    fireEvent.keyDown(screen.getByLabelText("words"), { key: "z", ctrlKey: true });

    expect(onUndo).not.toHaveBeenCalled();
  });
});
