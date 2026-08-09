import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import {
  curveAt,
  FLICKS_PER_SECOND,
  type Clip,
  type Command,
  type EffectParamSnapshot,
  type Interp,
  type ParamValue,
  type Project,
  type Time,
  type Transform,
} from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { makeClip, makeProject, makeTrack } from "../timeline/Timeline.test";
import { Inspector, type EffectDescriptor } from "./Inspector";

const SECOND = FLICKS_PER_SECOND;

const BRIGHTNESS: EffectDescriptor = {
  id: "brightness",
  name: { de: "Helligkeit", en: "Brightness" },
  inputs: 1,
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 4 }],
};

const CROSSFADE: EffectDescriptor = {
  id: "crossfade",
  name: { de: "Überblendung", en: "Cross dissolve" },
  inputs: 2,
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
  ],
};

// Where the first non-float parameter in the library lives. What it proves here is not the dip but
// the kind: a manifest parameter that is not a slider gets a control that is not one.
const DIP: EffectDescriptor = {
  id: "dip",
  name: { de: "Blende über Farbe", en: "Dip to colour" },
  inputs: 2,
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
    { kind: "color", key: "colour", name: { de: "Farbe", en: "Colour" }, default: [0, 0, 0, 1] },
  ],
};

// The second kind that is not a slider, and the first whose size the project file chooses. What it
// proves is what the dip proves one kind further along: a manifest parameter that is a list of
// points gets a field with points in it, not a number between nought and one.
const CURVES: EffectDescriptor = {
  id: "curves",
  name: { de: "Kurven", en: "Curves" },
  inputs: 1,
  params: [
    {
      kind: "curve",
      key: "luma",
      name: { de: "Helligkeit", en: "Brightness" },
      default: [
        [0, 0],
        [1, 1],
      ],
    },
  ],
};

// The third kind that is not a slider, and the first that names a file rather than carrying a
// value. What it proves is that the row offers what the library holds and nothing else.
const LUT: EffectDescriptor = {
  id: "lut",
  name: { de: "Farbtabelle", en: "Lookup table" },
  inputs: 1,
  params: [{ kind: "lut", key: "table", name: { de: "Tabelle", en: "Table" } }],
};

interface Rig {
  sent: { command: Command; key?: string }[];
  seeks: Time[];
  asked: Time[];
  askedTransforms: Time[];
  browsed: (1 | 2)[];
  dispatch: Mock;
}

interface Scene {
  clip?: Clip;
  project?: Project;
  playhead?: Time;
  /** What the core answers for `amount`; the default is a value no static field carries. */
  amountAt?: (at: Time) => number | undefined;
  /** For the kinds `amountAt` cannot express -- a project may carry any `ParamValue` here. */
  rawAmountAt?: (at: Time) => ParamValue;
  /**
   * What the core resolves the clip's placement to. Absent means "nothing is keyframed", which the
   * core answers with the static transform -- so the fake answers the same thing.
   */
  transformAt?: (at: Time) => Record<string, number>;
  /** What this build can draw. The default is the pair the keyframe and transition rows need. */
  effects?: readonly EffectDescriptor[];
  /** The whole resolved batch, for a parameter `amountAt` has no shape for. */
  resolved?: EffectParamSnapshot;
  dispatch?: (command: Command, key?: string) => void;
}

function show(scene: Scene = {}): Rig {
  const clip = scene.clip ?? clipWithMedia();
  const project = scene.project ?? makeProject([makeTrack("trk_1", [clip])], [MEDIA]);
  const rig: Rig = {
    sent: [],
    seeks: [],
    asked: [],
    askedTransforms: [],
    browsed: [],
    dispatch: vi.fn(),
  };
  rig.dispatch.mockImplementation((command: Command, key?: string) => {
    rig.sent.push({ command, key });
    scene.dispatch?.(command, key);
  });

  const effectParamsAt = (at: Time): EffectParamSnapshot => {
    rig.asked.push(at);
    if (scene.resolved !== undefined) return scene.resolved;
    const raw = scene.rawAmountAt?.(at);
    const amount = scene.amountAt?.(at);
    if (raw === undefined && amount === undefined) return new Map();
    const value = raw ?? float(amount ?? 0);
    return new Map([["eff_1", new Map<string, ParamValue>([["amount", value]])]]);
  };

  const transformsAt = (at: Time) => {
    rig.askedTransforms.push(at);
    return new Map([[clip.id, { ...clip.transform, ...scene.transformAt?.(at) } as Transform]]);
  };

  render(
    <I18nProvider>
      <Inspector
        project={project}
        clip={clip.id}
        playhead={scene.playhead ?? 0}
        effects={scene.effects ?? [BRIGHTNESS, CROSSFADE]}
        effectParamsAt={effectParamsAt}
        transformsAt={transformsAt}
        dispatch={rig.dispatch}
        onSeek={(time) => rig.seeks.push(time)}
        onBrowse={(only) => rig.browsed.push(only)}
      />
    </I18nProvider>,
  );
  return rig;
}

const MEDIA = {
  id: "med_1",
  originalName: "clip.mp4",
  mimeType: "video/mp4",
  kind: "video",
  width: 640,
  height: 360,
  duration: 2 * SECOND,
} as unknown as Project["library"][number];

// The generated `Clip` carries serde's flatten catch-all, so a structured override is not
// assignable to `Partial<Clip>` without going through `unknown` -- the same shape the timeline's
// own fixtures already take.
type Overrides = Record<string, unknown>;

function clipWithMedia(overrides: Overrides = {}): Clip {
  return makeClip("clp_1", 0, 2 * SECOND, {
    source: { kind: "media", media: "med_1" },
    transform: identity(),
    ...overrides,
  } as unknown as Partial<Clip>);
}

