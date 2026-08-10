import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, fireEvent, render } from "@testing-library/react";
import { useEffect, useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cmd,
  createWasmBackend,
  FLICKS_PER_SECOND,
  VideolaDocument,
  type ClipId,
  type Project,
  type Time,
} from "@videola/core";
import { initSync } from "@videola/core/src/wasm/videola_core.js";

import { I18nProvider } from "../i18n/I18nProvider";
import { Timeline } from "./Timeline";
import { restoreViewport, stubViewport } from "./Timeline.test";

// The real core, like every other timeline test: what a split leaves behind is the core's answer.
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

interface Seen {
  playhead: Time;
  selection: readonly ClipId[];
}

const seen: Seen = { playhead: 0, selection: [] };

function Harness({
  doc,
  startAt = 0,
  at,
  playing = false,
}: {
  doc: VideolaDocument;
  startAt?: Time;
  /** A playhead the test drives from outside, for the checks about the view following it. */
  at?: Time;
  playing?: boolean;
}): ReactElement {
  const [project, setProject] = useState(doc.state);
  const [seeked, setPlayhead] = useState(startAt);
  useEffect(() => doc.subscribe(setProject), [doc]);
  const playhead = at ?? seeked;
  seen.playhead = playhead;
  return (
    <I18nProvider>
      <Timeline
        project={project}
        playhead={playhead}
        playing={playing}
        dispatch={(command, key) => doc.dispatch(command, key)}
        onSeek={(time) => {
          setPlayhead(time);
        }}
        onSelectionChange={(clips) => {
          seen.selection = clips;
        }}
      />
    </I18nProvider>
  );
}

function surface(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".v-timeline__scroll");
  if (element === null) throw new Error("timeline surface missing");
  return element;
}

function press(key: string, extra: Record<string, unknown> = {}): void {
  fireEvent.keyDown(surface(), { key, ...extra });
}

function clipElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-clip-id]")];
}

function starts(project: Project): number[] {
  return project.timeline.tracks.flatMap((track) => track.clips).map((clip) => clip.start / SECOND);
}

// The width of a clip in pixels is the zoom, which is what makes it the only honest way to read one:
// the state is private and the pixel is what somebody sees.
function clipWidth(): number {
  const style = clipElements()[0]?.style.width ?? "0px";
  return Number.parseFloat(style);
}

