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
  VideolaDocument,
  type Clip,
  type Project,
} from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";

import { I18nProvider } from "../i18n/I18nProvider";
import { Timeline } from "./Timeline";
import { restoreViewport, stubViewport } from "./Timeline.test";

// The real Rust core, like useTimelineGestures.test.tsx: what a ripple, a roll or a slide leaves
// behind is the core's answer, and a fake backend asked about it would only confirm itself.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "../../../core/src/wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

const SECOND = FLICKS_PER_SECOND;
const CLIP_SECONDS = 2;

async function documentWithClips(count: number): Promise<VideolaDocument> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("video", "V1"));
  const track = doc.state.timeline.tracks[0]?.id ?? "";
  for (let index = 0; index < count; index += 1) {
    doc.dispatch(
      cmd.clipAdd(
        track,
        { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
        index * CLIP_SECONDS * SECOND,
        CLIP_SECONDS * SECOND,
      ),
    );
  }
  return doc;
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
        dispatch={(command, key) => doc.dispatch(command, key)}
        onSeek={setPlayhead}
      />
    </I18nProvider>
  );
}

function clips(project: Project): Clip[] {
  return project.timeline.tracks.flatMap((track) => track.clips);
}

function starts(project: Project): number[] {
  return clips(project).map((clip) => clip.start / SECOND);
}

function durations(project: Project): number[] {
  return clips(project).map((clip) => clip.duration / SECOND);
}

function surface(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".v-timeline__scroll");
  if (element === null) throw new Error("timeline surface missing");
  return element;
}

function clipElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-clip-id]")];
}

function clipAt(index: number): HTMLElement {
  const element = clipElements()[index];
  if (element === undefined) throw new Error(`no clip at ${index}`);
  return element;
}

function handleOf(clip: HTMLElement, edge: "start" | "end"): Element {
  const handle = clip.querySelector(`[data-edge="${edge}"]`);
  if (handle === null) throw new Error(`no ${edge} handle`);
  return handle;
}

function down(target: Element, clientX: number, extra: Record<string, unknown> = {}): void {
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: "mouse",
    clientY: 40,
    button: 0,
    clientX,
    ...extra,
  });
}

function move(clientX: number): void {
  fireEvent.pointerMove(surface(), { pointerId: 1, pointerType: "mouse", clientY: 40, clientX });
}

function up(clientX: number): void {
  fireEvent.pointerUp(surface(), { pointerId: 1, pointerType: "mouse", clientY: 40, clientX });
}

// One default zoom step is 100 px per second, so a pixel is 10 ms.
function drag(target: Element, fromX: number, toX: number): void {
  down(target, fromX);
  move(fromX + 4);
  move(toX);
  up(toX);
}

function chooseEdgeMode(label: string): void {
  fireEvent.change(screen.getByLabelText("Kante ziehen"), { target: { value: label } });
}

function chooseDragMode(label: string): void {
  fireEvent.change(screen.getByLabelText("Clip ziehen"), { target: { value: label } });
}

function press(key: string, extra: Record<string, unknown> = {}): void {
  fireEvent.keyDown(screen.getByTestId("timeline"), { key, ...extra });
}

describe("ripple delete", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("closes the gap it leaves, unlike a plain delete", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);

    fireEvent.contextMenu(clipAt(1), { clientX: 100, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Löschen und Lücke schließen" }));

    expect(starts(doc.state)).toEqual([0, 2]);
    expect(durations(doc.state)).toEqual([2, 2]);
  });

  it("is reached from the keyboard with shift, and a plain delete keeps the gap", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);

    down(clipAt(1), 300);
    press("Delete");
    expect(starts(doc.state)).toEqual([0, 4]);

    down(clipAt(1), 500);
    press("Delete", { shiftKey: true });
    expect(starts(doc.state)).toEqual([0]);
  });

  it("takes the whole selection in one undo step", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);
    const steps = () => doc.state.timeline.tracks[0]?.clips.length ?? 0;

    down(clipAt(0), 100);
    down(clipAt(1), 300, { ctrlKey: true });
    press("Delete", { shiftKey: true });
    expect(steps()).toBe(1);

    doc.undo();

    expect(starts(doc.state)).toEqual([0, 2, 4]);
  });
});

