import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { Preview, type PreviewProps } from "./Preview";

// jsdom lays nothing out, so the element's CSS size is stated here. What the checks below are
// about is the arithmetic between that size and the drawing buffer, which is ours.
function layOut(width: number, height: number): void {
  Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
    value: height,
    configurable: true,
  });
}

interface Shown {
  seen: (HTMLCanvasElement | null)[];
  rerender: (next: Partial<PreviewProps>) => void;
  unmount: () => void;
}

function show(props: Partial<PreviewProps> = {}): Shown {
  const seen: (HTMLCanvasElement | null)[] = [];
  const view = (over: Partial<PreviewProps>) => (
    <I18nProvider>
      <Preview
        width={1920}
        height={1080}
        // A fresh identity on every render: a preview that tears its GL context down for that
        // is the bug this exists to catch.
        onCanvas={(canvas) => void seen.push(canvas)}
        {...props}
        {...over}
      />
    </I18nProvider>
  );
  const rendered = render(view({}));
  return { seen, rerender: (next) => rendered.rerender(view(next)), unmount: rendered.unmount };
}

const canvas = (): HTMLCanvasElement =>
  screen.getByRole("img", { name: "Vorschau" }) as HTMLCanvasElement;

describe("Preview", () => {
  beforeEach(() => {
    layOut(320, 180);
    vi.stubGlobal("devicePixelRatio", 2);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("hands the canvas over once, however often the parent renders", () => {
    const { seen, rerender } = show();
    const element = canvas();

    rerender({ width: 1280 });
    rerender({ width: 3840 });

    expect(seen).toEqual([element]);
  });

  it("takes the canvas back when the preview goes away", () => {
    const { seen, unmount } = show();
    const element = canvas();

    unmount();

    expect(seen).toEqual([element, null]);
  });

  it("sizes the drawing buffer in device pixels, not in CSS pixels", () => {
    show();

    expect([canvas().width, canvas().height]).toEqual([640, 360]);
  });

  it("resizes with the window and asks for the picture back", () => {
    const onResize = vi.fn();
    show({ onResize });
    expect(onResize).toHaveBeenCalledTimes(1);

    layOut(800, 450);
    vi.stubGlobal("devicePixelRatio", 1);
    act(() => void window.dispatchEvent(new Event("resize")));

    expect([canvas().width, canvas().height]).toEqual([800, 450]);
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  // Assigning width or height empties the drawing buffer even when the value does not change,
  // so a resize that changed nothing must not be reported as one.
  it("stays quiet when a resize event changes nothing", () => {
    const onResize = vi.fn();
    show({ onResize });

    act(() => void window.dispatchEvent(new Event("resize")));

    expect(onResize).toHaveBeenCalledTimes(1);
  });

  // On the box the canvas fills, which is also the box the geometry overlay fills: the two are the
  // same rectangle by construction, and the aspect is what makes it the picture's rectangle.
  it("carries the project's aspect ratio, not the drawing buffer's", () => {
    show({ width: 1440, height: 1080 });

    const stage = document.querySelector<HTMLElement>(".v-preview__stage");
    expect(stage?.style.aspectRatio).toBe("1440 / 1080");
  });
});
