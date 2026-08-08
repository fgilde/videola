import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Command, Effect, EffectParamSnapshot, Project, Track } from "@videola/core";

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

// The two the engine actually builds a node for, written the way `AudioEffectManifest` hands them
// over. Structural, not imported: @videola/ui does not depend on the engine, and the compiler proves
// the two shapes agree at the point where App wires them together.
const OFFERED = [
  {
    id: "eq",
    name: { de: "Equalizer", en: "Equaliser" },
    params: [
      {
        key: "frequency",
        name: { de: "Frequenz", en: "Frequency" },
        default: 1000,
        min: 20,
        max: 20000,
      },
      { key: "gain", name: { de: "Anhebung", en: "Gain" }, default: 0, min: -24, max: 24 },
    ],
  },
  {
    id: "limiter",
    name: { de: "Limiter", en: "Limiter" },
    params: [
      { key: "threshold", name: { de: "Schwelle", en: "Threshold" }, default: -6, min: -40, max: 0 },
    ],
  },
] as const;

function authored(effectType: string, over: Record<string, unknown> = {}): Effect {
  return {
    id: `eff_${effectType}`,
    effectType,
    enabled: true,
    params: {},
    keyframes: {},
    ...over,
  } as unknown as Effect;
}

const withEffects = (effects: Effect[]): Track => audio("trk_1", { effects });

const stripOf = (id: string): HTMLElement =>
  document.querySelector<HTMLElement>(`[data-track-id="${id}"]`)!;

/** The effect types one strip is holding out, in the order it lists them. */
const offeredIn = (strip: HTMLElement): string[] => {
  const picker = within(strip).queryByLabelText("Effekt hinzufügen") as HTMLSelectElement | null;
  return picker === null
    ? []
    : [...picker.options].map((option) => option.value).filter((value) => value !== "");
};

const pick = (strip: HTMLElement, effectType: string): void => {
  fireEvent.change(within(strip).getByLabelText("Effekt hinzufügen"), {
    target: { value: effectType },
  });
};

function masterOf(project: Project, effects: Effect[]): Project {
  return { ...project, master: { volume: project.master.volume, effects } } as Project;
}

// The number printed beside a slider, which is what a reader reads. The slider's own `value` is the
// platform's opinion of what fits between its min and max, and asking it proves nothing about ours.
const readoutFor = (label: string): string =>
  screen.getByLabelText(label).parentElement!.querySelector(".v-param__value")!.textContent!;

const snapshot = (entries: Record<string, Record<string, number>>): EffectParamSnapshot =>
  new Map(
    Object.entries(entries).map(([id, params]) => [
      id,
      new Map(Object.entries(params).map(([key, value]) => [key, { kind: "float", value }])),
    ]),
  ) as EffectParamSnapshot;

describe("Mixer master strip", () => {
  // The strips are keyed off tracks, so a master built as one more of them would turn up wherever
  // the mixer counts tracks -- and its fader would aim a track command at a track that is not there.
  it("stands apart from the track strips", () => {
    show(<Mixer project={makeProject([audio("trk_1")])} dispatch={() => {}} />);

    expect(screen.getByTestId("mixer-master")).toBeDefined();
    expect([...document.querySelectorAll("[data-track-id]")]).toHaveLength(1);
  });

  it("sends the fader's value as the project's master volume", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1")])} dispatch={dispatch} />);

    fireEvent.change(screen.getByLabelText("Lautstärke Master"), { target: { value: "0.5" } });

    expect(dispatch).toHaveBeenCalledWith(
      { type: "project.setMasterVolume", volume: 0.5 },
      undefined,
    );
  });

  it("shows the volume the project holds rather than a fixed one", () => {
    const project = makeProject([audio("trk_1")]);
    show(
      <Mixer
        project={{ ...project, master: { volume: 0.25, effects: [] } } as unknown as Project}
        dispatch={() => {}}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Lautstärke Master").value).toBe("0.25");
  });
});

