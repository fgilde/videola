import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cmd,
  createWasmBackend,
  FLICKS_PER_SECOND,
  on,
  VideolaDocument,
  type Clip,
  type ClipId,
  type Command,
  type Keyframe,
} from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";

import { I18nProvider } from "../i18n/I18nProvider";
import type { EffectDescriptor } from "../inspector/Inspector";
import { fromField, upField } from "./KeyframeCurve";
import { DEFAULT_FLICKS_PER_PIXEL, Timeline } from "./Timeline";
import { restoreViewport, stubViewport } from "./Timeline.test";

// Against the real Rust history, not a fake of it. Coalescing, the refusal when a keyframe already
// sits somewhere and the resorting after a move are all properties of the core -- a hand-written
// backend would have to reimplement all three to be asked about them, and would then only confirm
// itself.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "../../../core/src/wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

const SECOND = FLICKS_PER_SECOND;

const BRIGHTNESS: EffectDescriptor = {
  id: "brightness",
  name: { de: "Helligkeit", en: "Brightness" },
  inputs: 1,
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 4 }],
};

interface Scene {
  doc: VideolaDocument;
  clip: ClipId;
}

async function sceneWithKeyframes(
  times: number[] = [1, 3],
  start = 0,
  seconds = 10,
): Promise<Scene> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("video", "V1"));
  const track = doc.state.timeline.tracks[0]?.id ?? "";
  doc.dispatch(
    cmd.clipAdd(
      track,
      { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
      start * SECOND,
      seconds * SECOND,
    ),
  );
  const clip = onlyClip(doc).id;
  for (const seconds of times) {
    doc.dispatch(
      cmd.keyframeAdd(on.clip(clip), null, "opacity", seconds * SECOND, {
        kind: "float",
        value: seconds / 4,
      }),
    );
  }
  return { doc, clip };
}

function onlyClip(doc: VideolaDocument): Clip {
  for (const track of doc.state.timeline.tracks) {
    const clip = track.clips[0];
    if (clip !== undefined) return clip;
  }
  throw new Error("no clip in project");
}

function trackOf(doc: VideolaDocument, key = "opacity"): readonly Keyframe[] {
  return onlyClip(doc).keyframes[key] ?? [];
}

function times(doc: VideolaDocument, key = "opacity"): number[] {
  return trackOf(doc, key).map((entry) => entry.time);
}

function Harness({ doc }: { doc: VideolaDocument }): ReactElement {
  const [project, setProject] = useState(doc.state);
  const [playhead, setPlayhead] = useState(0);
  useEffect(() => doc.subscribe(setProject), [doc]);
  return (
    <I18nProvider>
      <Timeline
        project={project}
        playhead={playhead}
        effects={[BRIGHTNESS]}
        // The real one, out of the same wasm module the history above runs on: the curve field's
        // whole claim is that it draws the core's easing, and a stub here would prove a stub.
        curveShape={doc.curveShape}
        // Deliberately not caught: the timeline decides which refusals are ordinary, and every one
        // it does not swallow reaches the test as a throw the way it reaches the shell as a banner.
        dispatch={(command: Command, key?: string) => doc.dispatch(command, key)}
        onSeek={setPlayhead}
      />
    </I18nProvider>
  );
}

function surface(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".v-timeline__scroll");
  if (element === null) throw new Error("timeline surface missing");
  return element;
}

function clipElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-clip-id]");
  if (element === null) throw new Error("clip missing");
  return element;
}

function keys(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".v-keylane__key")];
}

function keyAt(time: number): HTMLElement {
  const element = keys().find((candidate) => candidate.dataset.keyframeTime === String(time));
  if (element === undefined) {
    throw new Error(`no keyframe drawn at ${time}; drawn: ${keys().map((k) => k.dataset.keyframeTime).join()}`);
  }
  return element;
}

type Step = { clientX: number; pointerType?: string; pointerId?: number };

function down(target: Element, step: Step): void {
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: "mouse", clientY: 40, button: 0, ...step });
}

