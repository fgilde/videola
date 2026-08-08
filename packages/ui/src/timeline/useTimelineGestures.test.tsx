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
}

function down(target: Element, step: PointerStep): void {
  fireEvent.pointerDown(target, { pointerId: 1, pointerType: "mouse", clientY: 40, ...step });
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

  it("does not drag a clip while two pointers are down", async () => {
    const doc = await documentWithOneClip();
    render(<Harness doc={doc} />);

    down(clipElement(), { clientX: 100 });
    fireEvent.pointerDown(surface(), { pointerId: 2, pointerType: "touch", clientX: 400, clientY: 40 });
    move({ clientX: 300 });

    expect(onlyClip(doc.state).start).toBe(0);
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
});
