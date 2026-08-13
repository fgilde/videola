import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentBackend } from "./backend";
import { cmd } from "./commands";
import { VideolaDocument } from "./document";
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
    audioChannels: 2,
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
    // A fresh object every call mirrors the real backend, which fully
    // re-serializes the project on each state() invocation.
    state: () => ({ ...project }),
    curveShape: () => [],
    // The two interchange writers take no argument and read the project the backend holds; a stand-in
    // has nothing to say about them beyond being asked.
    toEdl: () => "",
    toFcpxml: () => "",
    toXmeml: () => "",
    toAudiola: () => ({ bytes: new Uint8Array(), leftOut: 0 }),
    sourceTimesAt: () => new Map(),
    effectParamsAt: () => new Map(),
    transformsAt: () => new Map(),
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
    // canUndo/canRedo both true is a combination no "toggle after undo/redo"
    // heuristic produces by accident — it can only come from actually reading
    // the backend's result.
    undo: vi.fn(() => ({ patch: [], label: "cmd.track.add", canUndo: true, canRedo: true })),
    redo: vi.fn(() => ({ patch: [], label: "cmd.track.add", canUndo: true, canRedo: false })),
    rollback: vi.fn(),
    save: vi.fn(() => new Uint8Array([1, 2, 3])),
    saveAsTemplate: vi.fn(() => new Uint8Array([4, 5, 6])),
    importMedia: vi.fn(() => ({
      id: "med_abc",
      result: { patch: [], label: "cmd.media.import", canUndo: true, canRedo: false },
    })),
    mediaBytes: () => undefined,
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

  it("caches the project so repeated reads share identity between mutations", () => {
    const before = doc.state;
    expect(doc.state).toBe(before);
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(doc.state).not.toBe(before);
  });

  it("caches warnings the same way, so repeated reads share identity between mutations", () => {
    const before = doc.warnings;
    expect(doc.warnings).toBe(before);
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(doc.warnings).not.toBe(before);
  });

  it("tracks undo and redo availability from the backend result", () => {
    expect(doc.canUndo).toBe(false);
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(true);
  });

  it("moves undo/redo flags on a successful media import, not just after dispatch", () => {
    expect(doc.canUndo).toBe(false);
    doc.importMedia({ name: "a.mp4", type: "video/mp4" }, new Uint8Array());
    expect(doc.canUndo).toBe(true);
  });

  it("does not notify subscribers when a dispatch throws", () => {
    const listener = vi.fn();
    doc.subscribe(listener);
    expect(() => doc.dispatch(cmd.clipRemove("clp_missing"))).toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not move undo/redo flags or notify when undo throws", () => {
    const backend = { ...fakeBackend(), undo: vi.fn(() => { throw new Error("boom"); }) };
    const document = new VideolaDocument(backend);
    document.dispatch(cmd.trackAdd("video", "V1"));
    const listener = vi.fn();
    document.subscribe(listener);
    const canUndoBefore = document.canUndo;
    const canRedoBefore = document.canRedo;

    expect(() => document.undo()).toThrow();

    expect(document.canUndo).toBe(canUndoBefore);
    expect(document.canRedo).toBe(canRedoBefore);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not move undo/redo flags or notify when redo throws", () => {
    const backend = { ...fakeBackend(), redo: vi.fn(() => { throw new Error("boom"); }) };
    const document = new VideolaDocument(backend);
    document.dispatch(cmd.trackAdd("video", "V1"));
    const listener = vi.fn();
    document.subscribe(listener);
    const canUndoBefore = document.canUndo;
    const canRedoBefore = document.canRedo;

    expect(() => document.redo()).toThrow();

    expect(document.canUndo).toBe(canUndoBefore);
    expect(document.canRedo).toBe(canRedoBefore);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not move undo/redo flags or notify when importMedia throws", () => {
    const backend = { ...fakeBackend(), importMedia: vi.fn(() => { throw new Error("boom"); }) };
    const document = new VideolaDocument(backend);
    const listener = vi.fn();
    document.subscribe(listener);
    const canUndoBefore = document.canUndo;
    const canRedoBefore = document.canRedo;

    expect(() =>
      document.importMedia({ name: "a.mp4", type: "video/mp4" }, new Uint8Array()),
    ).toThrow();

    expect(document.canUndo).toBe(canUndoBefore);
    expect(document.canRedo).toBe(canRedoBefore);
    expect(listener).not.toHaveBeenCalled();
  });

  it("forwards a coalesce key so drags collapse into one undo step", () => {
    const backend = fakeBackend();
    const document = new VideolaDocument(backend);
    document.dispatch(cmd.trackAdd("video", "V1"), "drag");
    const [call] = vi.mocked(backend.dispatch).mock.calls[0]!;
    expect(call).toStrictEqual({
      command: { type: "track.add", kind: "video", name: "V1", index: null },
      coalesceKey: "drag",
    });
  });

  it("omits the coalesce key entirely when none is given", () => {
    const backend = fakeBackend();
    const document = new VideolaDocument(backend);
    document.dispatch(cmd.trackAdd("video", "V1"));
    const [call] = vi.mocked(backend.dispatch).mock.calls[0]!;
    expect("coalesceKey" in call).toBe(false);
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
    ).toThrow("error.unsupportedMedia");
    expect(backend.importMedia).not.toHaveBeenCalled();
  });
});
