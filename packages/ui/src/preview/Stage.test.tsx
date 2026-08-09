import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { Stage, type StageGrab, type StagePoint } from "./Stage";

// The overlay is measured in project pixels and pointed at in screen ones, so every claim here is
// about the one conversion between them. jsdom lays nothing out, so the box the conversion reads is
// stubbed to a known rectangle -- which is exactly the number the arithmetic has to be right about.
const FRAME = { width: 1920, height: 1080 };
const BOX = { left: 100, top: 50, width: 480, height: 270 };

const QUAD: StagePoint[] = [
  { x: -960, y: -540 },
  { x: 960, y: -540 },
  { x: 960, y: 540 },
  { x: -960, y: 540 },
];

const rect = (): DOMRect =>
  ({
    left: BOX.left,
    top: BOX.top,
    width: BOX.width,
    height: BOX.height,
    right: BOX.left + BOX.width,
    bottom: BOX.top + BOX.height,
    x: BOX.left,
    y: BOX.top,
    toJSON: () => ({}),
  }) as DOMRect;

const original = Element.prototype.getBoundingClientRect;
afterEach(() => {
  Element.prototype.getBoundingClientRect = original;
});

interface Reported {
  grab: StageGrab;
  drag: { at: StagePoint; pointer: StagePoint; delta: StagePoint; even: boolean };
}

function show(): { drags: Reported[]; drops: number[] } {
  Element.prototype.getBoundingClientRect = rect;
  const drags: Reported[] = [];
  const drops: number[] = [];
  render(
    <I18nProvider>
      <Stage
        frame={FRAME}
        quad={QUAD}
        label="fixture.mp4"
        onDrag={(grab, drag) => drags.push({ grab, drag })}
        onDrop={() => drops.push(1)}
      />
    </I18nProvider>,
  );
  return { drags, drops };
}

function part(grab: string): Element {
  const found = document.querySelector(`[data-grab="${grab}"]`);
  if (found === null) throw new Error(`no handle for ${grab}`);
  return found;
}

function surface(): Element {
  const found = document.querySelector(".v-stage__svg");
  if (found === null) throw new Error("no overlay");
  return found;
}

function down(target: Element, clientX: number, clientY: number): void {
  fireEvent.pointerDown(target, { pointerId: 3, pointerType: "mouse", clientX, clientY });
}

function move(clientX: number, clientY: number, shiftKey = false): void {
  fireEvent.pointerMove(surface(), { pointerId: 3, pointerType: "mouse", clientX, clientY, shiftKey });
}

describe("the geometry overlay", () => {
  it("draws a handle on every corner and one to turn by", () => {
    show();
    expect(document.querySelectorAll(".v-stage__handle")).toHaveLength(5);
  });

  // The whole point of the conversion: the box is 480 screen pixels wide and the frame is 1920
  // project pixels, so one screen pixel is four project ones. A drag of 48 across is 192.
  it("reports a drag in project pixels, whatever the box is scaled to", () => {
    const { drags } = show();

    down(part("move"), BOX.left + 240, BOX.top + 135);
    move(BOX.left + 288, BOX.top + 135);

    expect(drags).toHaveLength(1);
    expect(drags[0]!.grab).toBe("move");
    expect(drags[0]!.drag.delta.x).toBeCloseTo(192, 6);
    expect(drags[0]!.drag.delta.y).toBeCloseTo(0, 6);
  });

  // Project coordinates run from the centre of the frame, so the middle of the box is the origin
  // and its top left corner is minus half the frame in both directions.
  it("puts the origin in the middle of the picture", () => {
    const { drags } = show();

    down(part("move"), BOX.left + 240, BOX.top + 135);
    move(BOX.left, BOX.top);

    expect(drags[0]!.drag.pointer.x).toBeCloseTo(-960, 6);
    expect(drags[0]!.drag.pointer.y).toBeCloseTo(-540, 6);
  });

  it("says which corner was taken hold of", () => {
    const { drags } = show();

    down(part("2"), BOX.left + BOX.width, BOX.top + BOX.height);
    move(BOX.left + BOX.width - 24, BOX.top + BOX.height);

    expect(drags[0]!.grab).toBe(2);
  });

  // A rotation is measured from where the drag began, not from the last move, so the caller can
  // work out an angle rather than accumulate one.
  it("carries where the drag began through every move", () => {
    const { drags } = show();

    down(part("rotate"), BOX.left + 240, BOX.top);
    move(BOX.left + 300, BOX.top + 20);
    move(BOX.left + 360, BOX.top + 60);

    expect(drags).toHaveLength(2);
    expect(drags[0]!.drag.at).toEqual(drags[1]!.drag.at);
  });

  it("reports the modifier, which is what makes a scale even or a turn stepped", () => {
    const { drags } = show();

    down(part("0"), BOX.left, BOX.top);
    move(BOX.left + 10, BOX.top + 10, true);

    expect(drags[0]!.drag.even).toBe(true);
  });

  it("moves nothing before it has been taken hold of", () => {
    const { drags } = show();

    move(BOX.left + 300, BOX.top + 60);

    expect(drags).toHaveLength(0);
  });

  // One drag is one step in the history, and the end of it is what the caller keys on.
  it("reports the end of a drag exactly once", () => {
    const { drops } = show();

    down(part("move"), BOX.left + 240, BOX.top + 135);
    move(BOX.left + 260, BOX.top + 135);
    fireEvent.pointerUp(surface(), { pointerId: 3, pointerType: "mouse" });
    fireEvent.pointerUp(surface(), { pointerId: 3, pointerType: "mouse" });

    expect(drops).toEqual([1]);
  });

  // The picture underneath is still a picture, and a grab on a handle is not a click on it.
  it("does not let a grab reach whatever is under it", () => {
    Element.prototype.getBoundingClientRect = rect;
    const behind = vi.fn();
    render(
      <I18nProvider>
        <div onPointerDown={behind}>
          <Stage frame={FRAME} quad={QUAD} label="fixture.mp4" onDrag={() => undefined} onDrop={() => undefined} />
        </div>
      </I18nProvider>,
    );

    down(part("move"), BOX.left + 240, BOX.top + 135);

    expect(behind).not.toHaveBeenCalled();
  });
});
