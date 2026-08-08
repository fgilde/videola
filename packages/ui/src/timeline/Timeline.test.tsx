import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FLICKS_PER_SECOND, type Clip, type Project, type Track } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { Timeline } from "./Timeline";

const VIEWPORT_WIDTH = 900;

export function makeProject(tracks: Track[] = [], library: Project["library"] = []): Project {
  return {
    schemaVersion: 1,
    meta: { id: "prj_1", title: "", tags: [] },
    settings: {
      width: 1920,
      height: 1080,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: 48000,
      colorSpace: "srgb",
      background: "#000000",
    },
    library,
    timeline: { tracks },
    markers: [],
    master: { volume: 1, effects: [] },
  } as unknown as Project;
}

export function makeTrack(id: string, clips: Clip[] = [], overrides: Partial<Track> = {}): Track {
  return {
    id,
    kind: "video",
    name: id,
    colorHex: "#5b8cff",
    height: 72,
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    clips,
    effects: [],
    ...overrides,
  } as unknown as Track;
}

export function makeClip(id: string, start: number, duration: number, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    source: { kind: "generator", generator: { type: "solid", color: "#000000" } },
    start,
    duration,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {},
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
    ...overrides,
  } as unknown as Clip;
}

// jsdom does no layout, so both of these read 0 forever and the visible window would always be
// empty - which would make every virtualisation assertion below pass without proving anything.
export function stubViewport(width = VIEWPORT_WIDTH): { scrollLeft: number } {
  const scroll = { scrollLeft: 0 };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", {
    configurable: true,
    get: () => scroll.scrollLeft,
    set: (next: number) => {
      scroll.scrollLeft = next;
    },
  });
  return scroll;
}

export function restoreViewport(): void {
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollLeft");
}

