import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutMode } from "./useLayoutMode";

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