describe("multi selection", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("adds a clip with a modifier click and drops it again", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    down(clipAt(0), 100);
    down(clipAt(1), 300, { ctrlKey: true });
    expect(clipElements().map((clip) => clip.dataset.selected)).toEqual(["true", "true"]);

    down(clipAt(1), 300, { ctrlKey: true });
    expect(clipElements().map((clip) => clip.dataset.selected)).toEqual(["true", "false"]);
  });

  // Found in the browser harness, where a click is a press *and* a release: the narrowing on
  // release undid the widening the modifier press had just made.
  it("keeps a clip added by a modifier click once the button comes up", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    down(clipAt(0), 100);
    up(100);
    down(clipAt(1), 300, { ctrlKey: true });
    up(300);

    expect(clipElements().map((clip) => clip.dataset.selected)).toEqual(["true", "true"]);
  });

  it("replaces the selection on a plain click", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    down(clipAt(0), 100);
    down(clipAt(1), 300, { ctrlKey: true });
    // The narrowing happens when the button comes up: while it is down the press has to keep the
    // whole selection, or a drag of several clips could never start.
    down(clipAt(1), 300);
    expect(clipElements().map((clip) => clip.dataset.selected)).toEqual(["true", "true"]);
    up(300);

    expect(clipElements().map((clip) => clip.dataset.selected)).toEqual(["false", "true"]);
  });

  // The press that starts the drag must not throw the rest of the selection away, or dragging
  // several clips would be impossible.
  it("moves every selected clip by the same step in one undo step", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    down(clipAt(0), 100);
    down(clipAt(1), 300, { ctrlKey: true });
    down(clipAt(1), 300);
    move(304);
    move(400);
    up(400);

    expect(starts(doc.state)).toEqual([1, 3]);

    doc.undo();

    expect(starts(doc.state)).toEqual([0, 2]);
  });

  // Dragging past zero used to squeeze the selection together, because `clip.move` pins every
  // start at zero on its own.
  it("keeps the spacing when the selection is dragged past the start", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    down(clipAt(0), 100);
    down(clipAt(1), 300, { ctrlKey: true });
    down(clipAt(1), 300);
    move(304);
    move(0);
    up(0);

    expect(starts(doc.state)).toEqual([0, 2]);
  });
});

describe("groups", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  async function groupedDocument(): Promise<VideolaDocument> {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);
    down(clipAt(0), 100);
    down(clipAt(1), 300, { ctrlKey: true });
    press("g", { ctrlKey: true });
    return doc;
  }

  it("ties the selected clips together", async () => {
    const doc = await groupedDocument();
    const grouped = clips(doc.state).map((clip) => clip.groupId ?? null);

    expect(grouped[0]).not.toBeNull();
    expect(grouped[1]).toBe(grouped[0]);
    expect(grouped[2]).toBeNull();
  });

  it("picks up the whole group when one of its clips is clicked", async () => {
    await groupedDocument();

    down(clipAt(2), 500);
    expect(clipElements().map((clip) => clip.dataset.selected)).toEqual(["false", "false", "true"]);

    down(clipAt(0), 100);
    expect(clipElements().map((clip) => clip.dataset.selected)).toEqual(["true", "true", "false"]);
  });

  it("moves the whole group when one of its clips is dragged", async () => {
    const doc = await groupedDocument();

    drag(clipAt(0), 100, 200);

    expect(starts(doc.state)).toEqual([1, 3, 4]);
  });

  it("lets go of the group again", async () => {
    const doc = await groupedDocument();

    press("g", { ctrlKey: true, shiftKey: true });

    expect(clips(doc.state).every((clip) => clip.groupId == null)).toBe(true);
  });
});

