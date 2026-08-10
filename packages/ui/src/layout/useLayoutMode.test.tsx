import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutMode, useLayoutPreference } from "./useLayoutMode";

function setViewport(width: number, hasFinePointer: boolean): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("any-pointer: fine") ? hasFinePointer : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("useLayoutMode", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("detects the mode from the viewport when set to auto", () => {
    setViewport(1440, true);
    const { result } = renderHook(() => useLayoutMode("auto"));
    expect(result.current).toBe("desktop");
  });

  it("lets an explicit preference win over detection", () => {
    setViewport(390, false);
    const { result } = renderHook(() => useLayoutMode("desktop"));
    expect(result.current).toBe("desktop");
  });

  it("re-evaluates on an actual resize event so a rotated tablet follows", () => {
    setViewport(1024, true);
    const { result } = renderHook(() => useLayoutMode("auto"));
    expect(result.current).toBe("tablet");

    act(() => {
      setViewport(1440, true);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe("desktop");
  });

  it("stops listening for resize after unmount", () => {
    setViewport(1024, true);
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useLayoutMode("auto"));
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});

// Detection is right nearly always and wrong in the one case that matters: a wide screen whose
// browser reports no fine pointer is laid out as a tablet, because `(any-pointer: fine)` is the only
// honest question a page can ask about what is being pointed with. Whoever disagrees has to be able
// to say so, and be remembered saying it.
describe("useLayoutPreference", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("starts on auto, which is what detection means", () => {
    const { result } = renderHook(() => useLayoutPreference());
    expect(result.current.preference).toBe("auto");
  });

  it("remembers a choice across a reload", () => {
    const first = renderHook(() => useLayoutPreference());
    act(() => first.result.current.setPreference("desktop"));

    const second = renderHook(() => useLayoutPreference());
    expect(second.result.current.preference).toBe("desktop");
  });

  // Auto clears the key rather than storing the word: a build that later changes what auto means
  // must not be overridden by a preference nobody set.
  it("clears the key when put back on auto", () => {
    const rig = renderHook(() => useLayoutPreference());
    act(() => rig.result.current.setPreference("phone"));
    act(() => rig.result.current.setPreference("auto"));

    expect(localStorage.getItem("videola.layout")).toBeNull();
    expect(renderHook(() => useLayoutPreference()).result.current.preference).toBe("auto");
  });

  it("ignores a stored word that is not a layout", () => {
    localStorage.setItem("videola.layout", "widescreen");
    expect(renderHook(() => useLayoutPreference()).result.current.preference).toBe("auto");
  });

  // The whole point of the choice: a wide window with no fine pointer, laid out as a desktop
  // because somebody said so.
  it("is what the shell lays out by", () => {
    setViewport(1440, false);
    expect(renderHook(() => useLayoutMode("auto")).result.current).toBe("tablet");
    expect(renderHook(() => useLayoutMode("desktop")).result.current).toBe("desktop");
  });
});
