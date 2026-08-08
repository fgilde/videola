import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmd, secondsToTime } from "@videola/core";
import type { MediaAsset, Project } from "@videola/core";
import { beforeEach, describe, expect, it } from "vitest";

import { Api } from "./api";
import { describeProject, validateProject } from "./inspect";

let api: Api;

beforeEach(async () => {
  api = new Api({ storageRoot: await mkdtemp(join(tmpdir(), "videola-inspect-")) });
});

function asset(name: string): MediaAsset {
  return {
    id: `med_${createHash("sha256").update(name).digest("hex")}`,
    originalName: name,
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 10n,
  };
}

// Built through the real core rather than as a literal: a hand-written Project would drift from
// the model the moment a field is added, and would not prove the summary reads what the core writes.
async function project(build: (id: string) => void): Promise<Project> {
  const { id } = await api.create();
  build(id);
  return api.state(id);
}

describe("describeProject", () => {
  it("names the format, the duration and every track", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.projectSetTitle("Reel"), cmd.trackAdd("video", "V1")]);
      const track = api.state(id).timeline.tracks[0]?.id ?? "";
      api.apply(id, [
        cmd.mediaImport(asset("a.mp4")),
        cmd.clipAdd(track, { kind: "media", media: asset("a.mp4").id }, 0, secondsToTime(2.5)),
      ]);
    });

    const text = describeProject(model);

    expect(text).toContain('Project "Reel"');
    expect(text).toContain("1920x1080 at 30/1 fps");
    expect(text).toContain("Duration: 2.500 s across 1 track(s)");
    expect(text).toContain('video "V1"');
    expect(text).toContain("0.000–2.500 s");
    expect(text).toContain("a.mp4");
  });

  it("says a track is empty instead of leaving the line off", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.trackAdd("audio", "A1")]);
    });

    expect(describeProject(model)).toContain("(empty)");
  });

  it("mentions speed, reversal and effects on a clip that carries them", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.trackAdd("video", "V1")]);
      const track = api.state(id).timeline.tracks[0]?.id ?? "";
      api.apply(id, [
        cmd.clipAdd(track, { kind: "generator", generator: { type: "solid", color: "#fff" } }, 0, secondsToTime(1)),
      ]);
      const clip = api.state(id).timeline.tracks[0]?.clips[0]?.id ?? "";
      api.apply(id, [
        cmd.clipSetSpeed(clip, 2, true),
        cmd.effectAdd(clip, "brightness"),
        cmd.keyframeAdd(clip, "brightness", "amount", 0, { kind: "float", value: 1 }),
      ]);
    });

    const text = describeProject(model);

    expect(text).toContain("speed 2 reversed");
    expect(text).toContain("generator solid");
    expect(text).toContain("effect brightness keyframed:amount");
  });
});

describe("validateProject", () => {
  it("finds nothing wrong with a project the core built cleanly", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.trackAdd("video", "V1")]);
      const track = api.state(id).timeline.tracks[0]?.id ?? "";
      api.apply(id, [
        cmd.mediaImport(asset("a.mp4")),
        cmd.clipAdd(track, { kind: "media", media: asset("a.mp4").id }, 0, secondsToTime(1)),
      ]);
    });

    expect(validateProject(model)).toEqual([]);
  });

  // Neither of these can be refused command by command: `clip.add` never checks the library, and
  // two accepted clips are free to sit on top of one another.
  it("reports a clip whose medium the library does not declare", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.trackAdd("video", "V1")]);
      const track = api.state(id).timeline.tracks[0]?.id ?? "";
      api.apply(id, [
        cmd.clipAdd(track, { kind: "media", media: asset("ghost.mp4").id }, 0, secondsToTime(1)),
      ]);
    });

    expect(validateProject(model)).toMatchObject([{ code: "clip.unknownMedia", severity: "error" }]);
  });

  it("reports two clips overlapping on one track", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.trackAdd("video", "V1"), cmd.mediaImport(asset("a.mp4"))]);
      const track = api.state(id).timeline.tracks[0]?.id ?? "";
      const source = { kind: "media", media: asset("a.mp4").id } as const;
      api.apply(id, [
        cmd.clipAdd(track, source, 0, secondsToTime(3)),
        cmd.clipAdd(track, source, secondsToTime(2), secondsToTime(3)),
      ]);
    });

    expect(validateProject(model)).toMatchObject([
      { code: "track.overlappingClips", severity: "warning" },
    ]);
  });

  // Storage order is not start order, and comparing only neighbours as stored would miss this.
  it("finds an overlap between clips that are not neighbours in storage order", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.trackAdd("video", "V1"), cmd.mediaImport(asset("a.mp4"))]);
      const track = api.state(id).timeline.tracks[0]?.id ?? "";
      const source = { kind: "media", media: asset("a.mp4").id } as const;
      api.apply(id, [
        cmd.clipAdd(track, source, 0, secondsToTime(10)),
        cmd.clipAdd(track, source, secondsToTime(1), secondsToTime(1)),
        cmd.clipAdd(track, source, secondsToTime(3), secondsToTime(1)),
      ]);
    });

    expect(validateProject(model).map((finding) => finding.code)).toEqual([
      "track.overlappingClips",
      "track.overlappingClips",
    ]);
  });

  // No M1 command sets fades, so this state only arrives with a hand-authored project.json — which
  // `normalize` bounds but never compares against the clip's own length. The clip itself still
  // comes from the real core; only the field no command can reach is set here.
  it("reports fades longer than the clip they are on", async () => {
    const model = await project((id) => {
      api.apply(id, [cmd.trackAdd("video", "V1")]);
      const track = api.state(id).timeline.tracks[0]?.id ?? "";
      api.apply(id, [
        cmd.clipAdd(track, { kind: "generator", generator: { type: "solid", color: "#000" } }, 0, secondsToTime(1)),
      ]);
    });
    const clip = model.timeline.tracks[0]?.clips[0];
    if (clip === undefined) throw new Error("no clip");
    clip.fades = { inDuration: secondsToTime(2), outDuration: 0 };

    expect(validateProject(model)).toMatchObject([{ code: "clip.fadesLongerThanClip" }]);
  });
});