function withBrightness(keyframes: Record<string, unknown[]> = {}, amount = 1): Overrides {
  return {
    effects: [
      {
        id: "eff_1",
        effectType: "brightness",
        enabled: true,
        params: { amount: float(amount) },
        keyframes,
      },
    ],
  };
}

function withDip(): Overrides {
  return {
    effects: [{ id: "eff_1", effectType: "dip", enabled: true, params: {}, keyframes: {} }],
  };
}

function colourAt(value: unknown): EffectParamSnapshot {
  return new Map([["eff_1", new Map<string, ParamValue>([["colour", value as ParamValue]])]]);
}

function withCurves(keyframes: Record<string, unknown[]> = {}): Overrides {
  return {
    effects: [{ id: "eff_1", effectType: "curves", enabled: true, params: {}, keyframes }],
  };
}

function lumaAt(value: unknown): EffectParamSnapshot {
  return new Map([["eff_1", new Map<string, ParamValue>([["luma", value as ParamValue]])]]);
}

function withLut(): Overrides {
  return {
    effects: [{ id: "eff_1", effectType: "lut", enabled: true, params: {}, keyframes: {} }],
  };
}

function tableAt(value: unknown): EffectParamSnapshot {
  return new Map([["eff_1", new Map<string, ParamValue>([["table", value as ParamValue]])]]);
}

const TABLE = {
  id: "med_swap",
  originalName: "Swap.cube",
  mime: "application/x-cube-lut",
  kind: "lut",
} as unknown as Project["library"][number];

// jsdom lays nothing out, so the field has no rectangle and every pointer position would land on
// the same tone. A hundred by a hundred at the origin makes a client coordinate a percentage.
function measured(): HTMLElement {
  const field = screen.getByRole("group", { name: /Kurve für Helligkeit/ });
  field.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }) as DOMRect;
  return field;
}

function curvePoints(): HTMLButtonElement[] {
  return screen.getAllByRole("button", { name: /Helligkeit, Punkt bei/ }) as HTMLButtonElement[];
}

// One press, one move, one release -- the shape a real drag has, and the only shape that shows
// whether the moves under one grab collapse into one entry on the undo stack.
function dragPoint(point: HTMLElement, steps: [number, number][]): void {
  act(() => void fireEvent.pointerDown(point, { pointerId: 3, clientX: 0, clientY: 100 }));
  for (const [x, y] of steps) {
    act(() => void fireEvent.pointerMove(point, { pointerId: 3, clientX: x, clientY: 100 - y }));
  }
  const last = steps.at(-1) ?? [0, 0];
  act(() =>
    void fireEvent.pointerUp(point, { pointerId: 3, clientX: last[0], clientY: 100 - last[1] }),
  );
}

// Down and up in the same place, which is what tells a tap from a drag -- and the whole difference
// between moving a point and taking it away.
function tapPoint(point: HTMLElement): void {
  act(() => void fireEvent.pointerDown(point, { pointerId: 3, clientX: 50, clientY: 50 }));
  act(() => void fireEvent.pointerUp(point, { pointerId: 3, clientX: 50, clientY: 50 }));
}

function sentCurve(rig: Rig, index = 0): [number, number][] {
  const command = rig.sent[index]!.command as unknown as { value: { value: [number, number][] } };
  return command.value.value;
}

function key(time: Time, value: number, interp: Interp = "linear"): unknown {
  return { time, value: float(value), interp };
}

function float(value: number): ParamValue {
  return { kind: "float", value };
}

function slider(name: string): HTMLInputElement {
  return screen.getByLabelText(name) as HTMLInputElement;
}

function readout(name: string): string | undefined {
  return slider(name).parentElement?.querySelector("output")?.textContent ?? undefined;
}

function press(name: string): void {
  act(() => void screen.getByRole("button", { name }).click());
}

/** The effect types the picker is holding out, or nothing when there is no picker at all. */
function browseButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Effekte durchsuchen" }) as HTMLButtonElement;
}

function slide(input: HTMLInputElement, value: number): void {
  act(() => void fireEvent.change(input, { target: { value: String(value) } }));
}