export function renderTimeline(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe("Timeline", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  it("draws tracks[0] at the bottom, matching the order the compositor blends in", () => {
    const project = makeProject([makeTrack("trk_bottom"), makeTrack("trk_top")]);
    renderTimeline(<Timeline project={project} playhead={0} dispatch={() => {}} onSeek={() => {}} />);

    const rows = [...document.querySelectorAll<HTMLElement>("[data-track-index]")];
    expect(rows.map((row) => row.dataset.trackIndex)).toEqual(["1", "0"]);
  });

  it("labels a clip with its media name when the clip carries none", () => {
    const clip = makeClip("clp_1", 0, FLICKS_PER_SECOND, {
      source: { kind: "media", media: "med_a" },
    } as Partial<Clip>);
    const project = makeProject(
      [makeTrack("trk_1", [clip])],
      [{ id: "med_a", originalName: "beach.mp4" }] as Project["library"],
    );
    renderTimeline(<Timeline project={project} playhead={0} dispatch={() => {}} onSeek={() => {}} />);

    expect(screen.getByText("beach.mp4")).toBeTruthy();
  });

  it("falls back to a catalogue string, never to a raw identifier", () => {
    const clip = makeClip("clp_1", 0, FLICKS_PER_SECOND, {
      source: { kind: "media", media: "med_gone" },
    } as Partial<Clip>);
    renderTimeline(<Timeline project={makeProject([makeTrack("trk_1", [clip])])} playhead={0} dispatch={() => {}} onSeek={() => {}} />);

    expect(screen.getByText("Ohne Namen")).toBeTruthy();
  });

  it("places the playhead at its pixel position", () => {
    const project = makeProject([makeTrack("trk_1")]);
    renderTimeline(<Timeline project={project} playhead={2 * FLICKS_PER_SECOND} dispatch={() => {}} onSeek={() => {}} />);

    // The default zoom is 100 px per second.
    expect(screen.getByTestId("timeline-playhead").style.left).toBe("200px");
  });

  it("writes the ruler in timecode of the project frame rate", () => {
    renderTimeline(<Timeline project={makeProject([makeTrack("trk_1")])} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    expect(screen.getByText("00:00:01.00")).toBeTruthy();
  });

  it("halves the flicks per pixel when zooming in, so a clip draws twice as wide", () => {
    const clip = makeClip("clp_1", 0, FLICKS_PER_SECOND);
    renderTimeline(<Timeline project={makeProject([makeTrack("trk_1", [clip])])} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    const width = () => document.querySelector<HTMLElement>("[data-clip-id]")?.style.width;

    expect(width()).toBe("100px");
    act(() => screen.getByRole("button", { name: "Vergrößern" }).click());
    expect(width()).toBe("200px");
    act(() => screen.getByRole("button", { name: "Verkleinern" }).click());
    expect(width()).toBe("100px");
  });

  // Without the anchor the timeline jumps away from whatever the user was pointing at, which
  // makes zooming into a specific edit unusable.
  it("keeps the time under the zoom anchor where it was", () => {
    const scroll = stubViewport();
    const clip = makeClip("clp_1", 0, 60 * FLICKS_PER_SECOND);
    renderTimeline(<Timeline project={makeProject([makeTrack("trk_1", [clip])])} playhead={0} dispatch={() => {}} onSeek={() => {}} />);

    // The anchor is the viewport centre, 450 px in, at 100 px per second: 4.5 s.
    act(() => screen.getByRole("button", { name: "Vergrößern" }).click());

    expect(scroll.scrollLeft).toBe(450);
    expect(screen.getByTestId("timeline-playhead").style.left).toBe("0px");
  });

  // A wheel delivers ten notches into one task and a finger drums faster than React re-renders.
  // Reading the zoom from state made all but the first step of a burst a no-op.
  it("compounds a burst of zoom steps that lands in a single task", () => {
    const clip = makeClip("clp_1", 0, 60 * FLICKS_PER_SECOND);
    renderTimeline(<Timeline project={makeProject([makeTrack("trk_1", [clip])])} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    const width = () => Number.parseFloat(document.querySelector<HTMLElement>("[data-clip-id]")?.style.width ?? "0");
    const before = width();

    const scroll = stubViewport();
    act(() => {
      const button = screen.getByRole("button", { name: "Vergrößern" });
      for (let step = 0; step < 4; step += 1) button.click();
    });

    expect(width()).toBe(before * 16);
    // The anchor belongs to the first step of the burst: 4.5 s sat under the viewport centre,
    // and sixteen times in it must still be there. Only the first call sees a scroll offset the
    // layout effect has not already invalidated.
    expect(scroll.scrollLeft).toBe(4.5 * 1600 - 450);
  });

  // Asserting the width against MAX_ELEMENT_WIDTH_PX would only restate the definition of the
  // floor. What is worth knowing is that the floor is reached and then holds: further clicks
  // stop changing anything instead of creeping past it one step at a time.
  it("comes to rest at the zoom floor instead of creeping past it", () => {
    const clip = makeClip("clp_1", 0, 24 * 3600 * FLICKS_PER_SECOND);
    const { container } = renderTimeline(
      <Timeline project={makeProject([makeTrack("trk_1", [clip])])} playhead={0} dispatch={() => {}} onSeek={() => {}} />,
    );
    const width = () =>
      Number.parseFloat(container.querySelector<HTMLElement>(".v-timeline__content")?.style.width ?? "0");

    for (let step = 0; step < 40; step += 1) {
      act(() => screen.getByRole("button", { name: "Vergrößern" }).click());
    }
    const settled = width();
    act(() => screen.getByRole("button", { name: "Vergrößern" }).click());

    expect(width()).toBe(settled);
    expect(settled).toBeGreaterThan(VIEWPORT_WIDTH);
  });

  it("shows the empty hint when the project has no tracks", () => {
    renderTimeline(<Timeline project={makeProject()} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    expect(screen.getByText(/Noch keine Spuren/)).toBeTruthy();
  });
});

describe("Timeline virtualisation", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  // One hour of one-second clips. Without virtualisation this is 3600 clip nodes plus a ruler
  // tick every second; the DOM node count is the only thing that proves the window is real.
  function hourLongProject(): Project {
    const clips = Array.from({ length: 3600 }, (_, index) =>
      makeClip(`clp_${index}`, index * FLICKS_PER_SECOND, FLICKS_PER_SECOND),
    );
    return makeProject([makeTrack("trk_1", clips)]);
  }

  it("renders only the clips inside the visible window", () => {
    const project = hourLongProject();
    expect(project.timeline.tracks[0]?.clips).toHaveLength(3600);

    renderTimeline(<Timeline project={project} playhead={0} dispatch={() => {}} onSeek={() => {}} />);

    const drawn = document.querySelectorAll("[data-clip-id]").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(40);
  });

  it("keeps the ruler windowed too", () => {
    renderTimeline(<Timeline project={hourLongProject()} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    expect(document.querySelectorAll("[data-tick]").length).toBeLessThan(40);
  });

  it("keeps the whole timeline subtree small enough to be a real DOM", () => {
    renderTimeline(<Timeline project={hourLongProject()} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    expect(screen.getByTestId("timeline").querySelectorAll("*").length).toBeLessThan(200);
  });

  // The window is measured in time, so zooming out widens it until it holds everything.
  // Measuring only at the default zoom measures the one place where the material is sparse.
  it("keeps the node count bounded at every zoom step, not just the default one", () => {
    renderTimeline(<Timeline project={hourLongProject()} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    const timeline = screen.getByTestId("timeline");
    const counts: number[] = [];

    for (let step = 0; step < 22; step += 1) {
      counts.push(timeline.querySelectorAll("*").length);
      act(() => screen.getByRole("button", { name: "Verkleinern" }).click());
    }

    expect(Math.max(...counts)).toBeLessThan(400);
    expect(document.querySelectorAll("[data-clip-id]").length).toBeGreaterThan(0);
  });

  it("stands in for a run of clips too narrow to tell apart", () => {
    renderTimeline(<Timeline project={hourLongProject()} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    for (let step = 0; step < 10; step += 1) {
      act(() => screen.getByRole("button", { name: "Verkleinern" }).click());
    }

    const runs = [...document.querySelectorAll<HTMLElement>("[data-clip-run]")];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.reduce((sum, run) => sum + Number(run.dataset.clipRun), 0)).toBeGreaterThan(1000);
    // A run is not a clip: nothing on it pretends to be trimmable.
    expect(document.querySelectorAll("[data-clip-run] [data-edge]")).toHaveLength(0);
  });

  it("still reserves scroll width for the whole hour", () => {
    const { container } = renderTimeline(<Timeline project={hourLongProject()} playhead={0} dispatch={() => {}} onSeek={() => {}} />);
    const content = container.querySelector<HTMLElement>(".v-timeline__content");
    expect(Number.parseFloat(content?.style.width ?? "0")).toBeGreaterThan(360_000);
  });
});

// The strip was left out of M1 on purpose: it did not exist, so the surface did not promise it.
// Now that it does, absent peaks still have to mean no strip rather than an empty one.
describe("Timeline waveforms", () => {
  beforeEach(() => stubViewport());
  afterEach(restoreViewport);

  const peaks = { min: Float32Array.from([-1, -0.5]), max: Float32Array.from([1, 0.5]) };

  it("draws the strip of a clip it was given peaks for", () => {
    const project = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, FLICKS_PER_SECOND)])]);
    renderTimeline(
      <Timeline
        project={project}
        playhead={0}
        waveforms={new Map([["clp_1", peaks]])}
        dispatch={() => {}}
        onSeek={() => {}}
      />,
    );

    const strip = screen.getByTestId("clip-waveform");
    expect(strip.getAttribute("d")).toBeNull();
    expect(strip.querySelector("path")?.getAttribute("d")).toBe("M0 0L1 0.5L1 1.5L0 2Z");
    // Stretched by the viewBox, so the path outlives every zoom step unrebuilt.
    expect(strip.getAttribute("viewBox")).toBe("0 0 2 2");
    expect(strip.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("draws no strip for a clip whose audio has not been read", () => {
    const project = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, FLICKS_PER_SECOND)])]);
    renderTimeline(
      <Timeline project={project} playhead={0} dispatch={() => {}} onSeek={() => {}} />,
    );

    expect(screen.queryByTestId("clip-waveform")).toBeNull();
  });

  // A run of clips too narrow to draw separately has no single signal to show, and the peaks of
  // whichever clip happens to lead it would be a lie about the rest.
  it("draws no strip on a collapsed run of clips", () => {
    const clips = Array.from({ length: 40 }, (_, i) =>
      makeClip(`clp_${i}`, i * (FLICKS_PER_SECOND / 100), FLICKS_PER_SECOND / 100),
    );
    const project = makeProject([makeTrack("trk_1", clips)]);
    renderTimeline(
      <Timeline
        project={project}
        playhead={0}
        waveforms={new Map(clips.map((clip) => [clip.id, peaks]))}
        dispatch={() => {}}
        onSeek={() => {}}
      />,
    );

    const runs = document.querySelectorAll("[data-clip-run]");
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) expect(run.querySelector("[data-testid=clip-waveform]")).toBeNull();
  });

  // The gestures read the clip element and its trim zones. An SVG that took pointer events would
  // become the target and every drag on a clip with sound would miss.
  it("keeps the strip out of the way of the pointer", () => {
    const project = makeProject([makeTrack("trk_1", [makeClip("clp_1", 0, FLICKS_PER_SECOND)])]);
    renderTimeline(
      <Timeline
        project={project}
        playhead={0}
        waveforms={new Map([["clp_1", peaks]])}
        dispatch={() => {}}
        onSeek={() => {}}
      />,
    );

    expect(screen.getByTestId("clip-waveform").getAttribute("aria-hidden")).toBe("true");
  });
});
