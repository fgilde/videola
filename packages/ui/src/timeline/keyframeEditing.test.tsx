import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fireEvent, render, screen } from "@testing-library/react";
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

async function sceneWithKeyframes(times: number[] = [1, 3]): Promise<Scene> {
  const doc = new VideolaDocument(await createWasmBackend());
  doc.dispatch(cmd.trackAdd("video", "V1"));
  const track = doc.state.timeline.tracks[0]?.id ?? "";
  doc.dispatch(
    cmd.clipAdd(
      track,
      { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
      0,
      10 * SECOND,
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

  // The one claim the lane exists to make. A keyframe at two seconds has to be drawn where the
  // ruler puts two seconds, from the same conversion -- not from a second axis of its own.
  it("draws a keyframe at the pixel the timeline puts its time at", async () => {
    const { doc } = await sceneWithKeyframes([1, 3]);
    render(<Harness doc={doc} />);
    down(clipElement(), { clientX: 100 });

    expect(keys().map((key) => key.style.left)).toEqual([
      `${(1 * SECOND) / DEFAULT_FLICKS_PER_PIXEL}px`,
      `${(3 * SECOND) / DEFAULT_FLICKS_PER_PIXEL}px`,
    ]);
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