describe("the keys a timeline answers", () => {
  beforeEach(() => {
    seen.selection = [];
    stubViewport();
  });
  afterEach(restoreViewport);

  it("cuts at the playhead", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} startAt={SECOND} />);

    press("s");

    expect(starts(doc.state)).toEqual([0, 1]);
  });

  // A key that only worked on a selection would be the one people press first and report as broken;
  // one that ignored a selection would cut clips somebody had deliberately left out.
  it("cuts only the selection where there is one", async () => {
    const doc = await documentWithClips(1);
    doc.dispatch(cmd.trackAdd("video", "V2"));
    const second = doc.state.timeline.tracks[1]!.id;
    doc.dispatch(
      cmd.clipAdd(
        second,
        { kind: "generator", generator: { type: "solid", color: "#00ff00" } },
        0,
        CLIP_SECONDS * SECOND,
      ),
    );
    render(<Harness doc={doc} startAt={SECOND} />);
    fireEvent.pointerDown(clipElements()[0]!, { pointerId: 1, pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(clipElements()[0]!, { pointerId: 1, pointerType: "mouse", button: 0 });

    press("s");

    expect(doc.state.timeline.tracks.map((track) => track.clips.length).sort()).toEqual([1, 2]);
  });

  it("leaves a locked track alone", async () => {
    const doc = await documentWithClips(1);
    const track = doc.state.timeline.tracks[0]!.id;
    doc.dispatch(cmd.trackSetFlags(track, null, null, true, null));
    render(<Harness doc={doc} startAt={SECOND} />);

    press("s");

    expect(starts(doc.state)).toEqual([0]);
  });

  // A cut at an edge is a clip of no length on one side, which the core refuses -- and a refusal out
  // of a key somebody pressed once is an error banner for a keystroke that meant nothing.
  it("does not cut at an edge", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} startAt={CLIP_SECONDS * SECOND} />);

    expect(() => press("s")).not.toThrow();

    expect(starts(doc.state)).toEqual([0, 2]);
  });

  // An undo can take the clip a selected id names away. Every action then reads "there is a
  // selection", finds nothing in it, and does nothing -- which is how a key that works looks broken.
  it("forgets a selected clip that is no longer there", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} startAt={3 * SECOND} />);
    fireEvent.pointerDown(clipElements()[0]!, { pointerId: 1, pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(clipElements()[0]!, { pointerId: 1, pointerType: "mouse", button: 0 });
    expect(seen.selection.length).toBe(1);

    act(() => {
      doc.dispatch(cmd.clipRemove(doc.state.timeline.tracks[0]!.clips[0]!.id));
    });

    expect(seen.selection).toEqual([]);
    // And the second clip, which nobody selected, is cut by the key that would otherwise have found
    // a selection holding one dead id.
    press("s");
    expect(starts(doc.state)).toEqual([2, 3]);
  });

  it("duplicates a clip directly behind the original", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    press("a", { ctrlKey: true });

    press("d", { ctrlKey: true });

    expect(starts(doc.state)).toEqual([0, 2]);
  });

  it("selects every clip there is", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} />);

    press("a", { ctrlKey: true });

    expect(seen.selection.length).toBe(3);
  });

  it("zooms in and out, and fits the whole edit in the window", async () => {
    const doc = await documentWithClips(4);
    render(<Harness doc={doc} />);
    const rest = clipWidth();

    press("+");
    const closer = clipWidth();
    press("-");
    press("-");
    const further = clipWidth();

    expect(closer).toBeGreaterThan(rest);
    expect(further).toBeLessThan(rest);

    // Eight seconds of edit in a 900 px window: every clip fits, and the last one ends inside it.
    press("0");
    expect(clipWidth() * 4).toBeLessThanOrEqual(900);
    expect(clipWidth() * 4).toBeGreaterThan(600);
  });

  it("jumps to the start and to the end of the edit", async () => {
    const doc = await documentWithClips(3);
    render(<Harness doc={doc} startAt={SECOND} />);

    press("End");
    expect(seen.playhead).toBe(6 * SECOND);

    press("Home");
    expect(seen.playhead).toBe(0);
  });

  // Every one of these keys is unmodified, so a field with the focus has to keep them: typing an "s"
  // into a title must not cut the clip under the playhead.
  it("does not take a key out of a field", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} startAt={SECOND} />);
    const field = document.createElement("input");
    surface().append(field);

    fireEvent.keyDown(field, { key: "s" });

    expect(starts(doc.state)).toEqual([0]);
  });
});

describe("a running transport and the view", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("pages ahead to keep the playhead on screen", async () => {
    const doc = await documentWithClips(20);
    const scroll = stubViewport();
    const { rerender } = render(<Harness doc={doc} at={0} playing />);
    expect(scroll.scrollLeft).toBe(0);

    // Twenty seconds in, at a hundred pixels a second, is well past a 900 px window.
    rerender(<Harness doc={doc} at={20 * SECOND} playing />);

    expect(scroll.scrollLeft).toBeGreaterThan(0);
    expect(scroll.scrollLeft).toBeLessThanOrEqual(20 * 100);
  });

  it("stays where it was put while the transport stands still", async () => {
    const doc = await documentWithClips(20);
    const scroll = stubViewport();
    const { rerender } = render(<Harness doc={doc} at={0} />);
    scroll.scrollLeft = 40;

    rerender(<Harness doc={doc} at={20 * SECOND} />);

    expect(scroll.scrollLeft).toBe(40);
  });
});

// jsdom lays nothing out, so a gesture measured in pixels needs the boxes handed to it. What is being
// checked is the arithmetic from a rectangle to a set of clips; that the rectangle is where the
// pointer went is the browser harness's claim.
function stubBoxes(): void {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      // The tracks area and the scroll surface both start at the origin; every track is 72 px tall
      // and the two of them are what a band is measured against.
      const height = this.classList.contains("v-timeline__tracks") ? 144 : 400;
      return { left: 0, top: 0, right: 900, bottom: height, width: 900, height } as DOMRect;
    },
  });
}

function restoreBoxes(): void {
  Reflect.deleteProperty(HTMLElement.prototype, "getBoundingClientRect");
}