function move(step: Step): void {
  fireEvent.pointerMove(surface(), { pointerId: 1, pointerType: "mouse", clientY: 40, ...step });
}

function up(step: Step): void {
  fireEvent.pointerUp(surface(), { pointerId: 1, pointerType: "mouse", clientY: 40, ...step });
}

/**
 * React 19 catches what an event handler throws and reports it on `window` instead of letting it
 * out, so a handler that throws looks in jsdom exactly like one that works. Everything that claims
 * a gesture is ordinary has to listen here, or it is claiming nothing.
 */
function watchWindowErrors(): { errors: ErrorEvent[]; stop: () => void } {
  const errors: ErrorEvent[] = [];
  const listener = (event: ErrorEvent): void => void errors.push(event);
  window.addEventListener("error", listener);
  return { errors, stop: () => window.removeEventListener("error", listener) };
}

describe("the keyframe lane", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("stays out of sight until a clip is selected", async () => {
    const { doc } = await sceneWithKeyframes();
    render(<Harness doc={doc} />);

    expect(screen.queryByTestId("keyframe-lane")).toBeNull();

    down(clipElement(), { clientX: 100 });

    expect(screen.getByTestId("keyframe-lane")).toBeTruthy();
  });

  // The one claim the lane exists to make. A keyframe at four seconds is drawn where the ruler puts
  // four seconds, out of the same conversion -- not on an axis of its own.
  //
  // The clip starts at two seconds on purpose. On a clip that starts at zero, timeline time and
  // clip-relative time are the same number, and a lane doing its arithmetic against the clip would
  // pass this unnoticed -- which is exactly what an earlier version of this run did.
  it("draws a keyframe at the pixel the timeline puts its time at, not at its offset in the clip", async () => {
    const { doc } = await sceneWithKeyframes([3, 5], 2);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    expect(keys().map((key) => key.style.left)).toEqual([
      `${(3 * SECOND) / DEFAULT_FLICKS_PER_PIXEL}px`,
      `${(5 * SECOND) / DEFAULT_FLICKS_PER_PIXEL}px`,
    ]);
  });

  // Otherwise the lane only ever appears to somebody who has already found the switch that makes
  // it appear, and there is nothing on screen saying where keyframes come from.
  it("says where keyframes come from on a clip that has none", async () => {
    const { doc } = await sceneWithKeyframes([]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    expect(keys()).toHaveLength(0);
    expect(screen.getByTestId("keyframe-lane").textContent).toContain("noch keine Keyframes");
  });

  // The lane windows like the tracks do. One clip's track can hold thousands of keys -- a project
  // written by hand or by an importer -- and a node per key would make the node count a function
  // of the material rather than of the viewport.
  it("draws only the keyframes and gaps the visible window reaches", async () => {
    const { doc } = await sceneWithKeyframes([1, 150, 180], 0, 200);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    expect(keys().map((key) => key.dataset.keyframeTime)).toEqual([String(SECOND)]);
    // One of the two gaps: 1 s to 150 s crosses the window and has to be drawn even though only
    // one of its ends is in it; 150 s to 180 s lies entirely beyond it.
    expect(
      [...document.querySelectorAll<HTMLElement>(".v-keylane__segment")].map(
        (node) => node.style.width,
      ),
    ).toHaveLength(1);
  });

  it("names every keyframe with the parameter it belongs to and the instant it sits at", async () => {
    const { doc } = await sceneWithKeyframes([1]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    expect(keyAt(SECOND).getAttribute("aria-label")).toBe("Keyframe von Deckkraft bei 00:00:01.00");
  });

  it("picks a keyframe on a press and says so", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    down(keyAt(SECOND), { clientX: 100 });

    expect(keyAt(SECOND).getAttribute("aria-pressed")).toBe("true");
    expect(keyAt(3 * SECOND).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("keyframe-bar").textContent).toContain("Deckkraft");
  });
});

