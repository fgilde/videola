import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";

import { FLICKS_PER_SECOND, type MediaAsset, type Rate } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { SourceBar, type EditMode, type SourceRange } from "./SourceBar";

const NTSC: Rate = { numerator: 30000, denominator: 1001 };
const TEN_SECONDS = 10 * FLICKS_PER_SECOND;

function asset(over: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: `med_${"a".repeat(64)}`,
    originalName: "take-3.mp4",
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 1n,
    duration: TEN_SECONDS,
    width: 1920,
    height: 1080,
    ...over,
  } as MediaAsset;
}

type Edit = Mock<(mode: EditMode, range: SourceRange) => void>;

function show(over: Partial<MediaAsset> = {}): Edit {
  return showAsset(asset(over));
}

function showAsset(armed: MediaAsset | undefined): Edit {
  const onEdit: Edit = vi.fn();
  render(
    <I18nProvider>
      <SourceBar asset={armed} fps={NTSC} onEdit={onEdit} />
    </I18nProvider>,
  );
  return onEdit;
}

function press(key: string, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(event));
  return event;
}

const click = (name: string): void =>
  act(() => void screen.getByRole("button", { name }).click());

// The scrub bar is a native range over a fixed number of steps, so a position is set by writing
// the step rather than the flick -- which is also how a finger sets it.
function scrubTo(fraction: number): void {
  const slider = screen.getByLabelText("Stelle im Medium") as HTMLInputElement;
  fireEvent.change(slider, { target: { value: String(Math.round(fraction * Number(slider.max))) } });
}

describe("SourceBar", () => {
  it("shows nothing at all while no medium is armed", () => {
    showAsset(undefined);

    expect(screen.queryByTestId("source-bar")).toBeNull();
  });

  it("names the medium a range is being marked in", () => {
    show();

    expect(screen.getByTestId("source-bar").textContent).toContain("take-3.mp4");
  });

  // The whole point of the two marks: the range that leaves here is the one that was marked, not
  // the whole medium.
  it("hands over the marked range and nothing wider", () => {
    const onEdit = show();

    scrubTo(0.2);
    click("In-Punkt setzen (I)");
    scrubTo(0.5);
    click("Out-Punkt setzen (O)");
    click("Einfügen (,)");

    expect(onEdit).toHaveBeenCalledWith("insert", {
      inPoint: 2 * FLICKS_PER_SECOND,
      duration: 3 * FLICKS_PER_SECOND,
    });
  });

  // Nothing marked means the whole medium, which is what an editor expects of a clip they have not
  // trimmed yet -- and it is what keeps the buttons from being dead on a fresh arming.
  it("takes the whole medium when nothing has been marked", () => {
    const onEdit = show();

    click("Überschreiben (.)");

    expect(onEdit).toHaveBeenCalledWith("overwrite", { inPoint: 0, duration: TEN_SECONDS });
  });

  it("marks and edits from the keyboard with the four keys every editor uses", () => {
    const onEdit = show();

    scrubTo(0.1);
    press("i");
    scrubTo(0.3);
    press("o");
    press(",");
    press(".");

    expect(onEdit.mock.calls.map((call) => call[0])).toEqual(["insert", "overwrite"]);
    expect(onEdit.mock.calls[0]?.[1]).toEqual({
      inPoint: FLICKS_PER_SECOND,
      duration: 2 * FLICKS_PER_SECOND,
    });
  });

  it("keeps its keys out of a text field and out of a modified shortcut", () => {
    const onEdit = show();
    const input = document.createElement("input");
    document.body.append(input);

    press(",", input);
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(onEdit).not.toHaveBeenCalled();
    input.remove();
  });

  // An out point at or before the in point is not a range. Refusing it here rather than sending it
  // is what keeps the core's own refusal off the error banner for a state the bar could see.
  it("refuses an edit while the out point is not past the in point", () => {
    const onEdit = show();

    scrubTo(0.6);
    click("In-Punkt setzen (I)");
    scrubTo(0.2);
    click("Out-Punkt setzen (O)");

    expect((screen.getByRole("button", { name: "Einfügen (,)" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    press(",");
    expect(onEdit).not.toHaveBeenCalled();
  });

  // A range belongs to the medium it was marked in. Carrying an out point over to the next one
  // would read past the end of a shorter medium. Re-rendered rather than remounted: a fresh mount
  // starts over whatever the component does, so only a rerender can tell the two apart.
  it("starts over when another medium is armed", () => {
    const onEdit: Edit = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <SourceBar asset={asset()} fps={NTSC} onEdit={onEdit} />
      </I18nProvider>,
    );
    scrubTo(0.5);
    click("In-Punkt setzen (I)");

    rerender(
      <I18nProvider>
        <SourceBar
          asset={asset({ id: `med_${"b".repeat(64)}`, duration: 4 * FLICKS_PER_SECOND })}
          fps={NTSC}
          onEdit={onEdit}
        />
      </I18nProvider>,
    );
    click("Einfügen (,)");

    expect(onEdit).toHaveBeenCalledWith("insert", {
      inPoint: 0,
      duration: 4 * FLICKS_PER_SECOND,
    });
  });

  it("stops listening once it is gone", () => {
    const onEdit = show();
    cleanup();

    press(",");

    expect(onEdit).not.toHaveBeenCalled();
  });
});
