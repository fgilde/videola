import { act, cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { FLICKS_PER_SECOND, frameDuration, type Rate, type Time } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { Transport, type TransportProps } from "./Transport";

const NTSC: Rate = { numerator: 30000, denominator: 1001 };

interface Rig {
  playPause: Mock<() => void>;
  seek: Mock<(time: Time) => void>;
  step: Mock<(direction: 1 | -1) => void>;
}

function show(props: Partial<TransportProps> = {}): Rig {
  const rig: Rig = { playPause: vi.fn(), seek: vi.fn(), step: vi.fn() };
  render(
    <I18nProvider>
      <Transport
        playing={false}
        time={0}
        duration={10 * FLICKS_PER_SECOND}
        fps={NTSC}
        onPlayPause={rig.playPause}
        onSeek={rig.seek}
        onStep={rig.step}
        {...props}
      />
    </I18nProvider>,
  );
  return rig;
}

function press(key: string, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(event));
  return event;
}

const click = (name: string): void =>
  act(() => void screen.getByRole("button", { name }).click());

describe("Transport", () => {
  it("plays and pauses through the button, and says which of the two it would do", () => {
    const rig = show();

    click("Abspielen");

    expect(rig.playPause).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Anhalten" })).toBeNull();
  });

  it("offers the other action once playback is running", () => {
    show({ playing: true });

    expect(screen.getByRole("button", { name: "Anhalten" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abspielen" })).toBeNull();
  });

  it("jumps to the start and to the end of the material, not to a fixed span", () => {
    const rig = show({ duration: 42 * FLICKS_PER_SECOND });

    click("Ans Ende");
    click("An den Anfang");

    expect(rig.seek.mock.calls).toEqual([[42 * FLICKS_PER_SECOND], [0]]);
  });

  it("steps in both directions", () => {
    const rig = show();

    click("Ein Bild vor");
    click("Ein Bild zurück");

    expect(rig.step.mock.calls).toEqual([[1], [-1]]);
  });

  // The reason this component exists rather than a pair of buttons: the hands are on the
  // timeline while the space bar plays.
  it("answers the space bar with the focus anywhere in the editor", () => {
    const rig = show();
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);

    const event = press(" ", elsewhere);

    expect(rig.playPause).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    elsewhere.remove();
  });

  // A button is activated by the space bar by the browser itself, so answering it here as well
  // would toggle playback twice for one press on the play button.
  it("leaves the space bar to whatever control has the focus", () => {
    const rig = show();

    press(" ", screen.getByRole("button", { name: "Abspielen" }));

    expect(rig.playPause).not.toHaveBeenCalled();
  });

  it("steps on the arrow keys and keeps the timeline from scrolling as well", () => {
    const rig = show();

    const right = press("ArrowRight");
    press("ArrowLeft");

    expect(rig.step.mock.calls).toEqual([[1], [-1]]);
    expect(right.defaultPrevented).toBe(true);
  });

  it("leaves the arrow keys alone in a text field", () => {
    const rig = show();
    const input = document.createElement("input");
    document.body.append(input);

    press("ArrowRight", input);

    expect(rig.step).not.toHaveBeenCalled();
    input.remove();
  });

  it("keeps its keys out of a shortcut that carries a modifier", () => {
    const rig = show();

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(rig.playPause).not.toHaveBeenCalled();
  });

  it("stops listening once it is gone", () => {
    const rig = show();
    cleanup();

    press(" ");

    expect(rig.playPause).not.toHaveBeenCalled();
  });

  // The frame field counts frames of the project's rate. At 30000/1001 the thirtieth frame is
  // the first of second one -- reading the rate as 29.97 puts it a frame short of that.
  it("shows the position in the project's own timecode", () => {
    show({ time: 30 * frameDuration(NTSC), duration: 60 * frameDuration(NTSC) });

    expect(screen.getByLabelText("Position").textContent).toBe("00:00:01.00 / 00:00:02.00");
  });

  it("follows the position it is given", () => {
    show({ time: 5 * frameDuration(NTSC) });

    expect(screen.getByLabelText("Position").textContent?.startsWith("00:00:00.05")).toBe(true);
  });
});
