import { describe, expect, it } from "vitest";

import { placeMenu } from "./ContextMenu";

const view = { width: 1200, height: 800 };

// A menu opened at the pointer and left there is a menu whose last entries are off the bottom of the
// screen -- and a clip near the bottom of the timeline is exactly where one gets opened. Reported from
// use, fixed here, and the arithmetic is separated from the element so it can be checked without one.
describe("where a context menu fits", () => {
  it("sits at the pointer when there is room", () => {
    expect(placeMenu({ x: 300, y: 200 }, { width: 220, height: 400 }, view)).toMatchObject({
      left: 300,
      top: 200,
    });
  });

  it("flips above the pointer when there is no room below", () => {
    const placed = placeMenu({ x: 300, y: 700 }, { width: 220, height: 400 }, view);

    expect(placed.top).toBe(300);
    expect(placed.top + 400).toBeLessThanOrEqual(view.height);
  });

  it("pulls back inside instead of overhanging the right edge", () => {
    const placed = placeMenu({ x: 1150, y: 100 }, { width: 220, height: 300 }, view);

    expect(placed.left + 220).toBeLessThanOrEqual(view.width);
  });

  // Fifteen entries at 44 px is 660 px, which is more than a laptop has after the browser's own
  // furniture. Neither side fits, so it sits against the bottom edge and the list scrolls.
  it("caps its height and stays on screen when it is taller than the window", () => {
    const placed = placeMenu({ x: 100, y: 400 }, { width: 220, height: 1400 }, view);

    expect(placed.maxHeight).toBeLessThanOrEqual(view.height);
    expect(placed.top).toBeGreaterThanOrEqual(0);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(view.height);
  });

  // A phone in landscape: the window is shorter than one menu and narrower than two.
  it("stays inside a window smaller than the menu in both directions", () => {
    const placed = placeMenu({ x: 300, y: 300 }, { width: 400, height: 500 }, { width: 320, height: 200 });

    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.top).toBeGreaterThanOrEqual(0);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(200);
  });
});