describe("dragging a keyframe", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  const pointers = ["mouse", "touch"] as const;

  // One path for the mouse and the finger. Two handlers would drift, and the phone layout is not
  // an afterthought -- it is the same code, so it is the same run.
  for (const pointerType of pointers) {
    it(`moves it with a ${pointerType}, and one drag is one undo step`, async () => {
      const { doc } = await sceneWithKeyframes([1, 5]);
      render(<Harness doc={doc} />);
      down(clipElement(), { clientX: 100 });
      const startX = (1 * SECOND) / DEFAULT_FLICKS_PER_PIXEL;

      down(keyAt(SECOND), { clientX: startX, pointerType });
      for (let step = 1; step <= 60; step += 1) {
        move({ clientX: startX + step, pointerType });
      }
      up({ clientX: startX + 60, pointerType });

      // Snapping is on, and 60 px at the default zoom is 0.6 s; the grid step is what it lands on.
      const moved = times(doc);
      expect(moved).toHaveLength(2);
      expect(moved[0]).toBeGreaterThan(1 * SECOND);
      expect(moved[1]).toBe(5 * SECOND);

      doc.undo();
      expect(times(doc)).toEqual([1 * SECOND, 5 * SECOND]);
    });
  }

  // The bar above the lane is aimed at an instant, and a drag changes that instant. Without the
  // selection travelling with the key, everything the bar offers goes on pointing at a moment
  // nothing sits at any more -- and `Delete` then falls through to the clip under it.
  it("leaves the bar aimed at the keyframe after it has been dragged", async () => {
    const { doc } = await sceneWithKeyframes([1, 5]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    const startX = (1 * SECOND) / DEFAULT_FLICKS_PER_PIXEL;

    down(keyAt(SECOND), { clientX: startX });
    move({ clientX: startX + 60 });
    up({ clientX: startX + 60 });
    fireEvent.keyDown(screen.getByTestId("timeline"), { key: "Delete" });

    expect(times(doc)).toEqual([5 * SECOND]);
    expect(doc.state.timeline.tracks[0]?.clips).toHaveLength(1);
  });

  it("keeps the value and the interpolation the keyframe was authored with", async () => {
    const { doc, clip } = await sceneWithKeyframes([1, 5]);
    doc.dispatch(cmd.keyframeSetInterp(on.clip(clip), null, "opacity", SECOND, "hold"));
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    const startX = (1 * SECOND) / DEFAULT_FLICKS_PER_PIXEL;

    down(keyAt(SECOND), { clientX: startX });
    move({ clientX: startX + 50 });
    up({ clientX: startX + 50 });

    const first = trackOf(doc)[0];
    expect(first?.interp).toBe("hold");
    expect(first?.value).toEqual({ kind: "float", value: 0.25 });
  });

  // Outside the clip the parameter is never evaluated, so a key dragged past the edge would be one
  // that does nothing. Clamping in the surface is also what keeps the core from refusing once per
  // pointer move, which is what a trim held at its limit once turned into nine error banners.
  it("stops at the end of the clip instead of reporting a refusal per pointer move", async () => {
    const { doc } = await sceneWithKeyframes([1]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    const startX = (1 * SECOND) / DEFAULT_FLICKS_PER_PIXEL;
    const watch = watchWindowErrors();

    down(keyAt(SECOND), { clientX: startX });
    for (let step = 1; step <= 40; step += 1) {
      move({ clientX: startX + step * 100 });
    }
    up({ clientX: startX + 4000 });
    watch.stop();

    expect(watch.errors).toHaveLength(0);
    expect(times(doc)).toEqual([10 * SECOND - 1]);
  });

  // The one refusal an ordinary drag across a track produces. Sliding past a neighbour must neither
  // raise anything nor overwrite the neighbour -- the core keeps at most one key per instant.
  it("slides past a neighbour without raising anything and without eating it", async () => {
    const { doc } = await sceneWithKeyframes([1, 2, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    const startX = (1 * SECOND) / DEFAULT_FLICKS_PER_PIXEL;
    const perSecond = SECOND / DEFAULT_FLICKS_PER_PIXEL;
    const watch = watchWindowErrors();

    down(keyAt(SECOND), { clientX: startX });
    for (let step = 1; step <= 150; step += 1) {
      move({ clientX: startX + (step / 150) * 1.6 * perSecond });
    }
    up({ clientX: startX + 1.6 * perSecond });
    watch.stop();

    expect(watch.errors).toHaveLength(0);
    expect(times(doc)).toHaveLength(3);
    expect(times(doc)).toContain(2 * SECOND);
    expect(times(doc)).toContain(3 * SECOND);
  });

  // The browser taking a gesture over mid-drag is ordinary on a phone; committing half a drag the
  // user never finished is an edit they did not make.
  it("puts a cancelled drag back where it started", async () => {
    const { doc } = await sceneWithKeyframes([1, 5]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    const startX = (1 * SECOND) / DEFAULT_FLICKS_PER_PIXEL;

    down(keyAt(SECOND), { clientX: startX, pointerType: "touch" });
    move({ clientX: startX + 80, pointerType: "touch" });
    fireEvent.pointerCancel(surface(), { pointerId: 1, pointerType: "touch", clientY: 40 });

    expect(times(doc)).toEqual([1 * SECOND, 5 * SECOND]);
  });
});

describe("what can be done to a picked keyframe", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("deletes it with the Delete key", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    down(keyAt(SECOND), { clientX: 10 });
    up({ clientX: 10 });

    fireEvent.keyDown(screen.getByTestId("timeline"), { key: "Delete" });

    expect(times(doc)).toEqual([3 * SECOND]);
    // And the clip is still there: the same key deletes a clip when no keyframe is picked, and
    // aiming it at both at once would take the clip out from under the keyframe.
    expect(doc.state.timeline.tracks[0]?.clips).toHaveLength(1);
  });

  // A finger has no Delete key, and the lane is the only place a keyframe can be reached.
  it("deletes it with the button, which is where a finger reaches it", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    down(keyAt(SECOND), { clientX: 10, pointerType: "touch" });
    up({ clientX: 10, pointerType: "touch" });

    screen.getByRole("button", { name: "Keyframe löschen" }).click();

    expect(times(doc)).toEqual([3 * SECOND]);
  });

  it("leaves the clip alone when the Delete key finds no keyframe picked", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    up({ clientX: 100 });

    fireEvent.keyDown(screen.getByTestId("timeline"), { key: "Delete" });

    expect(doc.state.timeline.tracks[0]?.clips).toHaveLength(0);
  });

  it("sets the interpolation of the segment that starts at it", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    down(keyAt(SECOND), { clientX: 10 });
    up({ clientX: 10 });

    fireEvent.change(screen.getByLabelText("Verlauf ab diesem Keyframe"), {
      target: { value: "hold" },
    });

    expect(trackOf(doc).map((entry) => entry.interp)).toEqual(["hold", "linear"]);
  });

  // What the select is set to, drawn on the gap it governs. Without it the setting is a word in a
  // box and the lane says nothing about which stretch of time it changed.
  it("redraws the segment after it in the shape of that interpolation", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    down(keyAt(SECOND), { clientX: 10 });
    up({ clientX: 10 });
    const segment = document.querySelector<HTMLElement>(".v-keylane__segment");
    expect(segment?.dataset.interp).toBe("linear");

    fireEvent.change(screen.getByLabelText("Verlauf ab diesem Keyframe"), {
      target: { value: "ease" },
    });

    expect(document.querySelector<HTMLElement>(".v-keylane__segment")?.dataset.interp).toBe("ease");
  });

  // The bar has to be aimed at the keyframe that was picked and not merely at its row. With two
  // keys set differently, a bar that reported the first one regardless would read "Linear" here.
  it("reports what the picked keyframe is set to, not what the first one on its row is", async () => {
    const { doc, clip } = await sceneWithKeyframes([1, 3]);
    doc.dispatch(cmd.keyframeSetInterp(on.clip(clip), null, "opacity", 3 * SECOND, "hold"));
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    down(keyAt(3 * SECOND), { clientX: 10 });
    up({ clientX: 10 });

    expect((screen.getByLabelText("Verlauf ab diesem Keyframe") as HTMLSelectElement).value).toBe(
      "hold",
    );
  });

  it("takes the bar away once the keyframe it was aimed at is gone", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    down(keyAt(SECOND), { clientX: 10 });
    up({ clientX: 10 });
    expect(screen.queryByTestId("keyframe-bar")).toBeTruthy();

    fireEvent.keyDown(screen.getByTestId("timeline"), { key: "Delete" });

    expect(screen.queryByTestId("keyframe-bar")).toBeNull();
  });
});

