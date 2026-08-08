import { beforeEach, describe, expect, it } from "vitest";

import type { Project } from "@videola/core";

import { installFakeOpfs } from "./fake-opfs";
import { clearSession, readSession, worthSaving, writeSession } from "./session";

function project(over: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1,
    meta: { id: "prj_1", title: "Session", tags: [] },
    settings: {
      width: 1920,
      height: 1080,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: 48_000,
      colorSpace: "srgb",
      background: "#000000",
    },
    library: [],
    timeline: { tracks: [] },
    markers: [],
    master: { volume: 1, effects: [] },
    ...over,
  } as unknown as Project;
}

const withTrack = (): Project =>
  project({
    timeline: {
      tracks: [
        {
          id: "trk_1",
          kind: "video",
          name: "V1",
          colorHex: "#5B8CFF",
          height: 72,
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          volume: 1,
          pan: 0,
          clips: [],
          effects: [],
        },
      ],
    },
  } as unknown as Partial<Project>);

describe("the autosaved session", () => {
  beforeEach(() => {
    installFakeOpfs();
  });

  it("reads back the project it was handed", async () => {
    await writeSession(withTrack());

    const session = await readSession();

    expect(session?.project.timeline.tracks[0]?.name).toBe("V1");
    expect(Date.parse(session?.savedAt ?? "")).not.toBeNaN();
  });

  // No media travel with a snapshot: they are already in OPFS under their content hash, which is
  // the whole reason this can run every half minute.
  it("holds nothing but the project state", async () => {
    await writeSession(withTrack());
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle("session.json")).getFile();

    expect(Object.keys(JSON.parse(await file.text()) as object).sort()).toEqual([
      "project",
      "savedAt",
    ]);
  });

  it("replaces the previous snapshot rather than appending to it", async () => {
    await writeSession(withTrack());
    await writeSession(project());

    expect((await readSession())?.project.timeline.tracks).toEqual([]);
  });

  it("reports nothing where nothing was ever written", async () => {
    expect(await readSession()).toBeUndefined();
  });

  it("is gone after it is cleared, and clearing again is not an error", async () => {
    await writeSession(withTrack());
    await clearSession();
    await clearSession();

    expect(await readSession()).toBeUndefined();
  });

  // A half-written file is what a crash mid-write leaves behind, and an autosave nobody asked for
  // must never be the reason the editor refuses to start.
  it("answers a truncated snapshot as no snapshot at all", async () => {
    await writeSession(withTrack());
    const root = await navigator.storage.getDirectory();
    const writable = await (await root.getFileHandle("session.json")).createWritable();
    await writable.write(new TextEncoder().encode('{"savedAt":"2026-08-07T00:00'));
    await writable.close();

    expect(await readSession()).toBeUndefined();
  });

  it("answers well-formed JSON that is not a session as no snapshot", async () => {
    const root = await navigator.storage.getDirectory();
    const writable = await (await root.getFileHandle("session.json", { create: true }))
      .createWritable();
    await writable.write(new TextEncoder().encode('{"savedAt":"now"}'));
    await writable.close();

    expect(await readSession()).toBeUndefined();
  });

  // The empty editor is the state every fresh tab is in. Writing it is exactly how a real snapshot
  // gets overwritten by the tab that was still offering to restore it.
  it("says an empty project is not worth saving and anything else is", () => {
    expect(worthSaving(project())).toBe(false);
    expect(worthSaving(withTrack())).toBe(true);
    expect(worthSaving(project({ library: [{ id: "med_x" }] } as unknown as Partial<Project>))).toBe(
      true,
    );
  });
});

// A private window has no OPFS at all, and the editor has to start in one. The read must answer
// like an absent file rather than reject into an unhandled rejection at boot.
describe("without storage at all", () => {
  it("answers as if there were no snapshot", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        storage: {
          getDirectory: () => Promise.reject(new Error("no OPFS here")),
        },
      },
    });

    await expect(readSession()).resolves.toBeUndefined();
  });
});
