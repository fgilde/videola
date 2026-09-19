import { describe, expect, it } from "vitest";

import type { Project } from "@videola/core";

import { namedTrack } from "./trackNames";

function withTracks(...names: string[]): Project {
  return { timeline: { tracks: names.map((name) => ({ name })) } } as unknown as Project;
}

describe("naming a row the application makes itself", () => {
  it("says what is on it", () => {
    expect(namedTrack(withTracks("V1", "A1"), "Songtext")).toBe("Songtext");
  });

  it("numbers the second one rather than handing out the same name twice", () => {
    expect(namedTrack(withTracks("V1", "Songtext"), "Songtext")).toBe("Songtext 2");
  });

  it("keeps counting past a number that is itself taken", () => {
    expect(namedTrack(withTracks("Songtext", "Songtext 2"), "Songtext")).toBe("Songtext 3");
  });

  // A gap is filled rather than skipped: the count is about free names, not about how many rows
  // have ever carried one.
  it("takes a number back once nothing holds it", () => {
    expect(namedTrack(withTracks("Songtext", "Songtext 3"), "Songtext")).toBe("Songtext 2");
  });
});
