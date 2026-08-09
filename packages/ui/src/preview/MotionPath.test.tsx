import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { MotionPath } from "./MotionPath";
import { stagePoint, stageScale, stageViewBox, type StagePoint } from "./stageGeometry";

const FRAME = { width: 1920, height: 1080 };
const BOX = { left: 40, top: 20, width: 480, height: 270 };

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

const KEYS: StagePoint[] = [
  { x: -400, y: 0 },
  { x: 0, y: -200 },
  { x: 400, y: 0 },
];

function show(): { drags: Array<{ index: number; at: StagePoint }>; drops: number } {
  Element.prototype.getBoundingClientRect = rect;
  const drags: Array<{ index: number; at: StagePoint }> = [];
  const state = { drops: 0 };
  render(
    <I18nProvider>
      <MotionPath
        frame={FRAME}
        path={[...KEYS, { x: 500, y: 100 }]}
        keys={KEYS}
        onDragKey={(index, at) => drags.push({ index, at })}
        onDrop={() => (state.drops += 1)}
      />
    </I18nProvider>,
  );
  return {
    drags,
    get drops() {
      return state.drops;
    },
  } as never;
}

function key(index: number): Element {
  const found = document.querySelector(`[data-path-key="${index}"]`);
  if (found === null) throw new Error(`no key ${index}`);
  return found;
}

function surface(): Element {
  const found = document.querySelector(".v-path__svg");
  if (found === null) throw new Error("no overlay");
  return found;
}

describe("the shared stage geometry", () => {
  // Every overlay on the picture converts the same way, because a box drawn from one arithmetic and
  // a path from another would sit a few pixels apart on the same frame.
  it("puts the origin in the middle of the frame", () => {
    expect(stagePoint(BOX, FRAME, BOX.left, BOX.top)).toEqual({ x: -960, y: -540 });
    expect(stagePoint(BOX, FRAME, BOX.left + BOX.width / 2, BOX.top + BOX.height / 2)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("survives a box that has not been laid out yet", () => {
    expect(stagePoint({ left: 0, top: 0, width: 0, height: 0 }, FRAME, 10, 10)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("says how many project pixels one screen pixel is worth", () => {
    expect(stageScale(480, FRAME)).toBe(4);
    expect(stageScale(0, FRAME)).toBe(1);
  });

  it("centres the view box on the frame's own origin", () => {
    expect(stageViewBox(FRAME)).toBe("-960 -540 1920 1080");
  });
});

describe("the motion path", () => {
  it("draws the sampled line and a handle on every key", () => {
    show();
    expect(document.querySelectorAll(".v-path__key")).toHaveLength(3);
    expect(document.querySelector(".v-path__line")?.getAttribute("points")).toBe(
      "-400,0 0,-200 400,0 500,100",
    );
  });

  it("reports which key is being dragged, and where to", () => {
    const rig = show();

    fireEvent.pointerDown(key(1), { pointerId: 5, pointerType: "mouse", clientX: 280, clientY: 70 });
    fireEvent.pointerMove(surface(), {
      pointerId: 5,
      pointerType: "mouse",
      clientX: BOX.left + BOX.width,
      clientY: BOX.top,
    });

    expect(rig.drags).toHaveLength(1);
    expect(rig.drags[0]!.index).toBe(1);
    expect(rig.drags[0]!.at).toEqual({ x: 960, y: -540 });
  });

  it("moves nothing until a key is taken hold of", () => {
    const rig = show();
    fireEvent.pointerMove(surface(), { pointerId: 5, pointerType: "mouse", clientX: 100, clientY: 40 });
    expect(rig.drags).toHaveLength(0);
  });

  it("reports the end of a drag once", () => {
    const rig = show();
    fireEvent.pointerDown(key(0), { pointerId: 5, pointerType: "mouse", clientX: 60, clientY: 40 });
    fireEvent.pointerUp(surface(), { pointerId: 5, pointerType: "mouse" });
    fireEvent.pointerUp(surface(), { pointerId: 5, pointerType: "mouse" });
    expect(rig.drops).toBe(1);
  });

  // A line needs two points. One key is a clip that stands still, and a polyline of one point is a
  // stray dot on the picture.
  it("draws no line where there is nothing to draw", () => {
    Element.prototype.getBoundingClientRect = rect;
    render(
      <I18nProvider>
        <MotionPath
          frame={FRAME}
          path={[{ x: 0, y: 0 }]}
          keys={[{ x: 0, y: 0 }]}
          onDragKey={() => undefined}
          onDrop={() => undefined}
        />
      </I18nProvider>,
    );
    expect(document.querySelector(".v-path__line")).toBeNull();
  });
});