describe("edge modes", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("trims only the clip under the pointer by default", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    drag(handleOf(clipAt(0), "end"), 200, 300);

    expect(durations(doc.state)).toEqual([3, 2]);
    expect(starts(doc.state)).toEqual([0, 2]);
  });

  it("carries the later clips along in ripple mode", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);
    chooseEdgeMode("ripple");

    drag(handleOf(clipAt(0), "end"), 200, 300);

    expect(durations(doc.state)).toEqual([3, 2, 2]);
    expect(starts(doc.state)).toEqual([0, 3, 5]);
  });

  // A ripple of the head never moves the start, so a step measured against the edge on screen
  // would be dispatched again on every pointer move and the clip would shrink to nothing.
  it("shortens the head once per pointer step in ripple mode", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);
    chooseEdgeMode("ripple");

    down(handleOf(clipAt(1), "start"), 200);
    for (let step = 1; step <= 20; step += 1) move(200 + step * 2);
    up(240);

    expect(starts(doc.state)).toEqual([0, 2]);
    expect(durations(doc.state)).toEqual([2, 1.6]);
    expect(clips(doc.state)[1]?.inPoint).toBe(0.4 * SECOND);
  });

  it("moves the cut between two clips in roll mode", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);
    chooseEdgeMode("roll");

    drag(handleOf(clipAt(0), "end"), 200, 250);

    expect(durations(doc.state)).toEqual([2.5, 1.5, 2]);
    expect(starts(doc.state)).toEqual([0, 2.5, 4]);
    expect(clips(doc.state)[1]?.inPoint).toBe(0.5 * SECOND);
  });

  // Rolling the first cut to the left would ask the second clip for material in front of its in
  // point. The core refuses that, and a refusal during a drag is ordinary: no banner, no throw.
  it("stands still when the core refuses a roll, without reporting an error", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);
    chooseEdgeMode("roll");
    const errors: unknown[] = [];
    const listener = (event: ErrorEvent): void => {
      errors.push(event.error);
    };
    window.addEventListener("error", listener);

    drag(handleOf(clipAt(0), "end"), 200, 150);

    window.removeEventListener("error", listener);
    expect(errors).toEqual([]);
    expect(starts(doc.state)).toEqual([0, 2]);
    expect(durations(doc.state)).toEqual([2, 2]);
  });
});

describe("drag modes", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("moves the material under the clip in slip mode", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);
    chooseDragMode("slip");

    drag(clipAt(0), 100, 150);

    expect(starts(doc.state)).toEqual([0, 2]);
    expect(durations(doc.state)).toEqual([2, 2]);
    expect(clips(doc.state)[0]?.inPoint).toBe(0.5 * SECOND);
  });

  // Slip dispatches the step from where the material actually sits, so two hundred moves add up to
  // the distance the pointer travelled and not to two hundred times it.
  it("slips by the distance the pointer covered, not by the sum of its steps", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    chooseDragMode("slip");

    down(clipAt(0), 0);
    for (let step = 1; step <= 100; step += 1) move(step);
    up(100);

    expect(clips(doc.state)[0]?.inPoint).toBe(1 * SECOND);
  });

  it("lets the neighbours absorb the step in slide mode", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);
    chooseDragMode("slide");

    drag(clipAt(1), 300, 350);

    expect(starts(doc.state)).toEqual([0, 2.5, 4.5]);
    expect(durations(doc.state)).toEqual([2.5, 2, 1.5]);
    expect(clips(doc.state)[1]?.inPoint).toBe(0);
  });

  it("puts a cancelled slide back, neighbours included", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);
    chooseDragMode("slide");

    down(clipAt(1), 300);
    move(304);
    move(350);
    expect(starts(doc.state)).not.toEqual([0, 2, 4]);
    fireEvent.pointerCancel(surface(), {
      pointerId: 1,
      pointerType: "touch",
      clientX: 350,
      clientY: 40,
    });

    expect(starts(doc.state)).toEqual([0, 2, 4]);
    expect(durations(doc.state)).toEqual([2, 2, 2]);
  });

  it("puts a cancelled slip back", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    chooseDragMode("slip");

    down(clipAt(0), 100);
    move(104);
    move(200);
    expect(clips(doc.state)[0]?.inPoint).not.toBe(0);
    fireEvent.pointerCancel(surface(), {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 40,
    });

    expect(clips(doc.state)[0]?.inPoint).toBe(0);
  });
});

