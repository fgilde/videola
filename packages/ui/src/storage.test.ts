import { afterEach, describe, expect, it, vi } from "vitest";

import { clearStored, readStored, writeStored } from "./storage";

describe("storage", () => {
  afterEach(() => localStorage.clear());

  it("round-trips a value", () => {
    writeStored("k", "v");
    expect(readStored("k")).toBe("v");
  });

  it("returns undefined for a missing key", () => {
    expect(readStored("missing")).toBeUndefined();
  });

  it("falls back to undefined when reading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readStored("k")).toBeUndefined();
  });

  it("swallows a write failure instead of throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    expect(() => writeStored("k", "v")).not.toThrow();
  });

  it("swallows a clear failure instead of throwing", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => clearStored("k")).not.toThrow();
  });
});
