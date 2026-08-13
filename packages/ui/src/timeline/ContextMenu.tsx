import { useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { useDismiss } from "../useDismiss";

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

/** How close to the edge of the window the menu may come. */
const MARGIN = 8;

/**
 * Where the menu actually fits, given where it was asked for.
 *
 * A menu placed at the pointer and left there is a menu whose last entries are off the bottom of the
 * screen — and a clip near the bottom of the timeline is exactly where a context menu gets opened. So:
 * flipped above the pointer where there is room above and not below, pulled back inside where it
 * overhangs, and capped in height with its own scroll where it is taller than the window itself. The
 * last case is real rather than defensive: fifteen entries at 44 px is 660 px, which is more than a
 * laptop has after the browser's own furniture.
 *
 * Measured rather than estimated. The number of entries and their height are both variable — a caption
 * clip has an entry a video clip does not, and a coarse pointer makes every row 44 px — so the only
 * honest answer comes from the box the browser laid out.
 */
export function placeMenu(
  wanted: { x: number; y: number },
  menu: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number; maxHeight: number } {
  const maxHeight = Math.max(MARGIN, view.height - 2 * MARGIN);
  const height = Math.min(menu.height, maxHeight);
  const belowFits = wanted.y + height + MARGIN <= view.height;
  const aboveFits = wanted.y - height - MARGIN >= 0;
  const wantedTop = belowFits ? wanted.y : aboveFits ? wanted.y - height : view.height - height;
  // Clamped at the end whichever branch chose it, rather than trusted per branch. A pointer can be
  // outside the window -- a drag that left it, a stale coordinate after a resize -- and then "flip
  // above" is still off the bottom. One clamp is also one thing to be right about.
  const top = Math.max(MARGIN, Math.min(wantedTop, Math.max(MARGIN, view.height - height - MARGIN)));
  const left = Math.max(
    MARGIN,
    Math.min(wanted.x, Math.max(MARGIN, view.width - menu.width - MARGIN)),
  );
  return { left, top, maxHeight };
}

// A list rather than a fixed set of props: the entries differ between a clip and a marker, and an
// entry that cannot do anything is disabled here instead of dispatching a command the core refuses.
export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number; maxHeight: number }>();
  useDismiss(ref, onClose);

  // In a layout effect and from the element's own box: the menu is drawn at the pointer first and
  // corrected before the browser paints, so nothing is ever seen off the edge. `items.length` is in the
  // dependencies because the same open menu can gain and lose entries -- a selection changes underneath
  // it -- and a placement measured for the old list would be the wrong one.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const box = element.getBoundingClientRect();
    setPlaced(
      placeMenu(
        { x, y },
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [x, y, items.length]);

  return (
    <div
      ref={ref}
      className="v-timeline__menu"
      role="menu"
      aria-label={label}
      style={{
        left: `${placed?.left ?? x}px`,
        top: `${placed?.top ?? y}px`,
        ...(placed === undefined ? {} : { maxHeight: `${placed.maxHeight}px` }),
      }}
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