describe("clipboard", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("pastes a copy at the playhead, with everything the clip carried", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    act(() => {
      doc.dispatch(cmd.clipSetVolume(clips(doc.state)[0]?.id ?? "", 0.25));
    });

    down(clipAt(0), 100);
    press("c", { ctrlKey: true });
    // A press on the time scale is how the playhead moves: 500 px is five seconds.
    down(screen.getByLabelText("Zeitskala"), 500);
    press("v", { ctrlKey: true });

    const pasted = clips(doc.state);
    expect(pasted).toHaveLength(2);
    expect(pasted[1]?.start).toBe(5 * SECOND);
    expect(pasted[1]?.volume).toBe(0.25);
    expect(pasted[1]?.id).not.toBe(pasted[0]?.id);
  });

  it("keeps the spacing of several copied clips", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    down(clipAt(0), 100);
    down(clipAt(1), 300, { ctrlKey: true });
    press("c", { ctrlKey: true });
    down(screen.getByLabelText("Zeitskala"), 1000);
    press("v", { ctrlKey: true });

    expect(starts(doc.state)).toEqual([0, 2, 10, 12]);
  });

  it("cuts to the clipboard, so the material survives the deletion", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    down(clipAt(0), 100);
    press("x", { ctrlKey: true });
    expect(starts(doc.state)).toEqual([2]);

    down(screen.getByLabelText("Zeitskala"), 800);
    press("v", { ctrlKey: true });

    expect(starts(doc.state)).toEqual([2, 8]);
  });

  it("offers no paste until something has been copied", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);

    fireEvent.contextMenu(clipAt(0), { clientX: 100, clientY: 40 });

    const paste = screen.getByRole("menuitem", { name: "Am Playhead einfügen" });
    expect(paste).toBeInstanceOf(HTMLButtonElement);
    expect((paste as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("markers", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("puts a marker at the playhead and draws it there", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);

    down(screen.getByLabelText("Zeitskala"), 300);
    fireEvent.click(screen.getByRole("button", { name: "Marker setzen" }));

    expect(doc.state.markers.map((marker) => marker.time)).toEqual([3 * SECOND]);
    expect(screen.getByRole("button", { name: "Marker" }).style.left).toBe("300px");
  });

  it("is reachable from the keyboard too", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);

    down(screen.getByLabelText("Zeitskala"), 200);
    press("m");

    expect(doc.state.markers).toHaveLength(1);
  });

  it("moves the playhead when a marker is clicked", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    act(() => {
      doc.dispatch(cmd.markerAdd(4 * SECOND, "chapter"));
    });

    fireEvent.click(screen.getByRole("button", { name: "Marker: chapter" }));

    expect(screen.getByTestId("timeline-playhead").style.left).toBe("400px");
  });

  it("deletes a marker from its own menu", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    act(() => {
      doc.dispatch(cmd.markerAdd(4 * SECOND, "chapter"));
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: "Marker: chapter" }), {
      clientX: 400,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Marker löschen" }));

    expect(doc.state.markers).toEqual([]);
  });

  // The snap candidates already knew about markers; what was missing was a way to put one there.
  it("snaps a dragged clip to a marker", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    // Off the one second grid on purpose: on a grid line the ruler's own candidate is nearer, and
    // the assertion would hold whether markers snapped or not.
    act(() => {
      doc.dispatch(cmd.markerAdd(4.53 * SECOND, "chapter"));
    });

    drag(clipAt(0), 0, 450);

    expect(clips(doc.state)[0]?.start).toBe(4.53 * SECOND);
  });
});
