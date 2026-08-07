import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentBackend } from "./backend";
import { cmd, VideolaDocument } from "./index";
import type { Project } from "./generated";

function emptyProject(): Project {
  return {
    schemaVersion: 1,
    meta: { id: "prj_1", title: "", tags: [] },
    settings: {
      width: 1920,
      height: 1080,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: 48000,
      colorSpace: "srgb",
      background: "#000000",
    },
    library: [],
    timeline: { tracks: [] },
    markers: [],
    master: { volume: 1, effects: [] },
  } as Project;
}

function fakeBackend(): DocumentBackend {
  let project = emptyProject();
  return {
    state: () => project,
    dispatch: vi.fn((dispatch) => {
      if (dispatch.command.type === "track.add") {
        project = {
          ...project,
          timeline: { tracks: [...project.timeline.tracks, { name: "V1" } as never] },
        } as Project;
        return { patch: [], label: "cmd.track.add", canUndo: true, canRedo: false };
      }
      throw new Error("boom");
    }),
    undo: vi.fn(() => ({ patch: [], label: "cmd.track.add", canUndo: false, canRedo: true })),
    redo: vi.fn(() => ({ patch: [], label: "cmd.track.add", canUndo: true, canRedo: false })),
    save: vi.fn(() => new Uint8Array([1, 2, 3])),
    importMedia: vi.fn(() => "med_abc"),
    warnings: () => [],
  };
}

describe("VideolaDocument", () => {
  let doc: VideolaDocument;

  beforeEach(() => {
    doc = new VideolaDocument(fakeBackend());
  });

  it("notifies subscribers after a successful dispatch", () => {
    const seen: number[] = [];
    doc.subscribe((project) => seen.push(project.timeline.tracks.length));
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(seen).toEqual([1]);
  });

  it("tracks undo and redo availability from the backend result", () => {
    expect(doc.canUndo).toBe(false);
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);
  });

  it("does not notify subscribers when a dispatch throws", () => {
    const listener = vi.fn();
    doc.subscribe(listener);
    expect(() => doc.dispatch(cmd.clipRemove("clp_missing"))).toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("forwards a coalesce key so drags collapse into one undo step", () => {
    const backend = fakeBackend();
    const document = new VideolaDocument(backend);
    document.dispatch(cmd.trackAdd("video", "V1"), "drag");
    expect(backend.dispatch).toHaveBeenCalledWith({
      command: { type: "track.add", kind: "video", name: "V1", index: null },
      coalesceKey: "drag",
    });
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const off = doc.subscribe(listener);
    off();
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects an unsupported media type before it reaches the backend", () => {
    const backend = fakeBackend();
    const document = new VideolaDocument(backend);
    expect(() =>
      document.importMedia({ name: "malware.exe", type: "application/x-msdownload" }, new Uint8Array()),
    ).toThrow();
    expect(backend.importMedia).not.toHaveBeenCalled();
  });
});
