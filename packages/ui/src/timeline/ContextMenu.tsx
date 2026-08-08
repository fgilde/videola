import { useEffect, useRef, type ReactElement } from "react";

export interface MenuItem {
  /** Catalogue key, and the React key of the row. */
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  items: readonly MenuItem[];
  onClose: () => void;
}

// A list rather than a fixed set of props: the entries differ between a clip and a marker, and an
// entry that cannot do anything is disabled here instead of dispatching a command the core refuses.
export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);

  return (
    <div
      ref={ref}
      className="v-timeline__menu"
      role="menu"
      aria-label={label}
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled === true}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
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
