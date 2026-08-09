import { describe, expect, it } from "vitest";

import type { Transform } from "@videola/core";

import { drawList, isGroup, type DrawItem, type DrawNode } from "./draw-list";
import { clipQuad, movedBy, quadCentre, rotatedTo, scaledBy } from "./stage";

const FRAME = { width: 1920, height: 1080 };
const SOURCE = { width: 640, height: 360 };

function transform(over: Partial<Transform> = {}): Transform {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: 1,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    ...over,
  };
}

// The claim this file exists for. `quadMatrix` is what the GPU is handed and `clipQuad` is what a
// handle is drawn on; the day they disagree, the box on screen sits somewhere the picture is not.
// So the corners are read back out of the matrix the compositor would actually use, by putting the
// unit quad's own corners through it and undoing the trip into clipspace.
function fromMatrix(matrix: readonly number[], frame: { width: number; height: number }) {
  return [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([u, v]) => {
    const clipX = matrix[0]! * u! + matrix[3]! * v! + matrix[6]!;
    const clipY = matrix[1]! * u! + matrix[4]! * v! + matrix[7]!;
    return { x: (clipX * frame.width) / 2, y: (-clipY * frame.height) / 2 };
  });
}

function project(over: Partial<Transform>) {
  return {
    schemaVersion: 1,
    meta: { id: "prj_1", createdAt: "", updatedAt: "" },
    settings: {
      width: FRAME.width,
      height: FRAME.height,
      fps: { num: 30, den: 1 },
      sampleRate: 48000,
      background: "#000000",
    },
    library: [],
    timeline: {
      tracks: [
        {
          id: "trk_1",
          kind: "video",
          name: "V1",
          clips: [
            {
              id: "clp_1",
              start: 0,
              duration: 1000,
              inPoint: 0,
              source: { kind: "generator", generator: { type: "solid", color: "#ffffff" } },
              transform: transform(over),
              effects: [],
              keyframes: {},
              blend: "normal",
              volume: 1,
              speed: { rate: 1, reverse: false, preservePitch: true },
              fades: { inDuration: 0, outDuration: 0 },
              transitionIn: null,
              transitionOut: null,
              groupId: null,
            },
          ],
          volume: 1,
          pan: 0,
          muted: false,
          solo: false,
          locked: false,
          hidden: false,
          height: 72,
          colorHex: "#5B8CFF",
          effects: [],
        },
      ],
    },
    markers: [],
    master: { volume: 1, effects: [] },
  } as never;
}

