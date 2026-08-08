import { useEffect, type RefObject } from "react";

// Escape, or a press anywhere outside. Captured on the way down so a menu closes before the click
// underneath it is acted on, which is what keeps a tap next to an open menu from also editing.
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const onPointerDown = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target) === true) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, onClose]);
}