describe("a motion path in the lane", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  // The precedence rule the core applies has to be readable, not merely effective. Two rows of
  // keyframes that move nothing, with nothing on screen saying why, is worse than no rows.
  it("says which rows it overwrites", async () => {
    const { doc, clip } = await sceneWithKeyframes([]);
    for (const [seconds, value] of [
      [1, 10],
      [3, 90],
    ] as const) {
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip), null, "x", seconds * SECOND, { kind: "float", value }),
      );
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip), null, "position", seconds * SECOND, {
          kind: "vec2",
          value: [value, value],
        }),
      );
    }
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    const rows = [...document.querySelectorAll<HTMLElement>(".v-keylane__header")];
    const marked = rows.map((row) => [
      row.querySelector(".v-keylane__headerName")?.textContent,
      row.dataset.overridden !== undefined,
    ]);
    expect(marked).toEqual([
      ["Bewegungspfad", false],
      ["Position X (px)", true],
    ]);
    expect(rows[1]?.textContent).toContain("vom Pfad überschrieben");
  });
});

// --------------------------------------------------------------------------- the curve field

function openCurve(): HTMLElement {
  const disclosure = document.querySelector<HTMLDetailsElement>(
    "[data-testid='keyframe-curve-disclosure']",
  );
  if (disclosure === null) throw new Error("no curve disclosure beside the picked keyframe");
  // jsdom has no activation behaviour for a summary, so the state change is made and announced the
  // way the browser would announce it -- which is what the timeline listens to.
  act(() => {
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
  });
  const field = document.querySelector<HTMLElement>("[data-testid='keyframe-curve']");
  if (field === null) throw new Error("the disclosure opened on nothing");
  return field;
}

