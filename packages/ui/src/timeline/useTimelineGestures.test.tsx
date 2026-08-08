import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cmd,
  createWasmBackend,
  FLICKS_PER_SECOND,
  VideolaDocument,
  type ClipId,
  type Command,
  type Project,
} from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";

import { I18nProvider } from "../i18n/I18nProvider";
import { COARSE_TRIM_ZONE_PX, FINE_TRIM_ZONE_PX } from "./geometry";
import { Timeline } from "./Timeline";
import { makeClip, makeProject, makeTrack, restoreViewport, stubViewport } from "./Timeline.test";

// The undo behaviour of a drag is a property of the Rust history, not of a fake - a hand-written
// backend would have to reimplement coalescing to be asked about it, and would then only confirm
// itself. Same trick as packages/core/src/roundtrip.test.ts: initSync from disk, because undici
// cannot fetch a file:// URL.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "../../../core/src/wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

const SECOND = FLICKS_PER_SECOND;
const PX_PER_SECOND = 100;

async function documentWithOneClip(duration = 10 * SECOND): Promise<VideolaDocument> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("video", "V1"));
  doc.dispatch(cmd.trackAdd("video", "V2"));
  const track = doc.state.timeline.tracks[0]?.id ?? "";
  doc.dispatch(
    cmd.clipAdd(track, { kind: "generator", generator: { type: "solid", color: "#ff0000" } }, 0, duration),
  );
  return doc;
}

function onlyClip(project: Project): { id: ClipId; start: number; duration: number; track: string } {
  for (const track of project.timeline.tracks) {
    const clip = track.clips[0];
    if (clip !== undefined) {
      return { id: clip.id, start: clip.start, duration: clip.duration, track: track.id };
    }
  }
  throw new Error("no clip in project");
}

function Harness({
  doc,
  onDispatch,
}: {
  doc: VideolaDocument;
  onDispatch?: (command: Command, key?: string) => void;
}): ReactElement {
  const [project, setProject] = useState(doc.state);
  const [playhead, setPlayhead] = useState(0);
  useEffect(() => doc.subscribe(setProject), [doc]);
  return (
    <I18nProvider>
      <Timeline
        project={project}
        playhead={playhead}
        dispatch={(command, key) => {
          onDispatch?.(command, key);
          doc.dispatch(command, key);
        }}
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

interface PointerStep {
  pointerId?: number;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
  altKey?: boolean;
  button?: number;
}

function down(target: Element, step: PointerStep): void {
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: "mouse", clientY: 40, button: 0, ...step });
}

function move(step: PointerStep): void {
  fireEvent.pointerMove(surface(), { pointerId: 1, pointerType: "mouse", clientY: 40, ...step });
}

function up(step: PointerStep = {}): void {
  fireEvent.pointerUp(surface(), { pointerId: 1, pointerType: "mouse", clientY: 40, ...step });
}