describe("Mixer effect chains", () => {
  it("offers every effect the engine can build, on a track and on the master", () => {
    show(<Mixer project={makeProject([audio("trk_1")])} effects={OFFERED} dispatch={() => {}} />);

    expect(offeredIn(stripOf("trk_1"))).toEqual(["eq", "limiter"]);
    expect(offeredIn(screen.getByTestId("mixer-master"))).toEqual(["eq", "limiter"]);
  });

  it("aims the picker at the chain it was used on", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(<Mixer project={makeProject([audio("trk_1")])} effects={OFFERED} dispatch={dispatch} />);

    pick(screen.getByTestId("mixer-master"), "limiter");
    expect(dispatch).toHaveBeenCalledWith(
      { type: "effect.add", target: { kind: "project" }, effectType: "limiter" },
    );

    pick(stripOf("trk_1"), "eq");
    expect(dispatch).toHaveBeenCalledWith(
      { type: "effect.add", target: { kind: "track", track: "trk_1" }, effectType: "eq" },
    );
  });

  // Offering the same effect twice sends a second `effect.add`, which the core answers by pointing
  // both sets of sliders at the one chain entry there is.
  it("stops offering an effect the chain already carries", () => {
    show(
      <Mixer
        project={makeProject([withEffects([authored("eq")])])}
        effects={OFFERED}
        dispatch={() => {}}
      />,
    );

    expect(offeredIn(stripOf("trk_1"))).toEqual(["limiter"]);
    // The master has not gained one, so the offer is gone from that chain and no other.
    expect(offeredIn(screen.getByTestId("mixer-master"))).toEqual(["eq", "limiter"]);
  });

  it("moves a parameter with a command aimed at the same chain", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(
      <Mixer
        project={makeProject([withEffects([authored("eq")])])}
        effects={OFFERED}
        dispatch={dispatch}
      />,
    );

    fireEvent.change(screen.getByLabelText("Frequenz"), { target: { value: "440" } });

    expect(dispatch).toHaveBeenCalledWith(
      {
        type: "effect.setParam",
        target: { kind: "track", track: "trk_1" },
        effectType: "eq",
        key: "frequency",
        value: { kind: "float", value: 440 },
      },
      undefined,
    );
  });

  it("moves a master parameter with a command aimed at the project", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(
      <Mixer
        project={masterOf(makeProject([audio("trk_1")]), [authored("limiter")])}
        effects={OFFERED}
        dispatch={dispatch}
      />,
    );

    fireEvent.change(screen.getByLabelText("Schwelle"), { target: { value: "-12" } });

    expect(dispatch).toHaveBeenCalledWith(
      {
        type: "effect.setParam",
        target: { kind: "project" },
        effectType: "limiter",
        key: "threshold",
        value: { kind: "float", value: -12 },
      },
      undefined,
    );
  });

  // The core resolves; the row reports. A slider reading the value at rest would show 9000 while a
  // keyframed filter sat at 400, which is a lie about the one thing the row exists for.
  it("shows the value the core resolved at the playhead, not the one at rest", () => {
    show(
      <Mixer
        project={makeProject([
          withEffects([authored("eq", { params: { frequency: { kind: "float", value: 9000 } } })]),
        ])}
        effects={OFFERED}
        playhead={5}
        effectParamsAt={() => snapshot({ eff_eq: { frequency: 400 } })}
        dispatch={() => {}}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Frequenz").value).toBe("400");
  });

  // Read off the readout and not off the slider. A range input clamps its own `value` to its own
  // `max`, so asking the input what it holds asks the platform, not this code -- and the number
  // beside it, which is the one anybody reads, would go on saying 99 while the filter ran at 24.
  it("shows a stored value past the declared range clamped to it", () => {
    show(
      <Mixer
        project={makeProject([withEffects([authored("eq")])])}
        effects={OFFERED}
        effectParamsAt={() => snapshot({ eff_eq: { gain: 99 } })}
        dispatch={() => {}}
      />,
    );

    expect(readoutFor("Anhebung")).toBe("24");
  });

  // Nothing clamps this one for us: a `ParamValue` of another kind reaches a range input as NaN,
  // which empties the slider and prints nothing at all where a number belongs.
  it("falls back to the default for a stored value that is not a number", () => {
    const odd = new Map([
      ["eff_eq", new Map([["frequency", { kind: "bool", value: true }]])],
    ]) as unknown as EffectParamSnapshot;
    show(
      <Mixer
        project={makeProject([withEffects([authored("eq")])])}
        effects={OFFERED}
        effectParamsAt={() => odd}
        dispatch={() => {}}
      />,
    );

    expect(readoutFor("Frequenz")).toBe("1.000");
    expect(screen.getByLabelText<HTMLInputElement>("Frequenz").value).toBe("1000");
  });

  it("gives no row to an effect type this build cannot make a sound with", () => {
    show(
      <Mixer
        project={makeProject([withEffects([authored("brightness")])])}
        effects={OFFERED}
        dispatch={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Frequenz")).toBeNull();
  });
});

describe("Mixer effect keyframes", () => {
  const held = (): Effect =>
    authored("eq", {
      keyframes: {
        frequency: [{ time: 400, value: { kind: "float", value: 800 }, interp: "hold" }],
      },
    });

  // A bus has no clip window to fall outside of, so unlike a clip's row this one is settable
  // wherever the playhead stands -- which is what `effectParamsAt` already says by answering for
  // track and master chains at every moment there is.
  it("writes a keyframe wherever the playhead stands", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(
      <Mixer
        project={masterOf(makeProject([audio("trk_1")]), [authored("limiter")])}
        effects={OFFERED}
        playhead={9_000}
        dispatch={dispatch}
        onSeek={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Keyframe für Schwelle am Playhead"));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "keyframe.add",
        target: { kind: "project" },
        effectType: "limiter",
        key: "threshold",
        time: 9_000,
      }),
    );
  });

  // A slider dragged across a keyframed parameter upserts the key it is standing on, and must not
  // turn a hold into a ramp on the way past.
  it("keeps a held keyframe held when the slider moves over it", () => {
    const dispatch = vi.fn<(command: Command, key?: string) => void>();
    show(
      <Mixer
        project={makeProject([withEffects([held()])])}
        effects={OFFERED}
        playhead={400}
        dispatch={dispatch}
        onSeek={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Frequenz"), { target: { value: "500" } });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "keyframe.add", key: "frequency", interp: "hold" }),
      undefined,
    );
  });

  // Three arrows with nowhere to seek to are three buttons that do nothing, which is the state this
  // milestone exists to end.
  it("leaves the keyframe controls out where there is nowhere to seek", () => {
    show(
      <Mixer
        project={makeProject([withEffects([authored("eq")])])}
        effects={OFFERED}
        dispatch={() => {}}
      />,
    );

    expect(screen.getByLabelText("Frequenz")).toBeDefined();
    expect(screen.queryByLabelText("Keyframe für Frequenz am Playhead")).toBeNull();
  });
});