function handle(end: "in" | "out"): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-curve-handle='" + end + "']");
  if (element === null) throw new Error("no " + end + " handle in the curve field");
  return element;
}

// The y of every plotted step, in the 0..100 box the viewBox declares -- which runs downwards, so a
// low number is a high value.
function plotted(): number[] {
  const path = document.querySelector<SVGPathElement>(".v-curve__line");
  if (path === null) throw new Error("nothing plotted");
  return (path.getAttribute("d") ?? "")
    .split(/[ML]/)
    .filter((step) => step.trim() !== "")
    .map((step) => Number(step.trim().split(/\s+/)[1]));
}

// A plotted y, back as the value it stands for. The field draws through `upField`, which reaches
// past the unit square so an overshoot can be seen; reading the drawing back through the same
// mapping means these checks are about the shape and not about how far past it the field reaches.
function valueAt(shape: readonly number[], index: number): number {
  const y = shape[index];
  if (y === undefined) throw new Error(`no sample at ${index}`);
  return fromField(1 - y / 100);
}

// The field is a square box on a page that does not lay out in jsdom, so a pointer position has to
// be given something to be measured against. The real geometry is measured in the browser run.
function stubField(field: HTMLElement, size: number): void {
  const target = field.querySelector<HTMLElement>(".v-curve");
  if (target === null) throw new Error("no curve box");
  target.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: size,
      height: size,
      right: size,
      bottom: size,
      x: 0,
      y: 0,
      toJSON: () => "",
    }) as DOMRect;
}