describe("timeline gestures", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("selects a clip on pointer down", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);

    down(clipElement(), { clientX: 200 });

    expect(clipElement().dataset.selected).toBe("true");
  });

  it("clears the selection when the empty area is pressed", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 200 });

    down(surface(), { clientX: 900 });

    expect(clipElement().dataset.selected).toBe("false");
  });

  it("does not create an undo step for a press that never moves", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    const before = onlyClip(doc.state);

    down(clipElement(), { clientX: 200 });
    move({ clientX: 201 });
    up({ clientX: 201 });

    expect(onlyClip(doc.state).start).toBe(before.start);
    doc.undo();
    // Undoing lands on clip.add, so the clip is gone - proof the drag pushed nothing.
    expect(doc.state.timeline.tracks.some((track) => track.clips.length > 0)).toBe(false);
  });

  // The reason the core takes the coalesce key from the caller instead of from a clock: two
  // hundred moves are one gesture, so they have to be one undo step.
  it("collapses a two hundred move drag into a single undo step", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    const before = onlyClip(doc.state);

    down(clipElement(), { clientX: 0 });
    for (let step = 1; step <= 200; step += 1) {
      move({ clientX: step });
    }
    up({ clientX: 200 });

    const dragged = onlyClip(doc.state);
    expect(dragged.start).toBe(2 * SECOND);
    expect(dragged.duration).toBe(before.duration);

    doc.undo();

    const undone = onlyClip(doc.state);
    expect(undone.start).toBe(before.start);
    expect(undone.id).toBe(before.id);
  });

  it("mints a fresh coalesce key per gesture, so two drags are two undo steps", async () => {
    const doc = await documentWithOneClip();
    const keys: (string | undefined)[] = [];
    render(<Harness doc={doc} onDispatch={(_, key) => keys.push(key)} />);

    down(clipElement(), { clientX: 0 });
    move({ clientX: 100 });
    up({ clientX: 100 });
    down(clipElement(), { clientX: 100 });
    move({ clientX: 200 });
    up({ clientX: 200 });

    expect(onlyClip(doc.state).start).toBe(2 * SECOND);
    expect(new Set(keys).size).toBe(2);

    doc.undo();
    expect(onlyClip(doc.state).start).toBe(1 * SECOND);
    doc.undo();
    expect(onlyClip(doc.state).start).toBe(0);
  });

  it("leaves the timeline alone for every button but the primary one", async () => {
    const doc = await documentWithOneClip();
    const dispatched: Command[] = [];
    render(<Harness doc={doc} onDispatch={(command) => dispatched.push(command)} />);

    down(clipElement(), { clientX: 0, button: 2 });
    move({ clientX: 300 });
    up({ clientX: 300 });

    expect(dispatched).toEqual([]);
    expect(onlyClip(doc.state).start).toBe(0);
  });

  // The browser cancels the pointer when it takes a gesture over. Committing the half of a drag
  // the user never finished is an edit they did not make.
  it("puts a clip back where it started when the browser cancels the drag", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);

    down(clipElement(), { clientX: 0 });
    for (let step = 1; step <= 20; step += 1) move({ clientX: step * 10 });
    expect(onlyClip(doc.state).start).toBe(2 * SECOND);

    fireEvent.pointerCancel(surface(), { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 40 });

    expect(onlyClip(doc.state).start).toBe(0);
  });

  it("puts a trimmed edge back when the browser cancels the drag", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    const before = onlyClip(doc.state).duration;
    const endHandle = clipElement().querySelector('[data-edge="end"]');
    if (endHandle === null) throw new Error("trim handle missing");

    down(endHandle, { clientX: 1000 });
    move({ clientX: 800 });
    expect(onlyClip(doc.state).duration).not.toBe(before);

    fireEvent.pointerCancel(surface(), { pointerId: 1, pointerType: "touch", clientX: 800, clientY: 40 });

    expect(onlyClip(doc.state).duration).toBe(before);
  });

  it("never drags a clip before the start of the timeline", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);

    down(clipElement(), { clientX: 500 });
    move({ clientX: 0 });
    up({ clientX: 0 });

    expect(onlyClip(doc.state).start).toBe(0);
  });

  it("moves a clip to the track the pointer ends over", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    expect(onlyClip(doc.state).track).toBe(doc.state.timeline.tracks[0]?.id);

    // tracks[0] is the bottom row, so the upper row is the second track.
    down(clipElement(), { clientX: 0, clientY: 100 });
    move({ clientX: 20, clientY: 10 });
    up({ clientX: 20, clientY: 10 });

    expect(onlyClip(doc.state).track).toBe(doc.state.timeline.tracks[1]?.id);
  });

  it("trims the end edge and keeps the start where it was", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    const before = onlyClip(doc.state);
    const endHandle = clipElement().querySelector('[data-edge="end"]');
    if (endHandle === null) throw new Error("trim handle missing");

    down(endHandle, { clientX: 1000 });
    for (let step = 1; step <= 200; step += 1) {
      move({ clientX: 1000 - step });
    }
    up({ clientX: 800 });

    const trimmed = onlyClip(doc.state);
    expect(trimmed.start).toBe(before.start);
    expect(trimmed.duration).toBe(before.duration - 2 * SECOND);

    doc.undo();
    expect(onlyClip(doc.state).duration).toBe(before.duration);
  });

  it("survives a trim the core refuses and keeps following the pointer back", async () => {
    const doc = await documentWithOneClip(2 * SECOND);
    const reported: unknown[] = [];
    const onError = (event: Event) => reported.push(event);
    window.addEventListener("error", onError);
    render(<Harness doc={doc} />);
    const endHandle = clipElement().querySelector('[data-edge="end"]');
    if (endHandle === null) throw new Error("trim handle missing");

    down(endHandle, { clientX: 200 });
    // Two seconds of clip is 200 px; dragging 400 px left would empty it, which the core rejects.
    move({ clientX: -200 });
    move({ clientX: 100 });
    up({ clientX: 100 });
    window.removeEventListener("error", onError);

    expect(onlyClip(doc.state).duration).toBe(1 * SECOND);
    // Hitting the edge's limit is ordinary use, not a fault to report.
    expect(reported).toEqual([]);
  });

  it("scrubs the playhead from the ruler", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    const ruler = document.querySelector("[data-timeline-ruler]");
    if (ruler === null) throw new Error("ruler missing");

    down(ruler, { clientX: 350 });
    move({ clientX: 500 });
    up({ clientX: 500 });

    expect(screen.getByTestId("timeline-playhead").style.left).toBe("500px");
  });

  it("does not dispatch anything while scrubbing", async () => {
    const doc = await documentWithOneClip();
    const dispatched: Command[] = [];
    render(<Harness doc={doc} onDispatch={(command) => dispatched.push(command)} />);
    const ruler = document.querySelector("[data-timeline-ruler]");
    if (ruler === null) throw new Error("ruler missing");

    down(ruler, { clientX: 350 });
    move({ clientX: 500 });
    up({ clientX: 500 });

    expect(dispatched).toEqual([]);
  });
});

