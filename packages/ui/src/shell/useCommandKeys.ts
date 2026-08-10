import { useEffect } from "react";

import type { TopBarActions } from "./TopBar";

/** What a modifier combination means, resolved from the event and nothing else. */
export type CommandKey = "undo" | "redo" | "save" | "open" | "export";

// Only the four everybody's fingers already know, plus the redo spelling Windows uses. Anything more
// would take a combination the browser has its own use for -- and a shortcut the browser eats is a
// shortcut that does not exist.
export function commandKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): CommandKey | undefined {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  // Ctrl+Y is redo on Windows and nothing anywhere else, so it is accepted and never the only way.
  if (key === "y" && !event.shiftKey) return "redo";
  if (key === "s" && !event.shiftKey) return "save";
  if (key === "o" && !event.shiftKey) return "open";
  if (key === "e" && !event.shiftKey) return "export";
  return undefined;
}

// A field with the focus keeps its own keys. Ctrl+Z in a text field is the browser's undo of the
// typing, and taking it away to undo an edit two panels over is the kind of surprise that loses work.
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * The keys that belong to the application rather than to a panel: undo, redo, save, open, export.
 *
 * On the window, because they have to work wherever the focus is — the timeline's own keys are
 * handled where the timeline can see its selection, and these four have no such place. Every one of
 * them is an action the top bar already offers, so nothing here is a second path to anything: an
 * action the host did not hand over is a key that does nothing, not a key that throws.
 */
export function useCommandKeys(actions: TopBarActions): void {
  const { onUndo, onRedo, onSave, onOpen, onExport, canUndo, canRedo } = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable === true) return;
      if (TYPING.has(target?.tagName ?? "")) return;
      const command = commandKey(event);
      if (command === undefined) return;
      const run = {
        undo: canUndo === true ? onUndo : undefined,
        redo: canRedo === true ? onRedo : undefined,
        save: onSave,
        open: onOpen,
        export: onExport,
      }[command];
      // Taken whether or not there is anything to do: Ctrl+S has to stop the browser offering to save
      // the page even when this project has nothing to write, and Ctrl+Z with an empty history must
      // not undo somebody's typing in a panel that is no longer focused.
      event.preventDefault();
      run?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onUndo, onRedo, onSave, onOpen, onExport, canUndo, canRedo]);
}
