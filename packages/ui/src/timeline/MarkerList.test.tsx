import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FLICKS_PER_SECOND, type Command, type Marker, type Rate } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { MarkerList, markerAfter, sixDigit } from "./MarkerList";

const NTSC: Rate = { numerator: 30000, denominator: 1001 };

function marker(over: Partial<Marker> = {}): Marker {
  return {
    id: "mrk_1",
    time: FLICKS_PER_SECOND,
    label: "",
    colorHex: "#F0A030",
    note: "",
    ...over,
  } as Marker;
}

interface Rig {
  dispatch: ReturnType<typeof vi.fn<(command: Command, key?: string) => void>>;
  seek: ReturnType<typeof vi.fn<(time: number) => void>>;
}

function show(markers: Marker[]): Rig {
  const rig: Rig = { dispatch: vi.fn(), seek: vi.fn() };
  render(
    <I18nProvider>
      <MarkerList markers={markers} fps={NTSC} dispatch={rig.dispatch} onSeek={rig.seek} />
    </I18nProvider>,
  );
  // Closed by default, so nothing inside it is reachable until it is opened -- which is also what
  // the browser does to a `<details>` and the reason it is one.
  act(() => void (screen.getByTestId("marker-list") as HTMLDetailsElement).setAttribute("open", ""));
  return rig;
}

describe("MarkerList", () => {
  it("lists the markers in time order however they arrive", () => {
    show([
      marker({ id: "mrk_late", time: 5 * FLICKS_PER_SECOND, label: "later" }),
      marker({ id: "mrk_early", time: FLICKS_PER_SECOND, label: "sooner" }),
    ]);

    const names = screen.getAllByLabelText("Markername") as HTMLInputElement[];
    expect(names.map((input) => input.value)).toEqual(["sooner", "later"]);
  });

  it("jumps to a marker when its time is pressed", () => {
    const rig = show([marker({ time: 3 * FLICKS_PER_SECOND })]);

    act(() => void screen.getByRole("button", { name: "00:00:03.00" }).click());

    expect(rig.seek).toHaveBeenCalledWith(3 * FLICKS_PER_SECOND);
  });

  it("sends the colour, the name and the note as their own commands", () => {
    const rig = show([marker()]);

    fireEvent.change(screen.getByLabelText("Markerfarbe"), { target: { value: "#2ea043" } });
    fireEvent.change(screen.getByLabelText("Markername"), { target: { value: "chapter" } });
    fireEvent.change(screen.getByLabelText("Notiz"), { target: { value: "the take we kept" } });

    expect(rig.dispatch.mock.calls.map((call) => call[0])).toEqual([
      { type: "marker.setColor", marker: "mrk_1", colorHex: "#2ea043" },
      { type: "marker.rename", marker: "mrk_1", label: "chapter" },
      { type: "marker.setNote", marker: "mrk_1", note: "the take we kept" },
    ]);
  });

  // Typing is one undo step, not one per letter, which is what the coalesce key is for -- and the
  // key is per marker, so editing a second one does not fold into the first one's step.
  it("coalesces typing per marker and per field", () => {
    const rig = show([marker(), marker({ id: "mrk_2", time: 2 * FLICKS_PER_SECOND })]);

    const names = screen.getAllByLabelText("Markername");
    fireEvent.change(names[0]!, { target: { value: "a" } });
    fireEvent.change(names[1]!, { target: { value: "b" } });
    fireEvent.change(screen.getAllByLabelText("Notiz")[0]!, { target: { value: "c" } });

    expect(rig.dispatch.mock.calls.map((call) => call[1])).toEqual([
      "marker-label-mrk_1",
      "marker-label-mrk_2",
      "marker-note-mrk_1",
    ]);
  });

  it("deletes a marker", () => {
    const rig = show([marker()]);

    act(() => void screen.getByRole("button", { name: "Marker löschen" }).click());

    // No coalesce key: a deletion is its own undo step and must not fold into the typing before it.
    expect(rig.dispatch.mock.calls).toEqual([[{ type: "marker.remove", marker: "mrk_1" }]]);
  });

  it("says so rather than showing an empty list", () => {
    show([]);

    expect(screen.queryByLabelText("Markername")).toBeNull();
    expect(screen.getByTestId("marker-list").textContent).toContain("Marker (0)");
  });
});

// The three shapes the model accepts and the one shape the native colour input will show. Left
// alone, an unparsable value is silently replaced with black by the browser -- and then written
// back to the project on the next change as if somebody had chosen it.
describe("sixDigit", () => {
  it("widens a three digit colour rather than losing it", () => {
    expect(sixDigit("#f0a")).toBe("#ff00aa");
  });

  it("drops the alpha of an eight digit colour", () => {
    expect(sixDigit("#2ea04380")).toBe("#2ea043");
  });

  it("passes a six digit colour through", () => {
    expect(sixDigit("#2ea043")).toBe("#2ea043");
  });

  it("answers black for anything that is not a colour at all", () => {
    expect(sixDigit("rebeccapurple")).toBe("#000000");
  });
});

describe("markerAfter", () => {
  const markers = [
    marker({ id: "mrk_a", time: FLICKS_PER_SECOND }),
    marker({ id: "mrk_b", time: 3 * FLICKS_PER_SECOND }),
    marker({ id: "mrk_c", time: 5 * FLICKS_PER_SECOND }),
  ];

  it("finds the nearest one ahead, not the first in the list", () => {
    expect(markerAfter(markers, 2 * FLICKS_PER_SECOND, 1)?.id).toBe("mrk_b");
    expect(markerAfter(markers, 0, 1)?.id).toBe("mrk_a");
  });

  it("finds the nearest one behind", () => {
    expect(markerAfter(markers, 4 * FLICKS_PER_SECOND, -1)?.id).toBe("mrk_b");
  });

  // Standing exactly on one is not "at" it for the purpose of jumping: otherwise the key would
  // land on the marker under the playhead over and over instead of moving on.
  it("passes over a marker the playhead is standing on", () => {
    expect(markerAfter(markers, 3 * FLICKS_PER_SECOND, 1)?.id).toBe("mrk_c");
    expect(markerAfter(markers, 3 * FLICKS_PER_SECOND, -1)?.id).toBe("mrk_a");
  });

  it("answers nothing past the last one in either direction", () => {
    expect(markerAfter(markers, 9 * FLICKS_PER_SECOND, 1)).toBeUndefined();
    expect(markerAfter(markers, 0, -1)).toBeUndefined();
    expect(markerAfter([], 0, 1)).toBeUndefined();
  });
});