describe("snapping in a drag", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  // The neighbour sits at 5.5 s so it cannot be confused with the one second grid, which the
  // default zoom puts at every whole second.
  async function twoClips(): Promise<VideolaDocument> {
    const doc = new VideolaDocument(await createWasmBackend());
    doc.dispatch(cmd.trackAdd("video", "V1"));
    doc.dispatch(cmd.trackAdd("video", "V2"));
    const solid = { kind: "generator", generator: { type: "solid", color: "#ff0000" } } as const;
    doc.dispatch(cmd.clipAdd(doc.state.timeline.tracks[0]?.id ?? "", solid, 0, 2 * SECOND));
    doc.dispatch(cmd.clipAdd(doc.state.timeline.tracks[1]?.id ?? "", solid, 5.5 * SECOND, 2 * SECOND));
    return doc;
  }

  function clipById(doc: VideolaDocument, index: number): { id: ClipId; start: number } {
    const clip = doc.state.timeline.tracks[index]?.clips[0];
    if (clip === undefined) throw new Error("clip missing");
    return { id: clip.id, start: clip.start };
  }

  function elementFor(id: ClipId): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-clip-id="${id}"]`);
    if (element === null) throw new Error("clip element missing");
    return element;
  }

  function dragDragged(doc: VideolaDocument, toX: number, step: PointerStep = {}): void {
    const dragged = clipById(doc, 0).id;
    down(elementFor(dragged), { clientX: 0, clientY: 100 });
    move({ clientX: toX, clientY: 100, ...step });
    up({ clientX: toX, clientY: 100, ...step });
  }

  it("pulls a dragged clip onto a neighbouring clip's edge", async () => {
    const doc = await twoClips();
    render(<Harness doc={doc} />);

    // 545 px is 5.45 s: five pixels short of the neighbour, forty-five past the grid line.
    dragDragged(doc, 545);

    expect(clipById(doc, 0).start).toBe(5.5 * SECOND);
  });

  it("lets the modifier key through, so an off-grid position stays reachable", async () => {
    const doc = await twoClips();
    render(<Harness doc={doc} />);

    dragDragged(doc, 545, { altKey: true });

    expect(clipById(doc, 0).start).toBe(5.45 * SECOND);
  });

  it("stops snapping when the toolbar switch is off", async () => {
    const doc = await twoClips();
    render(<Harness doc={doc} />);
    act(() => screen.getByRole("button", { name: "Einrasten" }).click());

    dragDragged(doc, 545);

    expect(clipById(doc, 0).start).toBe(5.45 * SECOND);
  });

  it("snaps the trailing edge onto a neighbour too", async () => {
    const doc = await twoClips();
    render(<Harness doc={doc} />);

    // 347 px is 3.47 s; the clip's own end then lands 3 px short of the neighbour at 5.5 s.
    dragDragged(doc, 347);

    expect(clipById(doc, 0).start).toBe(3.5 * SECOND);
  });

  it("shows the line it snapped to while the drag is running", async () => {
    const doc = await twoClips();
    render(<Harness doc={doc} />);
    const dragged = clipById(doc, 0).id;

    down(elementFor(dragged), { clientX: 0, clientY: 100 });
    move({ clientX: 545, clientY: 100 });

    expect(screen.getByTestId("timeline-snapline").style.left).toBe("550px");

    up({ clientX: 545, clientY: 100 });
    expect(screen.queryByTestId("timeline-snapline")).toBeNull();
  });

  it("snaps the playhead to a clip edge while scrubbing", async () => {
    const doc = await twoClips();
    render(<Harness doc={doc} />);
    const ruler = document.querySelector("[data-timeline-ruler]");
    if (ruler === null) throw new Error("ruler missing");

    down(ruler, { clientX: 545 });
    up({ clientX: 545 });

    expect(screen.getByTestId("timeline-playhead").style.left).toBe("550px");
  });

  it("snaps a trimmed edge onto a neighbour", async () => {
    const doc = await twoClips();
    render(<Harness doc={doc} />);
    const dragged = clipById(doc, 0).id;
    const handle = elementFor(dragged).querySelector('[data-edge="end"]');
    if (handle === null) throw new Error("trim handle missing");

    down(handle, { clientX: 200, clientY: 100 });
    move({ clientX: 547, clientY: 100 });
    up({ clientX: 547, clientY: 100 });

    const clip = doc.state.timeline.tracks[0]?.clips[0];
    expect((clip?.start ?? 0) + (clip?.duration ?? 0)).toBe(5.5 * SECOND);
  });
});

describe("touch targets", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  function renderStatic(): void {
    const project = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, 10 * SECOND)])]);
    render(
      <I18nProvider>
        <Timeline project={project} playhead={0} dispatch={() => {}} onSeek={() => {}} />
      </I18nProvider>,
    );
  }

  function trimWidth(): string {
    return (
      document.querySelector<HTMLElement>('[data-edge="end"]')?.style.width ?? "missing"
    );
  }

  // Coarse first: a finger has to hit the trim zone on its very first touch, before anything
  // knows what kind of pointer is in use.
  it("starts at the coarse zone before any pointer has been seen", () => {
    renderStatic();
    expect(trimWidth()).toBe(`${COARSE_TRIM_ZONE_PX}px`);
  });

  it("narrows the zone only once a mouse has proven itself", () => {
    renderStatic();
    fireEvent.pointerMove(surface(), { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    expect(trimWidth()).toBe(`${FINE_TRIM_ZONE_PX}px`);
  });

  it("goes back to the coarse zone the moment a finger touches", () => {
    renderStatic();
    fireEvent.pointerMove(surface(), { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerDown(surface(), { pointerId: 2, pointerType: "touch", clientX: 10, clientY: 10 });
    expect(trimWidth()).toBe(`${COARSE_TRIM_ZONE_PX}px`);
  });

  it("never lets the two zones swallow a narrow clip's body", () => {
    const project = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, SECOND / 2)])]);
    render(
      <I18nProvider>
        <Timeline project={project} playhead={0} dispatch={() => {}} onSeek={() => {}} />
      </I18nProvider>,
    );
    // Half a second is 50 px at the default zoom, so a full 44 px zone would leave no body.
    expect(Number.parseFloat(trimWidth())).toBeLessThan(50 / 2);
  });
});

describe("pinch and wheel zoom", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  function renderStatic(): void {
    const project = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, 10 * SECOND)])]);
    render(
      <I18nProvider>
        <Timeline project={project} playhead={0} dispatch={() => {}} onSeek={() => {}} />
      </I18nProvider>,
    );
  }

  function clipWidth(): number {
    return Number.parseFloat(clipElement().style.width);
  }

  it("zooms in when two pointers move apart", () => {
    renderStatic();
    expect(clipWidth()).toBe(10 * PX_PER_SECOND);

    fireEvent.pointerDown(surface(), { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 40 });
    fireEvent.pointerDown(surface(), { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 40 });
    fireEvent.pointerMove(surface(), { pointerId: 2, pointerType: "touch", clientX: 600, clientY: 40 });

    expect(clipWidth()).toBe(20 * PX_PER_SECOND);
  });

  it("zooms out when two pointers come together", () => {
    renderStatic();
    fireEvent.pointerDown(surface(), { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 40 });
    fireEvent.pointerDown(surface(), { pointerId: 2, pointerType: "touch", clientX: 600, clientY: 40 });
    fireEvent.pointerMove(surface(), { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 40 });

    expect(clipWidth()).toBe(5 * PX_PER_SECOND);
  });

  // A palm landing next to the finger that is dragging is not a request to zoom, and it must
  // not end the drag either -- the gesture used to die there and stay dead.
  it("keeps a running drag alive through a stray second contact", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);

    down(clipElement(), { clientX: 100 });
    fireEvent.pointerDown(surface(), { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 40 });
    fireEvent.pointerUp(surface(), { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 40 });
    move({ clientX: 300 });
    up({ clientX: 300 });

    expect(onlyClip(doc.state).start).toBe(2 * SECOND);
  });

  it("carries a pinch through the lifting of a third pointer", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    const width = () => Number.parseFloat(clipElement().style.width);
    const before = width();

    fireEvent.pointerDown(surface(), { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 40 });
    fireEvent.pointerDown(surface(), { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 40 });
    fireEvent.pointerDown(surface(), { pointerId: 3, pointerType: "touch", clientX: 500, clientY: 40 });
    fireEvent.pointerUp(surface(), { pointerId: 3, pointerType: "touch", clientX: 500, clientY: 40 });
    fireEvent.pointerMove(surface(), { pointerId: 2, pointerType: "touch", clientX: 600, clientY: 40 });

    expect(width()).toBeGreaterThan(before);
  });

  // A trackpad pinch never arrives as two pointers; the browser turns it into ctrl+wheel.
  it("zooms on ctrl and wheel, which is what a trackpad pinch really sends", () => {
    renderStatic();
    const event = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, clientX: 0, cancelable: true, bubbles: true });
    act(() => {
      surface().dispatchEvent(event);
    });

    expect(clipWidth()).toBeGreaterThan(10 * PX_PER_SECOND);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a plain wheel to the browser, so horizontal scrolling still works", () => {
    renderStatic();
    const event = new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true });
    act(() => {
      surface().dispatchEvent(event);
    });

    expect(clipWidth()).toBe(10 * PX_PER_SECOND);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("clip context menu", () => {
  beforeEach(() => {
    stubViewport();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    restoreViewport();
  });

  async function openByLongPress(doc: VideolaDocument): Promise<void> {
    render(<Harness doc={doc} />);
    fireEvent.pointerDown(clipElement(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 40 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  }

  it("opens on a long press, because a phone has no right click", async () => {
    await openByLongPress(await documentWithOneClip());
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("does not open when the press turns into a drag", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    fireEvent.pointerDown(clipElement(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 40 });
    fireEvent.pointerMove(surface(), { pointerId: 1, pointerType: "touch", clientX: 160, clientY: 40 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lets no press timer from an earlier pointerdown fire into the next gesture", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    fireEvent.pointerDown(clipElement(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 40 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    fireEvent.pointerDown(clipElement(), { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 40 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // 600 ms after the first press, 200 ms after the second: only a leaked timer opens here.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on a right click for a mouse, in place of the browser menu", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);

    const notPrevented = fireEvent.contextMenu(clipElement(), { clientX: 100, clientY: 40 });

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(notPrevented).toBe(false);
  });

  it("leaves the browser menu alone outside a clip", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);

    const notPrevented = fireEvent.contextMenu(surface(), { clientX: 800, clientY: 40 });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(notPrevented).toBe(true);
  });

  it("really splits the clip, at the playhead", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    const ruler = document.querySelector("[data-timeline-ruler]");
    if (ruler === null) throw new Error("ruler missing");
    down(ruler, { clientX: 300 });
    up({ clientX: 300 });
    fireEvent.contextMenu(clipElement(), { clientX: 100, clientY: 40 });

    act(() => screen.getByRole("menuitem", { name: "Am Playhead teilen" }).click());

    const clips = doc.state.timeline.tracks.flatMap((track) => track.clips);
    expect(clips).toHaveLength(2);
    expect(clips[0]?.duration).toBe(3 * SECOND);
  });

  // From Task 14 the playhead moves under a standing menu. An entry that decided once and then
  // dispatched the current playhead offered an edit the core refuses.
  it("follows the playhead while the menu stands", () => {
    const project = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, 10 * SECOND)])]);
    const at = (playhead: number) => (
      <I18nProvider>
        <Timeline project={project} playhead={playhead} dispatch={() => {}} onSeek={() => {}} />
      </I18nProvider>
    );
    const view = render(at(3 * SECOND));
    fireEvent.contextMenu(clipElement(), { clientX: 100, clientY: 40 });
    const split = () => screen.getByRole("menuitem", { name: "Am Playhead teilen" });
    expect(split().hasAttribute("disabled")).toBe(false);

    // What Playback.onTime does from Task 14 on: the playhead moves, the menu stays put.
    view.rerender(at(20 * SECOND));

    expect(split().hasAttribute("disabled")).toBe(true);
  });

  it("closes itself when the clip it belongs to is gone", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    fireEvent.contextMenu(clipElement(), { clientX: 100, clientY: 40 });
    act(() => screen.getByRole("menuitem", { name: "Clip löschen" }).click());

    expect(screen.queryByRole("menu")).toBeNull();
  });

  // The clip can also go without the menu being the one that removed it -- another view, a
  // command from the shell, an undo. The menu must not outlive what it points at.
  it("closes when the clip disappears from under it", () => {
    const withClip = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, 10 * SECOND)])]);
    const at = (scene: typeof withClip) => (
      <I18nProvider>
        <Timeline project={scene} playhead={3 * SECOND} dispatch={() => {}} onSeek={() => {}} />
      </I18nProvider>
    );
    const view = render(at(withClip));
    fireEvent.contextMenu(clipElement(), { clientX: 100, clientY: 40 });
    expect(screen.getByRole("menu")).toBeTruthy();

    view.rerender(at(makeProject([makeTrack("trk_1", [])])));

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers no split when the playhead is outside the clip", async () => {
    const doc = await documentWithOneClip(SECOND);
    render(<Harness doc={doc} />);
    fireEvent.contextMenu(clipElement(), { clientX: 100, clientY: 40 });

    expect(
      screen.getByRole("menuitem", { name: "Am Playhead teilen" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("really deletes the clip", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);
    fireEvent.contextMenu(clipElement(), { clientX: 100, clientY: 40 });

    act(() => screen.getByRole("menuitem", { name: "Clip löschen" }).click());

    expect(doc.state.timeline.tracks.flatMap((track) => track.clips)).toEqual([]);
  });

  it("closes on Escape", async () => {
    await openByLongPress(await documentWithOneClip());
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // Found by a counter-check: taking the outside-press listener out of useDismiss left all 125
  // tests green. Escape was covered and the other half of the same hook was not -- and it is the
  // half a finger uses, because a phone has no Escape key.
  it("closes when the press lands outside it", async () => {
    await openByLongPress(await documentWithOneClip());
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("stays open while the press lands inside it", async () => {
    await openByLongPress(await documentWithOneClip());
    act(() => {
      fireEvent.pointerDown(screen.getByRole("menu"));
    });
    expect(screen.queryByRole("menu")).not.toBeNull();
  });
});
