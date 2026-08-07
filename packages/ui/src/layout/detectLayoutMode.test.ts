import { describe, expect, it } from "vitest";

import { detectLayoutMode } from "./detectLayoutMode";

describe("detectLayoutMode", () => {
  it("treats narrow viewports as a phone regardless of pointer", () => {
    expect(detectLayoutMode({ width: 390, hasFinePointer: false })).toBe("phone");
    expect(detectLayoutMode({ width: 767, hasFinePointer: true })).toBe("phone");
  });

  it("treats mid widths as a tablet", () => {
    expect(detectLayoutMode({ width: 768, hasFinePointer: true })).toBe("tablet");
    expect(detectLayoutMode({ width: 1279, hasFinePointer: true })).toBe("tablet");
  });

  it("treats wide viewports with a mouse as a desktop", () => {
    expect(detectLayoutMode({ width: 1280, hasFinePointer: true })).toBe("desktop");
    expect(detectLayoutMode({ width: 2560, hasFinePointer: true })).toBe("desktop");
  });

  it("keeps a wide touch-only screen in tablet mode so targets stay large", () => {
    expect(detectLayoutMode({ width: 1920, hasFinePointer: false })).toBe("tablet");
  });
});
