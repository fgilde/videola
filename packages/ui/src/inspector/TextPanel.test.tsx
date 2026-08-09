import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Clip, Command } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { makeClip } from "../timeline/Timeline.test";
import { TextPanel } from "./TextPanel";

function field(): HTMLTextAreaElement {
  return screen.getByTestId("text-content") as HTMLTextAreaElement;
}

function textClip(content: string, style: Record<string, unknown> = { y: 0.84 }): Clip {
  return makeClip("clp_1", 0, 1000, {
    source: { kind: "generator", generator: { type: "text", content, style } },
  } as Partial<Clip>);
}

function show(clip: Clip): { sent: Command[]; rerender: (next: Clip) => void } {
  const sent: Command[] = [];
  const send = vi.fn((command: Command) => void sent.push(command));
  const view = render(
    <I18nProvider>
      <TextPanel clip={clip} send={send} />
    </I18nProvider>,
  );
  return {
    sent,
    rerender: (next) =>
      view.rerender(
        <I18nProvider>
          <TextPanel clip={next} send={send} />
        </I18nProvider>,
      ),
  };
}

describe("the text panel", () => {
  it("shows the words the clip is drawing", () => {
    show(textClip("Hello there"));
    expect(field().value).toBe("Hello there");
  });

  // The failure this panel exists to avoid a second time: an `<input type="text">` drops a hard
  // line break without a word, and a two-line subtitle came back one line the moment it redrew.
  it("is a textarea, so a two-line subtitle stays two lines", () => {
    show(textClip("Two lines\nof subtitle"));
    expect(field().tagName).toBe("TEXTAREA");
    expect(field().value).toBe("Two lines\nof subtitle");
  });

  it("keeps a typed line break, all the way into the command", () => {
    const { sent } = show(textClip("One line"));
    const field = screen.getByTestId("text-content");
    fireEvent.change(field, { target: { value: "First\nSecond" } });
    fireEvent.blur(field);
    expect(sent).toEqual([
      {
        type: "clip.setGenerator",
        clip: "clp_1",
        generator: { type: "text", content: "First\nSecond", style: { y: 0.84 } },
      },
    ]);
  });

  // The whole generator travels, so a caption someone restyled must not be reset to the default by
  // a corrected typo.
  it("keeps the clip's own style when only the words change", () => {
    const { sent } = show(textClip("Before", { y: 0.5, color: "#ff0000" }));
    fireEvent.change(screen.getByTestId("text-content"), { target: { value: "After" } });
    fireEvent.click(screen.getByRole("button"));
    expect(sent[0]).toMatchObject({
      generator: { style: { y: 0.5, color: "#ff0000" } },
    });
  });

  // A dispatch per keystroke would be a patch through the whole core per character. The draft is
  // local until the field is left or the button pressed.
  it("sends nothing while the words are being typed", () => {
    const { sent } = show(textClip("Before"));
    fireEvent.change(screen.getByTestId("text-content"), { target: { value: "A" } });
    fireEvent.change(screen.getByTestId("text-content"), { target: { value: "Af" } });
    expect(sent).toEqual([]);
  });

  it("sends nothing when the words come back unchanged", () => {
    const { sent } = show(textClip("Same"));
    fireEvent.change(field(), { target: { value: "Other" } });
    fireEvent.change(field(), { target: { value: "Same" } });
    fireEvent.blur(field());
    expect(sent).toEqual([]);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  // An undo leaves the clip's id alone and changes only its words, which is exactly the case a
  // field keyed on the id would sit through with the wrong text still in it.
  it("follows an undo that puts the old words back", () => {
    const { rerender } = show(textClip("After"));
    rerender(textClip("Before"));
    expect(field().value).toBe("Before");
  });

  it("is not there at all on a clip that draws no words", () => {
    render(
      <I18nProvider>
        <TextPanel clip={makeClip("clp_2", 0, 1000)} send={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.queryByTestId("text-content")).toBeNull();
  });
});
