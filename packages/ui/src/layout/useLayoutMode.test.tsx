import { renderHook } from "@testing-library/react";
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

  it("subscribes to resize so a rotated tablet re-evaluates", () => {
    setViewport(1024, true);
    const addEventListener = vi.spyOn(window, "addEventListener");
    renderHook(() => useLayoutMode("auto"));
    expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