describe("the inspector", () => {
  it("says what to do instead of showing an empty set of controls", () => {
    render(
      <I18nProvider>
        <Inspector
          project={makeProject()}
          clip={undefined}
          playhead={0}
          effects={[BRIGHTNESS]}
          effectParamsAt={() => new Map()}
          transformsAt={() => new Map()}
          dispatch={vi.fn()}
          onSeek={vi.fn()}
          onBrowse={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(screen.getByText(/Wähle einen Clip/u)).toBeTruthy();
  });

  it("shows the clip's own transform rather than the model's defaults", () => {
    show({
      clip: clipWithMedia({
        transform: {
          x: 120,
          y: -40,
          scaleX: 2,
          scaleY: 0.5,
          rotation: 90,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: 0.25,
          crop: { left: 0, top: 0, right: 0, bottom: 0 },
        },
      }),
    });

    expect(slider("Position X (px)").value).toBe("120");
    expect(slider("Position Y (px)").value).toBe("-40");
    expect(slider("Breite (Faktor)").value).toBe("2");
    expect(slider("Höhe (Faktor)").value).toBe("0.5");
    expect(slider("Drehung (Grad)").value).toBe("90");
    expect(slider("Deckkraft").value).toBe("0.25");
  });

  // The core resolves x and y from a `position` track where one exists and ignores what the
  // transform holds. Two sliders that go on writing it would be settings no picture obeys.
  it("hands the position rows over to a motion path that has one", () => {
    show({ clip: clipWithMedia({ keyframes: { position: [key(0, 0)] } }) });

    expect(slider("Position X (px)").disabled).toBe(true);
    expect(slider("Position Y (px)").disabled).toBe(true);
    // And only those two: the path says nothing about scale, turn or opacity.
    expect(slider("Breite (Faktor)").disabled).toBe(false);
    expect(slider("Deckkraft").disabled).toBe(false);
    expect(screen.getByText("Position X und Y folgen einem Bewegungspfad.")).toBeTruthy();
  });

  it("leaves them alone on a clip with no path", () => {
    show({ clip: clipWithMedia() });

    expect(slider("Position X (px)").disabled).toBe(false);
    expect(screen.queryByText("Position X und Y folgen einem Bewegungspfad.")).toBeNull();
  });

  // "Stell keinen Schalter hin, der nichts bewirkt." A keyframe written on x while a path exists
  // is one the core stores, saves and reloads without it ever reaching a pixel.
  it("offers no keyframe switch on the two rows a path has taken over", () => {
    show({ clip: clipWithMedia({ keyframes: { position: [key(0, 0)] } }) });

    expect(screen.queryByLabelText("Keyframe für Position X (px) am Playhead")).toBeNull();
    expect(screen.queryByLabelText("Keyframe für Position Y (px) am Playhead")).toBeNull();
    // Everything a path says nothing about keeps its switch.
    expect(screen.getByLabelText("Keyframe für Deckkraft am Playhead")).toBeTruthy();
  });

  // The fit writes x, y and both scales. Every one of those that is on the clock is a field the
  // renderer no longer reads, so the button would move numbers nothing is drawn from.
  it("offers no fit while the placement it would write is animated", () => {
    show({ clip: clipWithMedia({ keyframes: { scaleX: [key(0, 1), key(SECOND, 2)] } }) });

    expect((screen.getByRole("button", { name: "Ins Bild einpassen" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  // The row now reads what the core resolves. A keyframed field's static number is the one thing
  // on the screen that is no longer true, and the two have to be told apart by the fixture: the
  // clip holds 0.25, the core answers 0.9.
  it("shows the resolved placement rather than the number the clip holds at rest", () => {
    show({
      clip: clipWithMedia({
        transform: { ...identity(), opacity: 0.25 },
        keyframes: { opacity: [key(0, 0.25), key(2 * SECOND, 1)] },
      }),
      transformAt: () => ({ opacity: 0.9 }),
    });

    // The readout, not `input[type=range].value`: the browser clamps and steps that itself, so it
    // would report a number the row never chose. German decimal comma, because the harness is de.
    expect(readout("Deckkraft")).toBe("0,9");
  });

  it("asks for the placement at the nearest moment the clip covers", () => {
    const rig = show({ playhead: 9 * SECOND });

    // The clip runs 0..2s, so the last moment it covers is one flick short of its end.
    expect(rig.askedTransforms).toContain(2 * SECOND - 1);
  });

  it("marks a row whose parameter is on the clock, wherever the playhead stands", () => {
    show({
      clip: clipWithMedia({ keyframes: { rotation: [key(0, 0), key(SECOND, 90)] } }),
      playhead: 0,
    });

    const animated = screen.getByLabelText("Drehung (Grad)").closest(".v-param");
    expect(animated?.getAttribute("data-animated")).toBe("true");
    expect(animated?.querySelector(".v-param__animated")).toBeTruthy();
    // And a row that is not animated must not carry the mark, or the mark says nothing.
    expect(
      screen.getByLabelText("Deckkraft").closest(".v-param")?.getAttribute("data-animated"),
    ).toBeNull();
  });

  it("sets a transform keyframe on the clip's own track rather than on an effect", () => {
    const rig = show({ playhead: SECOND, transformAt: () => ({ rotation: 33 }) });

    press("Keyframe für Drehung (Grad) am Playhead");

    expect(rig.sent[0]?.command).toMatchObject({
      type: "keyframe.add",
      target: { kind: "clip", clip: "clp_1" },
      effectType: null,
      key: "rotation",
      time: SECOND,
      value: { kind: "float", value: 33 },
    });
  });

  it("writes a keyframe rather than the static transform once the field is animated", () => {
    const rig = show({
      clip: clipWithMedia({ keyframes: { rotation: [key(0, 0, "hold")] } }),
      playhead: 0,
    });

    slide(slider("Drehung (Grad)"), 45);

    // "hold", not "linear": the upsert must not turn a held keyframe into a ramp.
    expect(rig.sent[0]?.command).toMatchObject({
      type: "keyframe.add",
      key: "rotation",
      interp: "hold",
    });
  });

  it("still writes the static transform while nothing on that field is keyframed", () => {
    const rig = show({ clip: clipWithMedia({ keyframes: { opacity: [key(0, 1)] } }) });

    slide(slider("Drehung (Grad)"), 45);

    expect(rig.sent[0]?.command).toMatchObject({ type: "clip.setTransform" });
  });

  it("sends the whole transform with one field replaced", () => {
    const rig = show({
      clip: clipWithMedia({
        transform: {
          x: 5,
          y: 7,
          scaleX: 2,
          scaleY: 3,
          rotation: 10,
          anchorX: 0.25,
          anchorY: 0.75,
          opacity: 0.5,
          crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
        },
      }),
    });

    slide(slider("Deckkraft"), 0.8);

    const command = rig.sent[0]?.command as unknown as { type: string; transform: Record<string, unknown> };
    expect(command.type).toBe("clip.setTransform");
    expect(command.transform.opacity).toBe(0.8);
    // Everything the row did not touch has to survive, including the fields it never shows.
    expect(command.transform.anchorX).toBe(0.25);
    expect(command.transform.crop).toEqual({ left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 });
    expect(command.transform.rotation).toBe(10);
  });

  // 640x360 into 1920x1080 is 3 on both axes, which cannot tell the width ratio from the height
  // ratio apart. A 640x1000 source can: 3 against 1.08.
  it("fits a clip to the frame by the tighter of the two ratios", () => {
    // Pushed off centre first: with x and y already at zero, "the fit recentres" is a statement
    // about the fixture rather than about the fit.
    const moved = clipWithMedia({ transform: { ...identity(), x: 300, y: -200 } });
    const rig = show({
      clip: moved,
      project: makeProject([makeTrack("trk_1", [moved])], [
        { ...MEDIA, width: 640, height: 1000 } as Project["library"][number],
      ]),
    });

    press("Ins Bild einpassen");

    const command = rig.sent[0]?.command as unknown as { transform: Record<string, number> };
    expect(command.transform.scaleX).toBeCloseTo(1.08, 5);
    expect(command.transform.scaleY).toBeCloseTo(1.08, 5);
    expect(command.transform.x).toBe(0);
    expect(command.transform.y).toBe(0);
  });

  it("offers no fit for a clip with no source size", () => {
    show({ clip: makeClip("clp_1", 0, SECOND, { transform: identity() } as unknown as Partial<Clip>) });

    expect(
      (screen.getByRole("button", { name: "Ins Bild einpassen" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps a drag under one coalesce key and starts a new one on the next grab", () => {
    const rig = show();
    const input = slider("Deckkraft");

    act(() => void fireEvent.pointerDown(input));
    slide(input, 0.9);
    slide(input, 0.8);
    slide(input, 0.7);
    act(() => void fireEvent.pointerUp(input));

    const keys = rig.sent.map((entry) => entry.key);
    expect(keys[0]).toBeTypeOf("string");
    expect(new Set(keys)).toEqual(new Set([keys[0]]));

    act(() => void fireEvent.pointerDown(input));
    slide(input, 0.6);
    expect(rig.sent[3]?.key).not.toBe(keys[0]);
  });

  it("leaves the key off a change that is not part of a drag", () => {
    const rig = show();

    slide(slider("Deckkraft"), 0.9);

    expect(rig.sent[0]?.key).toBeUndefined();
  });

  // A pointer released outside the window never reports back, so a later arrow key would
  // otherwise fold into the drag before it.
  it("ends a drag when a key is pressed on the slider", () => {
    const rig = show();
    const input = slider("Deckkraft");

    act(() => void fireEvent.pointerDown(input));
    slide(input, 0.9);
    act(() => void fireEvent.keyDown(input, { key: "ArrowLeft" }));
    slide(input, 0.8);

    expect(rig.sent[0]?.key).toBeTypeOf("string");
    expect(rig.sent[1]?.key).toBeUndefined();
  });

  it("carries the clip's own rate and pitch setting when reverse is switched", () => {
    const rig = show({
      clip: clipWithMedia({
        speed: { rate: 2.5, reverse: false, preservePitch: false },
      }),
    });

    press("Rückwärts");

    expect(rig.sent[0]?.command).toEqual({
      type: "clip.setSpeed",
      clip: "clp_1",
      rate: 2.5,
      reverse: true,
      preservePitch: false,
    });
  });

  it("aligns a chosen transition to the cut and clears it with none", () => {
    const rig = show();
    const select = screen.getByLabelText("Übergang") as HTMLSelectElement;

    act(() => void fireEvent.change(select, { target: { value: "crossfade" } }));

    expect(rig.sent[0]?.command).toEqual({
      type: "clip.setTransition",
      clip: "clp_1",
      transition: {
        transitionType: "crossfade",
        duration: SECOND,
        alignment: "in",
        params: {},
      },
    });
  });

  it("clears a transition with a null rather than a zero length", () => {
    const rig = show({
      clip: clipWithMedia({
        transitionIn: {
          transitionType: "crossfade",
          duration: SECOND,
          alignment: "in",
          params: {},
        },
      }),
    });

    act(() =>
      void fireEvent.change(screen.getByLabelText("Übergang"), { target: { value: "" } }),
    );

    expect(rig.sent[0]?.command).toEqual({
      type: "clip.setTransition",
      clip: "clp_1",
      transition: null,
    });
  });

  it("offers no duration while no transition is set", () => {
    show();

    expect(screen.queryByLabelText("Dauer (Sekunden)")).toBeNull();
  });

  it("shows a set transition's duration in seconds", () => {
    show({
      clip: clipWithMedia({
        transitionIn: {
          transitionType: "crossfade",
          duration: SECOND / 2,
          alignment: "in",
          params: {},
        },
      }),
    });

    expect(slider("Dauer (Sekunden)").value).toBe("0.5");
    expect((screen.getByLabelText("Übergang") as HTMLSelectElement).value).toBe("crossfade");
  });

  // A transition is an effect with two inputs, and the draw list only ever runs a one-input
  // manifest as a clip effect. Offering the other kind would add something nothing draws.
  it("offers only single-input effects as transitions", () => {
    show();

    // An effect with one input is not a transition, and the draw list would never run it as one.
    const select = screen.getByLabelText("Übergang") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(["", "crossfade"]);
  });

  // The two ways into the browser ask it for different shelves, which is what makes the label on
  // each button true rather than decorative.
  it("opens the browser on effects from the effect list and on transitions from the transition row", () => {
    const rig = show();

    act(() => void fireEvent.click(browseButton()));
    act(() => void fireEvent.click(screen.getByRole("button", { name: "Übergänge durchsuchen" })));

    expect(rig.browsed).toEqual([1, 2]);
    // Opening a shelf is not an edit, and nothing about the clip has changed yet.
    expect(rig.sent).toEqual([]);
  });

  it("stops offering effects once the clip carries every one this build has", () => {
    show({ clip: clipWithMedia(withBrightness()) });

    // Brightness is the only single-input offer this rig has, so there is nothing left to browse
    // for. The row below is what says the effect landed rather than the control being forgotten.
    expect(browseButton().disabled).toBe(true);
    expect(screen.getByLabelText("Stärke")).toBeTruthy();
  });

  it("shows the value the core interpolates and not the static one", () => {
    show({
      clip: clipWithMedia(withBrightness({ amount: [key(0, 0), key(2 * SECOND, 1)] }, 9)),
      playhead: SECOND / 2,
      amountAt: (at) => at / (2 * SECOND),
    });

    expect(slider("Stärke").value).toBe("0.25");
  });

  it("sets a keyframe at the playhead with the value the row is showing", () => {
    const rig = show({
      clip: clipWithMedia(withBrightness({}, 2)),
      playhead: SECOND,
      amountAt: () => 2,
    });

    press("Keyframe für Stärke am Playhead");

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.add",
      target: { kind: "clip", clip: "clp_1" },
      effectType: "brightness",
      key: "amount",
      time: SECOND,
      value: float(2),
      interp: "linear",
    });
  });

  it("removes the keyframe that already sits at the playhead", () => {
    const rig = show({
      clip: clipWithMedia(withBrightness({ amount: [key(SECOND, 2)] })),
      playhead: SECOND,
      amountAt: () => 2,
    });
    const toggle = screen.getByRole("button", { name: "Keyframe für Stärke am Playhead" });

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    press("Keyframe für Stärke am Playhead");

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.remove",
      target: { kind: "clip", clip: "clp_1" },
      effectType: "brightness",
      key: "amount",
      time: SECOND,
    });
  });

  it("writes a keyframe rather than the static value once a parameter is keyframed", () => {
    const rig = show({
      clip: clipWithMedia(withBrightness({ amount: [key(0, 0, "hold")] })),
      playhead: 0,
      amountAt: () => 0,
    });

    slide(slider("Stärke"), 3);

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.add",
      target: { kind: "clip", clip: "clp_1" },
      effectType: "brightness",
      key: "amount",
      time: 0,
      value: float(3),
      // The upsert must not quietly turn a held keyframe into a linear one.
      interp: "hold",
    });
  });

  it("writes the static parameter while nothing is keyframed", () => {
    const rig = show({ clip: clipWithMedia(withBrightness()), amountAt: () => 1 });

    slide(slider("Stärke"), 3);

    expect(rig.sent[0]?.command).toEqual({
      type: "effect.setParam",
      target: { kind: "clip", clip: "clp_1" },
      effectType: "brightness",
      key: "amount",
      value: float(3),
    });
  });

  it("switches the interpolation of the keyframe under the playhead", () => {
    const rig = show({
      clip: clipWithMedia(withBrightness({ amount: [key(SECOND, 1)] })),
      playhead: SECOND,
      amountAt: () => 1,
    });

    act(() =>
      void fireEvent.change(screen.getByLabelText("Verlauf ab dem Keyframe von Stärke"), {
        target: { value: "hold" },
      }),
    );

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.setInterp",
      target: { kind: "clip", clip: "clp_1" },
      effectType: "brightness",
      key: "amount",
      time: SECOND,
      interp: "hold",
    });
  });

  // A .videola written elsewhere may carry a bezier keyframe. Dropping it from the list would
  // make the picker show "Linear" for a keyframe that is not linear.
  it("names an interpolation it cannot author rather than misreporting it", () => {
    show({
      clip: clipWithMedia(withBrightness({ amount: [key(SECOND, 1, "bezier")] })),
      playhead: SECOND,
      amountAt: () => 1,
    });

    const picker = screen.getByLabelText("Verlauf ab dem Keyframe von Stärke") as HTMLSelectElement;
    expect(picker.value).toBe("bezier");
    expect([...picker.options].map((option) => option.value)).toEqual([
      "bezier",
      "linear",
      "hold",
      "ease",
    ]);
  });

  it("offers no interpolation where no keyframe sits", () => {
    show({
      clip: clipWithMedia(withBrightness({ amount: [key(SECOND, 1)] })),
      playhead: 0,
      amountAt: () => 1,
    });

    expect(screen.queryByLabelText("Verlauf ab dem Keyframe von Stärke")).toBeNull();
  });

  it("walks to the neighbouring keyframes and stops at the ends", () => {
    const rig = show({
      clip: clipWithMedia(
        // Two keyframes on the earlier side: with only one, "the first before" and "the last
        // before" are the same entry and the walk cannot be told from a walk to the beginning.
        withBrightness({ amount: [key(0, 0), key(SECOND / 2, 0.5), key(SECOND, 1), key(2 * SECOND, 2)] }),
      ),
      playhead: SECOND,
      amountAt: () => 1,
    });

    press("Zum vorherigen Keyframe von Stärke");
    press("Zum nächsten Keyframe von Stärke");

    expect(rig.seeks).toEqual([SECOND / 2, 2 * SECOND]);
  });

  it("greys the walk out where there is no keyframe on that side", () => {
    show({
      clip: clipWithMedia(withBrightness({ amount: [key(0, 0)] })),
      playhead: 0,
      amountAt: () => 0,
    });

    const back = screen.getByRole("button", { name: "Zum vorherigen Keyframe von Stärke" });
    const forward = screen.getByRole("button", { name: "Zum nächsten Keyframe von Stärke" });
    expect((back as HTMLButtonElement).disabled).toBe(true);
    expect((forward as HTMLButtonElement).disabled).toBe(true);
  });

  // A keyframe outside the clip is never evaluated for it, and a keyframed parameter ignores its
  // static value -- so with the playhead elsewhere neither control can do anything truthful.
  it("locks the keyframe controls while the playhead stands outside the clip", () => {
    show({
      clip: clipWithMedia({ start: SECOND, ...withBrightness({ amount: [key(SECOND, 1)] }) }),
      playhead: 0,
      amountAt: () => 1,
    });

    expect((slider("Stärke") as HTMLInputElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", { name: "Keyframe für Stärke am Playhead" }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  // Asking at the raw playhead would come back empty and the row would drop to the manifest
  // default -- a number the clip does not carry anywhere.
  it("asks the core at the nearest moment the clip covers", () => {
    const rig = show({
      clip: clipWithMedia({ start: SECOND, ...withBrightness({ amount: [key(SECOND, 3)] }) }),
      playhead: 0,
      amountAt: () => 3,
    });

    expect(rig.asked).toEqual([SECOND]);
    expect(slider("Stärke").value).toBe("3");
  });

  // The range element sanitises its own value, so the readout beside it is the only place an
  // unclamped number would be visible -- and the readout is what says what is being drawn.
  it("pulls a value from outside the declared range back onto the row", () => {
    show({ clip: clipWithMedia(withBrightness()), amountAt: () => 99 });

    expect(slider("Stärke").value).toBe("4");
    expect(readout("Stärke")).toBe("4");
  });

  // A NaN travels through `Math.min(Math.max(...))` unchanged and lands on the row as "NaN",
  // and a project file can carry one -- as it can carry a value of a kind that is not a number.
  it("falls back to the manifest default for a value that is not a finite number", () => {
    show({
      clip: clipWithMedia(withBrightness()),
      rawAmountAt: () => ({ kind: "float", value: Number.NaN }),
    });

    expect(readout("Stärke")).toBe("1");
  });

  it("falls back to the manifest default for a value that is not a number at all", () => {
    show({
      clip: clipWithMedia(withBrightness()),
      rawAmountAt: () => ({ kind: "choice", value: "bright" }),
    });

    expect(readout("Stärke")).toBe("1");
  });

  // React 19 catches an exception thrown from an event handler itself, so a broken handler looks
  // in jsdom exactly like one that works.
  it("raises nothing while every control is worked through", () => {
    const escaped: string[] = [];
    const onError = (event: ErrorEvent): void => void escaped.push(event.message);
    window.addEventListener("error", onError);

    show({
      clip: clipWithMedia(withBrightness({ amount: [key(0, 0), key(SECOND, 1)] })),
      playhead: 0,
      amountAt: () => 0,
    });
    for (const input of screen.getAllByRole("slider") as HTMLInputElement[]) {
      if (input.disabled) continue;
      act(() => void fireEvent.pointerDown(input));
      slide(input, Number(input.min));
      slide(input, Number(input.max));
      act(() => void fireEvent.pointerUp(input));
    }
    for (const button of screen.getAllByRole("button") as HTMLButtonElement[]) {
      if (!button.disabled) act(() => void button.click());
    }

    window.removeEventListener("error", onError);
    expect(escaped).toEqual([]);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
  // The parameter kind reaching the surface. A colour is not a slider, and a row that rendered one
  // anyway would put a number between 0 and 1 where a picker belongs.
  describe("a colour parameter", () => {
    const showDip = (value: unknown): Rig =>
      show({ clip: clipWithMedia(withDip()), effects: [DIP], resolved: colourAt(value) });
    const picker = (): HTMLInputElement => screen.getByLabelText("Farbe") as HTMLInputElement;

    it("gets a picker rather than a slider", () => {
      showDip({ kind: "color", value: [1, 0, 0, 1] });

      expect(picker().type).toBe("color");
      expect(picker().value).toBe("#ff0000");
      expect(screen.queryByRole("slider", { name: "Farbe" })).toBeNull();
    });

    it("sends what was picked as a colour, not as a number", () => {
      const rig = showDip({ kind: "color", value: [0, 0, 0, 1] });

      act(() => void fireEvent.change(picker(), { target: { value: "#3366ff" } }));

      expect(rig.sent).toHaveLength(1);
      expect(rig.sent[0]!.command).toEqual({
        type: "effect.setParam",
        target: { kind: "clip", clip: "clp_1" },
        effectType: "dip",
        key: "colour",
        value: { kind: "color", value: [0.2, 0.4, 1, 1] },
      });
      // One key for the whole picker: dragging round a colour wheel is one gesture, and thirty
      // undo steps for it are thirty ways to lose the one that mattered.
      expect(rig.sent[0]!.key).toBe("color:eff_1:colour");
    });

    // A hand-authored project can put anything on a colour key, and a picker fed a channel outside
    // the unit interval shows a colour no shader would ever produce.
    it("shows a value from outside the unit cube pulled back into it", () => {
      showDip({ kind: "color", value: [4, -1, 0.5, 1] });

      expect(picker().value).toBe("#ff0080");
    });

    it("falls back to the declared default for a value of the wrong kind", () => {
      showDip(float(0.5));

      expect(picker().value).toBe("#000000");
    });

    // The picker has no alpha of its own, so it carries back whatever the model held -- which on a
    // hand-authored project is whatever was written there. Unguarded, editing the colour is how an
    // impossible alpha gets stored a second time, this time by the application itself.
    it("carries the alpha back inside the unit interval, not as it was found", () => {
      const rig = showDip({ kind: "color", value: [0, 0, 0, 5] });

      act(() => void fireEvent.change(picker(), { target: { value: "#3366ff" } }));

      expect(rig.sent[0]!.command).toMatchObject({
        value: { kind: "color", value: [0.2, 0.4, 1, 1] },
      });
    });
  });

  describe("a curve parameter", () => {
    const showCurves = (value: unknown, over: Overrides = {}): Rig =>
      show({
        clip: clipWithMedia({ ...withCurves(), ...over }),
        effects: [CURVES],
        resolved: lumaAt(value),
      });
    const S = { kind: "curve", value: [[0, 0], [0.5, 0.8], [1, 1]] };

    it("gets a field of draggable points rather than a slider", () => {
      showCurves(S);

      expect(curvePoints()).toHaveLength(3);
      expect(screen.queryByRole("slider", { name: "Helligkeit" })).toBeNull();
    });

    // The point positions are what a person aims at, so they have to be where the model says --
    // and the y axis is turned, because a graph runs up and a page runs down.
    it("puts each point where the model says, with the output running up the field", () => {
      showCurves(S);

      expect(curvePoints().map((point) => [point.style.left, point.style.bottom])).toEqual([
        ["0%", "0%"],
        ["50%", "80%"],
        ["100%", "100%"],
      ]);
    });

    it("sends the dragged point as a curve, not as a number", () => {
      const rig = showCurves(S);
      measured();

      dragPoint(curvePoints()[1]!, [[25, 60]]);

      expect(rig.sent[0]!.command).toEqual({
        type: "effect.setParam",
        target: { kind: "clip", clip: "clp_1" },
        effectType: "curves",
        key: "luma",
        value: { kind: "curve", value: [[0, 0], [0.25, 0.6], [1, 1]] },
      });
    });

    // One drag is one entry on the undo stack. Without a key per gesture, crossing the field is
    // forty steps of undo and the shape you started from is forty presses away.
    it("collapses one drag into one undo step and starts a new one on the next grab", () => {
      const rig = showCurves(S);
      measured();

      dragPoint(curvePoints()[1]!, [
        [30, 50],
        [40, 55],
        [50, 60],
      ]);
      dragPoint(curvePoints()[1]!, [[60, 70]]);

      expect(rig.sent).toHaveLength(4);
      expect(new Set(rig.sent.slice(0, 3).map((entry) => entry.key)).size).toBe(1);
      expect(rig.sent[3]!.key).not.toBe(rig.sent[0]!.key);
    });

    // A point that overtakes its neighbour changes its own place in the list, and the finger then
    // carries on dragging whichever point inherited it. Clamped, the order can never change.
    it("will not let a point past its neighbours", () => {
      const rig = showCurves(S);
      measured();

      dragPoint(curvePoints()[1]!, [[400, 50]]);
      const far = sentCurve(rig, rig.sent.length - 1);

      expect(far[1]![0]).toBeLessThan(1);
      expect(far[1]![0]).toBeGreaterThan(0);
      expect(far.map((point) => point[0])).toEqual([...far.map((point) => point[0])].sort());
    });

    it("moves a point with the arrow keys", () => {
      const rig = showCurves(S);

      act(() => void fireEvent.keyDown(curvePoints()[1]!, { key: "ArrowUp" }));

      expect(sentCurve(rig)[1]).toEqual([0.5, 0.8200000000000001]);
    });

    // Adding a point has to change nothing until it is dragged. One that landed anywhere but on
    // the line would be a curve editor that grades the picture by being looked at.
    it("adds a point on the line where the field was tapped", () => {
      const rig = showCurves(S);
      const field = measured();

      act(() => void fireEvent.pointerDown(field, { clientX: 25, clientY: 50 }));

      const added = sentCurve(rig);
      expect(added).toHaveLength(4);
      expect(added[1]![0]).toBeCloseTo(0.25, 6);
      // On the line the curve already drew there, not at the height of the press.
      expect(added[1]![1]).toBeCloseTo(curveAt(S.value as [number, number][], 0.25), 6);
    });

    it("takes an inner point away when it is tapped rather than dragged", () => {
      const rig = showCurves(S);
      measured();

      tapPoint(curvePoints()[1]!);

      expect(sentCurve(rig, rig.sent.length - 1)).toEqual([
        [0, 0],
        [1, 1],
      ]);
    });

    // Black and white are what a curve is drawn between. A field that could lose them would end
    // up with no shape left to speak of and no way back to one.
    it("keeps the two ends whatever is done to them", () => {
      const rig = showCurves(S);
      measured();

      tapPoint(curvePoints()[0]!);
      tapPoint(curvePoints()[2]!);
      act(() => void fireEvent.keyDown(curvePoints()[0]!, { key: "Delete" }));

      expect(rig.sent).toHaveLength(0);
    });

    it("falls back to the declared default for a value of the wrong kind", () => {
      showCurves(float(0.5));

      expect(curvePoints().map((point) => [point.style.left, point.style.bottom])).toEqual([
        ["0%", "0%"],
        ["100%", "100%"],
      ]);
    });

    // Curve and keyframe, crossed on the surface: with a track on the parameter the field writes a
    // keyframe rather than a static value, and outside the clip it writes nothing at all.
    it("writes a keyframe once the parameter is on the clock", () => {
      const rig = showCurves(S, withCurves({ luma: [{ time: 0, value: S, interp: "linear" }] }));
      measured();

      dragPoint(curvePoints()[1]!, [[25, 60]]);

      expect(rig.sent[0]!.command).toMatchObject({
        type: "keyframe.add",
        key: "luma",
        value: { kind: "curve", value: [[0, 0], [0.25, 0.6], [1, 1]] },
      });
    });

    it("cannot be dragged while the playhead stands outside a clip whose curve is keyframed", () => {
      show({
        clip: clipWithMedia(withCurves({ luma: [{ time: 0, value: S, interp: "linear" }] })),
        effects: [CURVES],
        resolved: lumaAt(S),
        playhead: 5 * SECOND,
      });

      for (const point of curvePoints()) expect(point.disabled).toBe(true);
    });
  });

  // The kind that names a file. What it must never do is offer a table the library does not hold,
  // because the renderer would then draw the untouched picture under a grade's name.
  describe("a lookup table parameter", () => {
    const clip = (): Clip => clipWithMedia(withLut());
    const withLibrary = (value: unknown, library: Project["library"]): Rig =>
      show({
        clip: clip(),
        project: makeProject([makeTrack("trk_1", [clip()])], library),
        effects: [LUT],
        resolved: tableAt(value),
      });
    const picker = (): HTMLSelectElement => screen.getByLabelText("Tabelle") as HTMLSelectElement;

    it("gets a picker of the tables in the library rather than a slider", () => {
      withLibrary(undefined, [MEDIA, TABLE]);

      expect([...picker().options].map((option) => option.value)).toEqual(["", "med_swap"]);
      expect(screen.queryByRole("slider", { name: "Tabelle" })).toBeNull();
    });

    // A video is not a table. Offering one would put a name in the menu that, once chosen, grades
    // nothing -- the renderer looks the id up among the tables it loaded and finds none.
    it("offers only the entries that are tables", () => {
      withLibrary(undefined, [MEDIA, TABLE]);

      expect([...picker().options].map((option) => option.textContent)).toEqual([
        "Keine",
        "Swap.cube",
      ]);
    });

    it("sends the chosen table as the name of a library entry", () => {
      const rig = withLibrary(undefined, [TABLE]);

      act(() => void fireEvent.change(picker(), { target: { value: "med_swap" } }));

      expect(rig.sent).toHaveLength(1);
      expect(rig.sent[0]!.command).toEqual({
        type: "effect.setParam",
        target: { kind: "clip", clip: "clp_1" },
        effectType: "lut",
        key: "table",
        value: { kind: "choice", value: "med_swap" },
      });
    });

    it("shows what the core resolved, not the first entry in the list", () => {
      withLibrary({ kind: "choice", value: "med_swap" }, [TABLE]);

      expect(picker().value).toBe("med_swap");
    });

    // A project file may carry any kind on this key, and a float is not a medium. `shownLut` is
    // the guard, and it is the same one `lutMedia` applies in the engine before the compositor
    // looks a texture up -- a picker standing on a name the renderer ignores would be a lie about
    // the one thing this row displays.
    it("stands on nothing for a value that is not the name of a table", () => {
      withLibrary(float(0.5), [TABLE]);

      expect(picker().value).toBe("");
    });

    // A menu whose only entry means "no" is a control that cannot do anything, and this panel
    // refuses those elsewhere for the same reason.
    it("says where a table comes from instead of offering an empty menu", () => {
      withLibrary(undefined, [MEDIA]);

      expect(screen.queryByLabelText("Tabelle")).toBeNull();
      expect(screen.getByText("Erst eine .cube-Datei importieren.")).toBeTruthy();
    });

    // `ParamValue` will not interpolate between two names, so a keyframe here could only ever hold.
    // A row of switches that can only produce a hold promises an animation nothing will draw.
    it("carries no keyframe switches", () => {
      withLibrary(undefined, [TABLE]);

      expect(screen.queryByRole("button", { name: /Tabelle/ })).toBeNull();
    });
  });
});

function identity(): Clip["transform"] {
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
  };
}

// The failure this section is most exposed to is a button that dispatches nothing -- a preset in
// the menu with no cover. Every run below asserts what actually reached `dispatch`, and that the
// whole list arrived under one key so it is one press of undo.
describe("Inspector, presets", () => {
  const press = (label: string): void => {
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: label }));
    });
  };

  it("sends a Ken Burns move as one undoable step of six keyframes", () => {
    const rig = show();
    press("Ken-Burns-Fahrt hinein");

    expect(rig.sent).toHaveLength(6);
    expect(new Set(rig.sent.map((entry) => entry.key)).size).toBe(1);
    for (const entry of rig.sent) {
      expect((entry.command as { type: string }).type).toBe("keyframe.add");
    }
    const keys = rig.sent.map((entry) => (entry.command as { key: string }).key);
    expect(new Set(keys)).toEqual(new Set(["scaleX", "scaleY", "position"]));
  });

  it("writes the rate track for a slow start, and nothing else", () => {
    const rig = show();
    press("Langsamer Anfang");

    expect(rig.sent).toHaveLength(2);
    for (const entry of rig.sent) {
      expect((entry.command as { key: string }).key).toBe("speed");
    }
  });

  // Two presses are two edits: sharing a key would fold the second into the first and cost the
  // user an undo step they can never reach.
  it("gives each press its own undo step", () => {
    const rig = show();
    press("Langsamer Anfang");
    press("Langsames Ende");

    const keys = new Set(rig.sent.map((entry) => entry.key));
    expect(keys.size).toBe(2);
  });

  it("shrinks the clip and puts it in a corner for picture in picture", () => {
    const rig = show();
    press("Bild im Bild");

    expect(rig.sent).toHaveLength(1);
    const command = rig.sent[0]!.command as { type: string; transform: { x: number; scaleX: number } };
    expect(command.type).toBe("clip.setTransform");
    expect(command.transform.scaleX).toBeLessThan(1);
    expect(command.transform.x).toBeGreaterThan(0);
  });

  // A disabled button is the honest form of "this preset cannot do anything here". The freeze needs
  // a playhead inside the clip, and it refuses a reversed one outright.
  it("disables the freeze where it would do nothing", () => {
    show({ playhead: 0 });
    expect(screen.getByRole("button", { name: "Standbild ab hier" })).toHaveProperty("disabled", true);

  });

  it("enables the freeze where the playhead is inside the clip", () => {
    show({ playhead: SECOND });
    expect(screen.getByRole("button", { name: "Standbild ab hier" })).toHaveProperty("disabled", false);
  });

  it("disables the freeze on a reversed clip rather than freezing the wrong frame", () => {
    show({
      playhead: SECOND,
      clip: clipWithMedia({ speed: { rate: 1, reverse: true, preservePitch: true } }),
    });
    expect(screen.getByRole("button", { name: "Standbild ab hier" })).toHaveProperty("disabled", true);
  });

  it("freezes from the playhead with two keys on the rate track", () => {
    const rig = show({ playhead: SECOND });
    press("Standbild ab hier");

    expect(rig.sent).toHaveLength(2);
    const values = rig.sent.map((entry) => (entry.command as { value: { value: number } }).value.value);
    expect(values[1]).toBe(0);
  });
});