function firstItem(nodes: readonly DrawNode[]): DrawItem | undefined {
  for (const node of nodes) {
    const found = isGroup(node) ? firstItem(node.items) : node;
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("the stage box and the compositor's matrix", () => {
  const cases: Array<[string, Partial<Transform>]> = [
    ["a picture at rest", {}],
    ["moved", { x: 120, y: -80 }],
    ["scaled unevenly", { scaleX: 2.5, scaleY: 0.75 }],
    ["turned", { rotation: 37 }],
    ["turned and moved and scaled", { rotation: -22, x: 60, y: 40, scaleX: 1.4, scaleY: 1.4 }],
    ["off its own anchor", { anchorX: 0, anchorY: 1, rotation: 15 }],
    ["cropped", { crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.05 } }],
    ["cropped and turned", { crop: { left: 0.25, top: 0, right: 0, bottom: 0.4 }, rotation: 63 }],
  ];

  for (const [name, over] of cases) {
    it(`agrees on ${name}`, () => {
      const drawn = firstItem(drawList(project(over), 0, new Map(), new Map()).items);
      expect(drawn).toBeDefined();
      const want = fromMatrix(drawn!.matrix, FRAME);
      // A generator has no size of its own, so the compositor draws it at the frame's size.
      const got = clipQuad(transform(over), FRAME);
      for (let corner = 0; corner < 4; corner += 1) {
        expect(got[corner]!.x).toBeCloseTo(want[corner]!.x, 6);
        expect(got[corner]!.y).toBeCloseTo(want[corner]!.y, 6);
      }
    });
  }
});

describe("turning a drag into a transform", () => {
  it("moves by exactly the travel", () => {
    const moved = movedBy(transform({ x: 10 }), { x: -30, y: 12 });
    expect([moved.x, moved.y]).toEqual([-20, 12]);
  });

  // What a corner handle promises: the corner across from the one being dragged does not move.
  // Scale alone breaks that promise, because a picture grows about its anchor.
  it("keeps the opposite corner still while a corner is dragged", () => {
    for (const corner of [0, 1, 2, 3]) {
      const before = transform({ rotation: 24, x: 40, y: -15 });
      const after = scaledBy(before, corner, { x: 55, y: -35 }, SOURCE, false);
      const opposite = (corner + 2) % 4;
      expect(clipQuad(after, SOURCE)[opposite]!.x).toBeCloseTo(
        clipQuad(before, SOURCE)[opposite]!.x,
        6,
      );
      expect(clipQuad(after, SOURCE)[opposite]!.y).toBeCloseTo(
        clipQuad(before, SOURCE)[opposite]!.y,
        6,
      );
    }
  });

  // The bottom right corner pulled down and right makes the picture bigger, on both axes.
  it("grows towards the drag and shrinks away from it", () => {
    const grown = scaledBy(transform(), 2, { x: 64, y: 36 }, SOURCE, false);
    expect(grown.scaleX).toBeGreaterThan(1);
    expect(grown.scaleY).toBeGreaterThan(1);
    const shrunk = scaledBy(transform(), 2, { x: -64, y: -36 }, SOURCE, false);
    expect(shrunk.scaleX).toBeLessThan(1);
    expect(shrunk.scaleY).toBeLessThan(1);
  });

  // A corner of a turned picture grows along the edge it is on, not along the screen: dragged
  // straight down, a picture turned 90 degrees gets wider rather than taller.
  it("scales along the picture's own axes, not the screen's", () => {
    const turned = transform({ rotation: 90 });
    const dragged = scaledBy(turned, 2, { x: 0, y: 60 }, SOURCE, false);
    expect(dragged.scaleX).toBeGreaterThan(1);
    expect(dragged.scaleY).toBeCloseTo(1, 6);
  });

  it("keeps the aspect when the drag is uniform", () => {
    const kept = scaledBy(transform({ scaleX: 2, scaleY: 2 }), 2, { x: 100, y: 4 }, SOURCE, true);
    expect(kept.scaleX / kept.scaleY).toBeCloseTo(1, 6);
  });

  it("never scales a picture to nothing, which would leave no corner to grab", () => {
    const gone = scaledBy(transform(), 2, { x: -10_000, y: -10_000 }, SOURCE, false);
    expect(gone.scaleX).toBeGreaterThan(0);
    expect(gone.scaleY).toBeGreaterThan(0);
  });

  // Two rays from the centre, not an accumulated delta: a pointer that leaves the window and comes
  // back has to land where it is rather than where it would have been.
  it("turns by the angle between where the handle was and where the pointer is", () => {
    const turned = rotatedTo(transform(), { x: 0, y: -100 }, { x: 100, y: 0 });
    expect(turned.rotation).toBeCloseTo(90, 6);
  });

  it("snaps to whole steps when asked", () => {
    const turned = rotatedTo(transform(), { x: 0, y: -100 }, { x: 12, y: -100 }, 15);
    expect(turned.rotation).toBe(0);
  });

  it("stays inside half a turn either way", () => {
    const turned = rotatedTo(transform({ rotation: 170 }), { x: 100, y: 0 }, { x: 0, y: 100 });
    expect(turned.rotation).toBeCloseTo(-100, 6);
  });

  it("finds the middle of the picture, turned or not", () => {
    const centre = quadCentre(clipQuad(transform({ rotation: 41, x: 25, y: -60 }), SOURCE));
    expect(centre.x).toBeCloseTo(25, 6);
    expect(centre.y).toBeCloseTo(-60, 6);
  });
});