function bandOver(fromX: number, fromY: number, toX: number, toY: number): void {
  const surface = document.querySelector<HTMLElement>(".v-timeline__tracks") ?? surfaceOf();
  fireEvent.pointerDown(surface, { pointerId: 1, pointerType: "mouse", button: 0, clientX: fromX, clientY: fromY });
  fireEvent.pointerMove(surfaceOf(), { pointerId: 1, pointerType: "mouse", clientX: toX, clientY: toY });
  fireEvent.pointerUp(surfaceOf(), { pointerId: 1, pointerType: "mouse", clientX: toX, clientY: toY });
}

function surfaceOf(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".v-timeline__scroll");
  if (element === null) throw new Error("timeline surface missing");
  return element;
}

describe("a rubber band over empty timeline", () => {
  beforeEach(() => {
    seen.selection = [];
    stubViewport();
    stubBoxes();
  });
  afterEach(() => {
    restoreBoxes();
    restoreViewport();
  });

  it("selects every clip it touches", async () => {
    const doc = await documentWithClips(4);
    render(<Harness doc={doc} />);

    // A hundred pixels a second: from three seconds to seven covers the second and third clip and
    // touches the fourth's head at six seconds.
    bandOver(300, 10, 700, 60);

    expect(seen.selection.length).toBe(3);
  });

  // Touching, not swallowing: a band that only took clips it contained whole would be useless on a
  // clip wider than the window, which is most of them at a working zoom.
  it("takes a clip it only reaches into", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    // A band wholly inside the first clip, from 1.5 s to 1.9 s: it swallows nothing and still takes
    // the clip it is inside.
    bandOver(150, 10, 190, 60);

    expect(seen.selection.length).toBe(1);
  });

  // Two rows, and a band in one of them. Without the row test a band anywhere would take every clip
  // whose time it happened to cross, on tracks nobody was pointing at.
  it("takes only the rows it crosses", async () => {
    const doc = await documentWithClips(2);
    doc.dispatch(cmd.trackAdd("video", "V2"));
    const upper = doc.state.timeline.tracks[1]!.id;
    doc.dispatch(
      cmd.clipAdd(
        upper,
        { kind: "generator", generator: { type: "solid", color: "#00ff00" } },
        0,
        CLIP_SECONDS * SECOND,
      ),
    );
    render(<Harness doc={doc} />);

    // Rows are 72 px and drawn top first, so the lower half of the area is tracks[0].
    bandOver(20, 80, 120, 140);
    const lower = seen.selection;
    expect(lower.length).toBe(1);

    bandOver(20, 4, 120, 60);
    expect(seen.selection.length).toBe(1);
    expect(seen.selection[0]).not.toBe(lower[0]);

    // And a band across both rows takes both. Dragged upwards, so the row the press landed on is the
    // *lower* index of the two: rows are drawn top first while tracks[0] is the bottom one, and a
    // range that trusted the press to be the first row would come out empty half the time.
    bandOver(20, 130, 120, 10);
    expect(seen.selection.length).toBe(2);
  });

  // A band dragged out and then back to where it started is a band that covers nothing, and the
  // selection has to follow it back rather than keeping what it briefly held.
  it("gives back what it takes when it is dragged shut again", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);
    const surface = surfaceOf();

    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: "mouse", clientX: 320, clientY: 60 });
    expect(seen.selection.length).toBe(2);

    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: "mouse", clientX: 21, clientY: 11 });
    expect(seen.selection).toEqual([]);
    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: "mouse", clientX: 21, clientY: 11 });
  });

  it("takes nothing where it crosses no clip", async () => {
    const doc = await documentWithClips(1);
    render(<Harness doc={doc} />);
    press("a", { ctrlKey: true });
    expect(seen.selection.length).toBe(1);

    bandOver(600, 10, 800, 60);

    expect(seen.selection).toEqual([]);
  });

  // A press that trembles is a click, and a click on empty timeline clears the selection rather than
  // opening a band nobody dragged.
  it("is not opened by a press that barely moved", async () => {
    const doc = await documentWithClips(2);
    render(<Harness doc={doc} />);

    bandOver(300, 20, 302, 21);

    expect(document.querySelector('[data-testid="timeline-marquee"]')).toBeNull();
    expect(seen.selection).toEqual([]);
  });
});
