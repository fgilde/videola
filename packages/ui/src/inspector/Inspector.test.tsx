import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import {
  FLICKS_PER_SECOND,
  type Clip,
  type Command,
  type EffectParamSnapshot,
  type Interp,
  type ParamValue,
  type Project,
  type Time,
} from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { makeClip, makeProject, makeTrack } from "../timeline/Timeline.test";
import { Inspector, type EffectDescriptor } from "./Inspector";

const SECOND = FLICKS_PER_SECOND;

const BRIGHTNESS: EffectDescriptor = {
  id: "brightness",
  name: { de: "Helligkeit", en: "Brightness" },
  inputs: 1,
  params: [{ key: "amount", name: { de: "Staerke", en: "Amount" }, default: 1, min: 0, max: 4 }],
};

const CROSSFADE: EffectDescriptor = {
  id: "crossfade",
  name: { de: "Ueberblendung", en: "Cross dissolve" },
  inputs: 2,
  params: [
    { key: "progress", name: { de: "Fortschritt", en: "Progress" }, default: 1, min: 0, max: 1 },
  ],
};

interface Rig {
  sent: { command: Command; key?: string }[];
  seeks: Time[];
  asked: Time[];
  dispatch: Mock;
}

interface Scene {
  clip?: Clip;
  project?: Project;
  playhead?: Time;
  /** What the core answers for `amount`; the default is a value no static field carries. */
  amountAt?: (at: Time) => number | undefined;
  dispatch?: (command: Command, key?: string) => void;
}

function show(scene: Scene = {}): Rig {
  const clip = scene.clip ?? clipWithMedia();
  const project = scene.project ?? makeProject([makeTrack("trk_1", [clip])], [MEDIA]);
  const rig: Rig = { sent: [], seeks: [], asked: [], dispatch: vi.fn() };
  rig.dispatch.mockImplementation((command: Command, key?: string) => {
    rig.sent.push({ command, key });
    scene.dispatch?.(command, key);
  });

  const effectParamsAt = (at: Time): EffectParamSnapshot => {
    rig.asked.push(at);
    const amount = scene.amountAt?.(at);
    if (amount === undefined) return new Map();
    return new Map([["eff_1", new Map<string, ParamValue>([["amount", float(amount)]])]]);
  };

  render(
    <I18nProvider>
      <Inspector
        project={project}
        clip={clip.id}
        playhead={scene.playhead ?? 0}
        effects={[BRIGHTNESS, CROSSFADE]}
        effectParamsAt={effectParamsAt}
        dispatch={rig.dispatch}
        onSeek={(time) => rig.seeks.push(time)}
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

function key(time: Time, value: number, interp: Interp = "linear"): unknown {
  return { time, value: float(value), interp };
}

function float(value: number): ParamValue {
  return { kind: "float", value };
}

function slider(name: string): HTMLInputElement {
  return screen.getByLabelText(name) as HTMLInputElement;
}

function press(name: string): void {
  act(() => void screen.getByRole("button", { name }).click());
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
          dispatch={vi.fn()}
          onSeek={vi.fn()}
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
    const rig = show({
      project: makeProject([makeTrack("trk_1", [clipWithMedia()])], [
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
  it("offers only single-input effects to add to a clip", () => {
    show();

    expect(screen.getByRole("button", { name: "Helligkeit hinzufügen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ueberblendung hinzufügen/u })).toBeNull();
  });

  it("stops offering an effect the clip already carries", () => {
    show({ clip: clipWithMedia(withBrightness()) });

    expect(screen.queryByRole("button", { name: "Helligkeit hinzufügen" })).toBeNull();
    expect(screen.getByLabelText("Staerke")).toBeTruthy();
  });

  it("shows the value the core interpolates and not the static one", () => {
    show({
      clip: clipWithMedia(withBrightness({ amount: [key(0, 0), key(2 * SECOND, 1)] }, 9)),
      playhead: SECOND / 2,
      amountAt: (at) => at / (2 * SECOND),
    });

    expect(slider("Staerke").value).toBe("0.25");
  });

  it("sets a keyframe at the playhead with the value the row is showing", () => {
    const rig = show({
      clip: clipWithMedia(withBrightness({}, 2)),
      playhead: SECOND,
      amountAt: () => 2,
    });

    press("Keyframe für Staerke am Playhead");

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.add",
      clip: "clp_1",
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
    const toggle = screen.getByRole("button", { name: "Keyframe für Staerke am Playhead" });

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    press("Keyframe für Staerke am Playhead");

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.remove",
      clip: "clp_1",
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

    slide(slider("Staerke"), 3);

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.add",
      clip: "clp_1",
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

    slide(slider("Staerke"), 3);

    expect(rig.sent[0]?.command).toEqual({
      type: "effect.setParam",
      clip: "clp_1",
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
      void fireEvent.change(screen.getByLabelText("Verlauf ab dem Keyframe von Staerke"), {
        target: { value: "hold" },
      }),
    );

    expect(rig.sent[0]?.command).toEqual({
      type: "keyframe.setInterp",
      clip: "clp_1",
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

    const picker = screen.getByLabelText("Verlauf ab dem Keyframe von Staerke") as HTMLSelectElement;
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

    expect(screen.queryByLabelText("Verlauf ab dem Keyframe von Staerke")).toBeNull();
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

    press("Zum vorherigen Keyframe von Staerke");
    press("Zum nächsten Keyframe von Staerke");

    expect(rig.seeks).toEqual([SECOND / 2, 2 * SECOND]);
  });

  it("greys the walk out where there is no keyframe on that side", () => {
    show({
      clip: clipWithMedia(withBrightness({ amount: [key(0, 0)] })),
      playhead: 0,
      amountAt: () => 0,
    });

    const back = screen.getByRole("button", { name: "Zum vorherigen Keyframe von Staerke" });
    const forward = screen.getByRole("button", { name: "Zum nächsten Keyframe von Staerke" });
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

    expect((slider("Staerke") as HTMLInputElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("button", { name: "Keyframe für Staerke am Playhead" }) as HTMLButtonElement
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
    expect(slider("Staerke").value).toBe("3");
  });

  it("pulls a value from outside the declared range back onto the slider", () => {
    show({ clip: clipWithMedia(withBrightness()), amountAt: () => 99 });

    expect(slider("Staerke").value).toBe("4");
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