async function pickedBezier(): Promise<Scene> {
  const scene = await sceneWithKeyframes([1, 5]);
  scene.doc.dispatch(cmd.keyframeSetInterp(on.clip(scene.clip), null, "opacity", SECOND, "bezier"));
  return scene;
}

function pick(time: number): void {
  down(clipElement(), { clientX: 100 });
  down(keyAt(time), { clientX: 10 });
  up({ clientX: 10 });
}

describe("the curve field", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  // Where it is, and where it is not. The lane rides the timeline's own time axis and has no value
  // axis to put a curve on; the field sits in the bar beside what the key is set to, which is
  // outside the scrolling area for the same reason that bar is.
  it("sits beside the picked keyframe rather than in the lane", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);

    const field = openCurve();
    expect(screen.getByTestId("keyframe-bar").contains(field)).toBe(true);
    expect(screen.getByTestId("keyframe-lane").contains(field)).toBe(false);
  });

  // Somebody shaping one curve after another opens the field once. Left to the element, its state
  // goes with it every time the bar around it is rebuilt -- and picking the last key of a track,
  // which has no segment, takes the whole disclosure away and brings it back closed.
  it("stays open while the pick travels from one keyframe to another", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);
    openCurve();

    down(keyAt(5 * SECOND), { clientX: 10 });
    up({ clientX: 10 });
    expect(screen.queryByTestId("keyframe-curve-disclosure")).toBeNull();

    down(keyAt(SECOND), { clientX: 10 });
    up({ clientX: 10 });

    const back = screen.getByTestId("keyframe-curve-disclosure") as HTMLDetailsElement;
    expect(back.open).toBe(true);
  });

  // The last key of a track has no travel after it to shape. Its own arriving handle belongs to the
  // field of the key before it, which is where it is reachable.
  it("is not offered on the last keyframe of a track", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(5 * SECOND);

    expect(screen.queryByTestId("keyframe-curve-disclosure")).toBeNull();
  });

  // The claim the whole thing rests on. Read a quarter of the way along, because at the two ends
  // every easing ever written agrees with every other -- a field drawing straight lines passes a
  // run that only looks there.
  it("plots the shape the core resolves, not a straight line", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);
    openCurve();

    // A bezier with no handles is ease-in-out, which lags the diagonal's 0.25 at a quarter. Read
    // through the field's own mapping, so a field that reaches further past the unit square than it
    // does today does not turn this into a number nobody can read.
    const opened = plotted();
    expect(valueAt(opened, 16)).toBeLessThan(0.2);

    // Through `act`, because this one command comes from outside a React event: without it the
    // subscriber has fired but the tree has not been asked to redraw yet, and the two readings
    // below would be the same drawing twice.
    act(() => {
      doc.dispatch(
        cmd.keyframeSetHandles(on.clip(onlyClip(doc).id), null, "opacity", SECOND, null, [
          0.9, 0.05,
        ]),
      );
    });

    const bent = plotted();
    expect(valueAt(bent, 0)).toBeCloseTo(0, 2);
    expect(valueAt(bent, bent.length - 1)).toBeCloseTo(1, 2);
    // Bent far below what it drew a moment ago: with that handle, nothing has happened yet a
    // quarter of the way through.
    expect(valueAt(bent, 16)).toBeLessThan(valueAt(opened, 16) - 0.05);
    expect(valueAt(bent, 16)).toBeLessThan(0.07);
  });

  // A hold does not ease, it waits. `ease` answers a straight line for it -- `interpolate` never
  // asks it -- so drawing that would be a curve field showing a ramp where the picture jumps.
  it("draws a hold as a step rather than as a ramp", async () => {
    const { doc, clip } = await sceneWithKeyframes([1, 5]);
    doc.dispatch(cmd.keyframeSetInterp(on.clip(clip), null, "opacity", SECOND, "hold"));
    render(<Harness doc={doc} />);
    pick(SECOND);
    openCurve();

    const shape = plotted();
    expect(valueAt(shape, 32)).toBeCloseTo(0, 2);
    expect(valueAt(shape, shape.length - 1)).toBeCloseTo(1, 2);
  });

  // Presets stay one click and the curve is the fourth entry, not a mode that replaces them.
  it("shows no handles until the key is set to bezier", async () => {
    const { doc } = await sceneWithKeyframes([1, 5]);
    render(<Harness doc={doc} />);
    pick(SECOND);
    const field = openCurve();

    expect(field.querySelector("[data-curve-handle]")).toBeNull();
    expect(field.textContent).toContain("Bezier");

    fireEvent.change(screen.getByLabelText("Verlauf ab diesem Keyframe"), {
      target: { value: "bezier" },
    });

    expect(document.querySelectorAll("[data-curve-handle]")).toHaveLength(2);
  });

  it("keeps the three presets on offer beside the curve", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);

    const select = screen.getByLabelText("Verlauf ab diesem Keyframe") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([
      "linear",
      "hold",
      "ease",
      "bezier",
    ]);
  });

  // A rate track is integrated to say how much source a clip has consumed, and a bezier has no
  // exact area. The core refuses the change, so an entry offering it could only ever produce a
  // refusal -- which is worse than an entry that is not there.
  it("does not offer bezier on a speed ramp", async () => {
    const { doc, clip } = await sceneWithKeyframes([]);
    for (const [seconds, rate] of [
      [1, 0.5],
      [5, 2],
    ] as const) {
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip), null, "speed", seconds * SECOND, {
          kind: "float",
          value: rate,
        }),
      );
    }
    render(<Harness doc={doc} />);
    pick(SECOND);

    const select = screen.getByLabelText("Verlauf ab diesem Keyframe") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["linear", "hold", "ease"]);
  });

  // Dragging one handle writes the pair the keyframe carries, so the other one survives. Sending
  // only the one under the hand would clear the other back to the default -- the very fault the
  // upsert was fixed for.
  it("writes a dragged handle and leaves its partner alone", async () => {
    const { doc, clip } = await pickedBezier();
    doc.dispatch(cmd.keyframeSetHandles(on.clip(clip), null, "opacity", SECOND, [0.1, 0.2], null));
    render(<Harness doc={doc} />);
    pick(SECOND);
    stubField(openCurve(), 200);

    const watch = watchWindowErrors();
    fireEvent.pointerDown(handle("out"), { pointerId: 7, clientX: 20, clientY: 180 });
    for (let step = 1; step <= 10; step += 1) {
      fireEvent.pointerMove(handle("out"), {
        pointerId: 7,
        clientX: 20 + step * 12,
        clientY: 180 - step * 12,
      });
    }
    fireEvent.pointerUp(handle("out"), { pointerId: 7, clientX: 140, clientY: 60 });
    watch.stop();

    expect(watch.errors.map((error) => error.message)).toEqual([]);
    const key = trackOf(doc)[0];
    expect(key?.handleOut?.[0]).toBeCloseTo(0.7, 2);
    // The pointer ended 70% up a 200 px field, and the field's y runs from -1/3 to 4/3 so that an
    // overshoot can be dragged -- so 70% up is not the value 0.7. Read through the same mapping the
    // field draws with rather than restated as a number.
    expect(key?.handleOut?.[1]).toBeCloseTo(fromField(0.7), 2);
    // Still the pair it was given, to the precision an f32 keeps it in.
    expect(key?.handleIn?.[0]).toBeCloseTo(0.1, 5);
    expect(key?.handleIn?.[1]).toBeCloseTo(0.2, 5);
  });

  // The shape a bounce is made of: a handle whose y is past where the travel arrives, so the value
  // overshoots and comes back. The core has always stored, loaded and animated it; the field used to
  // pin it to the edge, and the first drag flattened a shape nobody could put back.
  it("takes a handle past the unit square, which is what a bounce is", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);
    stubField(openCurve(), 200);

    // Ninety-five percent up the field, which is well past where the travel arrives.
    fireEvent.pointerDown(handle("out"), { pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle("out"), { pointerId: 3, clientX: 160, clientY: 10 });
    fireEvent.pointerUp(handle("out"), { pointerId: 3, clientX: 160, clientY: 10 });

    const key = trackOf(doc)[0];
    expect(key?.handleOut?.[1]).toBeGreaterThan(1);

    // And it is drawn where it was put, not against the edge: the handle's own box sits above the
    // line the travel arrives on.
    const drawn = Number(handle("out").style.bottom.replace("%", ""));
    expect(drawn).toBeGreaterThan(upField(1) * 100);
    // Past the far end of the field it is held, because a handle nobody can see is a handle nobody
    // can drag back.
    expect(drawn).toBeLessThanOrEqual(100);
  });

  // A pointer dragged clean out of the top of the field stops at what the field shows rather than
  // running off into a number no drag can undo.
  it("holds a handle at the edge of what the field shows", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);
    stubField(openCurve(), 200);

    fireEvent.pointerDown(handle("out"), { pointerId: 4, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle("out"), { pointerId: 4, clientX: 100, clientY: -4000 });
    fireEvent.pointerUp(handle("out"), { pointerId: 4, clientX: 100, clientY: -4000 });

    expect(trackOf(doc)[0]?.handleOut?.[1]).toBeCloseTo(fromField(1), 4);
  });

  // One gesture, one entry on the undo stack -- and what it takes back is the shape the curve had
  // before the drag, not the one the second-to-last pointer move left.
  it("makes one drag one undo step", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);
    stubField(openCurve(), 200);

    fireEvent.pointerDown(handle("out"), { pointerId: 8, clientX: 20, clientY: 180 });
    for (let step = 1; step <= 20; step += 1) {
      fireEvent.pointerMove(handle("out"), { pointerId: 8, clientX: 20 + step * 6, clientY: 100 });
    }
    fireEvent.pointerUp(handle("out"), { pointerId: 8, clientX: 140, clientY: 100 });
    expect(trackOf(doc)[0]?.handleOut ?? null).not.toBeNull();

    doc.undo();

    expect(trackOf(doc)[0]?.handleOut ?? null).toBeNull();
  });

  // The far end of the segment belongs to the next key. A field that wrote both onto the key under
  // the hand would move a handle the drawing says belongs somewhere else.
  it("writes the arriving handle onto the next keyframe", async () => {
    const { doc } = await pickedBezier();
    render(<Harness doc={doc} />);
    pick(SECOND);
    stubField(openCurve(), 200);

    fireEvent.pointerDown(handle("in"), { pointerId: 9, clientX: 116, clientY: 0 });
    fireEvent.pointerMove(handle("in"), { pointerId: 9, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(handle("in"), { pointerId: 9, clientX: 50, clientY: 50 });

    const track = trackOf(doc);
    expect(track[0]?.handleIn ?? null).toBeNull();
    expect(track[1]?.handleIn?.[0]).toBeCloseTo(0.25, 2);
    expect(track[1]?.handleIn?.[1]).toBeCloseTo(fromField(0.75), 2);
  });

  // The precedence rule, said on the surface that would otherwise be the most convincing of all
  // about an edit with no effect on any picture.
  it("says so when the motion path overrides the track being curved", async () => {
    const { doc, clip } = await sceneWithKeyframes([]);
    for (const [seconds, value] of [
      [1, 10],
      [5, 90],
    ] as const) {
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip), null, "x", seconds * SECOND, { kind: "float", value }),
      );
      doc.dispatch(
        cmd.keyframeAdd(on.clip(clip), null, "position", seconds * SECOND, {
          kind: "vec2",
          value: [value, value],
        }),
      );
    }
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });
    const xKey = keys().find(
      (candidate) =>
        candidate.dataset.keyframeKey === "x" && candidate.dataset.keyframeTime === String(SECOND),
    );
    if (xKey === undefined) throw new Error("no x keyframe drawn");
    down(xKey, { clientX: 10 });
    up({ clientX: 10 });

    expect(openCurve().textContent).toContain("Bewegungspfad überschreibt");
  });
});
