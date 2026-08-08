import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Command } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { makeProject, makeTrack } from "../timeline/Timeline.test";
import { Mixer } from "./Mixer";

function show(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const audio = (id: string, over = {}) =>
  makeTrack(id, [], { kind: "audio", ...over } as Parameters<typeof makeTrack>[2]);

describe("Mixer", () => {
  // The timeline draws tracks[0] at the bottom. A mixer that listed them in the core's order would
  // put the strip of the top track last, and every reach for a fader would go to the wrong one.
  it("orders the strips the way the timeline stacks the tracks", () => {
    show(
      <Mixer project={makeProject([audio("trk_bottom"), audio("trk_top")])} dispatch={() => {}} />,
    );

    const strips = [...document.querySelectorAll<HTMLElement>("[data-track-id]")];
    expect(strips.map((strip) => strip.dataset.trackId)).toEqual(["trk_top", "trk_bottom"]);
  });

  it("sends the fader's value as a track volume", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1")])} dispatch={dispatch} />);

    fireEvent.change(screen.getByLabelText("Lautstärke trk_1"), { target: { value: "1.5" } });

    expect(dispatch).toHaveBeenCalledWith(
      { type: "track.setVolume", track: "trk_1", volume: 1.5 },
      undefined,
    );
  });

  it("sends pan from left through centre to right", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1")])} dispatch={dispatch} />);
    const pan = screen.getByLabelText("Panorama trk_1");

    fireEvent.change(pan, { target: { value: "-1" } });

    expect(dispatch).toHaveBeenCalledWith(
      { type: "track.setPan", track: "trk_1", pan: -1 },
      undefined,
    );
  });

  // One drag is one undo step, the same rule the inspector's rows follow. Without it a fader pulled
  // across its travel leaves one entry in the history per pixel.
  it("coalesces a whole drag into one undo step", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1")])} dispatch={dispatch} />);
    const fader = screen.getByLabelText("Lautstärke trk_1");

    fireEvent.pointerDown(fader);
    fireEvent.change(fader, { target: { value: "1.2" } });
    fireEvent.change(fader, { target: { value: "1.4" } });

    const keys = dispatch.mock.calls.map((call) => call[1]);
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBe(keys[0]);
  });

  it("mints a new undo step for the next drag", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1")])} dispatch={dispatch} />);
    const fader = screen.getByLabelText("Lautstärke trk_1");

    fireEvent.pointerDown(fader);
    fireEvent.change(fader, { target: { value: "1.2" } });
    fireEvent.pointerDown(fader);
    fireEvent.change(fader, { target: { value: "1.4" } });

    const keys = dispatch.mock.calls.map((call) => call[1]);
    expect(keys[1]).not.toBe(keys[0]);
  });

  // Mute beats solo in the graph. Pressing one here must not clear the other, or the mixer would
  // quietly undo a decision the user made on the other button.
  it("toggles mute without touching solo", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1", { solo: true })])} dispatch={dispatch} />);

    fireEvent.click(screen.getByLabelText("Stumm trk_1"));

    expect(dispatch).toHaveBeenCalledWith(
      { type: "track.setFlags", track: "trk_1", muted: true, solo: null, locked: null, hidden: null },
    );
  });

  it("toggles solo without touching mute", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1", { muted: true })])} dispatch={dispatch} />);

    fireEvent.click(screen.getByLabelText("Solo trk_1"));

    expect(dispatch).toHaveBeenCalledWith(
      { type: "track.setFlags", track: "trk_1", muted: null, solo: true, locked: null, hidden: null },
    );
  });

  it("shows the flags the project holds", () => {
    show(
      <Mixer
        project={makeProject([audio("trk_1", { muted: true, solo: false })])}
        dispatch={() => {}}
      />,
    );

    expect(screen.getByLabelText("Stumm trk_1").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Solo trk_1").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Mixer loudness readout", () => {
  it("says nothing has been measured before anything has", () => {
    show(<Mixer project={makeProject([audio("trk_1")])} dispatch={() => {}} />);

    expect(screen.getByTestId("mixer-loudness").textContent).toBe("Nicht gemessen");
  });

  it("shows a reading in LUFS to one decimal", () => {
    show(<Mixer project={makeProject([audio("trk_1")])} loudness={-23.04} dispatch={() => {}} />);

    expect(screen.getByTestId("mixer-loudness").textContent).toBe("-23.0 LUFS");
  });

  // A silent programme measures as -Infinity, and "-Infinity LUFS" on screen reads as a broken
  // readout rather than as silence.
  it("names silence rather than printing negative infinity", () => {
    show(
      <Mixer
        project={makeProject([audio("trk_1")])}
        loudness={Number.NEGATIVE_INFINITY}
        dispatch={() => {}}
      />,
    );

    expect(screen.getByTestId("mixer-loudness").textContent).toBe("Stille");
  });

  it("asks for a measurement once per press", () => {
    const onMeasure = vi.fn();
    show(
      <Mixer project={makeProject([audio("trk_1")])} dispatch={() => {}} onMeasure={onMeasure} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Lautheit messen" }));

    expect(onMeasure).toHaveBeenCalledOnce();
  });

  // Measuring renders the whole timeline. A second press while the first is running would start a
  // second render over the same buffers for a number that is already on its way.
  it("cannot be asked again while it is measuring", () => {
    const onMeasure = vi.fn();
    show(
      <Mixer
        project={makeProject([audio("trk_1")])}
        measuring
        dispatch={() => {}}
        onMeasure={onMeasure}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Messe…" }));

    expect(onMeasure).not.toHaveBeenCalled();
  });
});
