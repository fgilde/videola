import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { VideolaDocument } from "./document";
import { FLICKS_PER_SECOND } from "./commands";
import type { Clip, MediaAsset, Slot, SlotAnswer, Template } from "./generated";
import {
  builtinTemplates,
  createTemplateBackend,
  createWasmBackend,
  readTemplateFile,
} from "./wasm-backend";
import { initSync } from "./wasm/videola_core.js";

// Same reason as roundtrip.test.ts: the glue loads the module by fetch, which Node cannot do for a
// file URL, so the instance is planted from disk first. Everything below goes through the real Rust
// core -- the bake, the fit arithmetic and the whole `.videolat` container.
const wasmDir = join(dirname(fileURLToPath(import.meta.url)), "wasm");
initSync({ module: readFileSync(join(wasmDir, "videola_core_bg.wasm")) });

const SECOND = FLICKS_PER_SECOND;

// `media.import` insists on a canonical `med_` plus 64 hex characters, so a readable name is
// turned into hex rather than padded -- otherwise the one test that goes through that command
// would fail for a reason that has nothing to do with templates.
function hexId(name: string): string {
  const hex = [...name]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  return `med_${hex.padEnd(64, "0").slice(0, 64)}`;
}

function asset(name: string, width: number, height: number, seconds: number): MediaAsset {
  return {
    id: hexId(name),
    originalName: `${name}.mp4`,
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 1000n,
    duration: seconds * SECOND,
    width,
    height,
    fps: { numerator: 30, denominator: 1 },
  } as MediaAsset;
}

function answersFor(
  template: Template,
  material: (slot: Slot) => MediaAsset,
): Record<string, SlotAnswer> {
  const answers: Record<string, SlotAnswer> = {};
  for (const slot of template.manifest.slots) {
    if (slot.kind === "media") answers[slot.id] = { kind: "media", asset: material(slot) };
    if (slot.kind === "text") answers[slot.id] = { kind: "text", text: "Sommer 2026" };
    if (slot.kind === "color") answers[slot.id] = { kind: "color", color: "#1188ff" };
  }
  return answers;
}

function clips(doc: VideolaDocument): Clip[] {
  return doc.state.timeline.tracks.flatMap((track) => track.clips);
}

async function named(id: string): Promise<Template> {
  const found = (await builtinTemplates()).find((entry) => entry.manifest.id === id);
  if (found === undefined) throw new Error(`no template ${id}`);
  return found;
}

describe("the shipped catalogue across the WASM boundary", () => {
  it("arrives with both languages, slots and the timeline the gallery draws", async () => {
    const catalogue = await builtinTemplates();

    expect(catalogue.length).toBeGreaterThan(0);
    for (const template of catalogue) {
      expect(template.manifest.name.de).not.toBe("");
      expect(template.manifest.name.en).not.toBe("");
      expect(template.manifest.slots.length).toBeGreaterThan(0);
      expect(template.manifest.aspectRatios.length).toBeGreaterThan(0);
      expect(clipsOf(template).length).toBeGreaterThan(0);
    }
  });

  // The nested maps are the risk at this boundary: keyframes and effect params are Rust BTreeMaps,
  // and they have to come across as plain objects and go back in as maps again. A template with a
  // keyframed brightness is the one in the set that carries them.
  it("carries a keyframed effect out and back in again", async () => {
    const template = await named("bookend");
    const keyframes = clipsOf(template)[0]?.effects[0]?.keyframes;

    expect(keyframes?.amount).toHaveLength(2);

    const backend = await createTemplateBackend(
      template,
      answersFor(template, () => asset("hero", 1920, 1080, 30)),
    );
    const doc = new VideolaDocument(backend);

    expect(clips(doc)[0]?.effects[0]?.keyframes.amount).toHaveLength(2);
  });
});

describe("baking a template through the real core", () => {
  it("puts the answered material, title and colour into an ordinary project", async () => {
    const template = await named("three-shots");
    const material = asset("chosen", 1920, 1080, 30);

    const doc = new VideolaDocument(
      await createTemplateBackend(template, answersFor(template, () => material)),
    );

    expect(doc.state.meta.title).toBe("Sommer 2026");
    expect(doc.state.settings.background).toBe("#1188ff");
    expect(doc.state.library.map((entry) => entry.id)).toEqual([material.id]);
    for (const clip of clips(doc)) {
      expect(clip.source).toEqual({ kind: "media", media: material.id });
    }
  });

  // The discriminating half: a project came out either way, but a 640x360 shot in a 1920x1080 frame
  // is a small rectangle in the middle unless the fit actually ran. Nothing in this version's
  // interface sets a transform, so this scale can only have come from the bake.
  it("scales the material up to fill the frame it was baked into", async () => {
    const template = await named("three-shots");

    const doc = new VideolaDocument(
      await createTemplateBackend(
        template,
        answersFor(template, () => asset("small", 640, 360, 30)),
      ),
    );

    expect(clips(doc)[0]?.transform.scaleX).toBe(3);
    expect(clips(doc)[0]?.transform.scaleY).toBe(3);
  });

  it("takes the frame it is told to and leaves every clip where it was", async () => {
    const template = await named("three-shots");
    const answers = answersFor(template, () => asset("wide", 1920, 1080, 30));
    const at = async (width: number, height: number, fps: number): Promise<VideolaDocument> =>
      new VideolaDocument(
        await createTemplateBackend(template, answers, {
          ...template.project.settings,
          width,
          height,
          fps: { numerator: fps, denominator: 1 },
        }),
      );

    const landscape = await at(1920, 1080, 30);
    const portrait = await at(1080, 1920, 25);

    expect(portrait.state.settings.width).toBe(1080);
    expect(portrait.state.settings.fps).toEqual({ numerator: 25, denominator: 1 });
    // Flicks, so another rate cannot shift a single edge.
    expect(clips(portrait).map((clip) => [clip.start, clip.duration])).toEqual(
      clips(landscape).map((clip) => [clip.start, clip.duration]),
    );
    // But the fit does change: a landscape shot has to grow to cover an upright frame.
    expect(clips(portrait)[0]!.transform.scaleX).toBeGreaterThan(
      clips(landscape)[0]!.transform.scaleX,
    );
  });

  it("hands back a document that edits and undoes like any other", async () => {
    const template = await named("three-shots");
    const doc = new VideolaDocument(
      await createTemplateBackend(
        template,
        answersFor(template, () => asset("wide", 1920, 1080, 30)),
      ),
    );

    // Nothing to undo yet: the bake is where the project came from, not a step it took.
    expect(doc.canUndo).toBe(false);
    const before = clips(doc).length;
    doc.dispatch({ type: "clip.remove", clip: clips(doc)[0]!.id });
    expect(clips(doc)).toHaveLength(before - 1);
    doc.undo();
    expect(clips(doc)).toHaveLength(before);
  });

  it("refuses material too short for the slot rather than freezing a frame", async () => {
    const template = await named("three-shots");

    await expect(
      createTemplateBackend(
        template,
        answersFor(template, () => asset("blink", 1920, 1080, 0.2)),
      ),
    ).rejects.toThrow();
  });

  it("refuses a template whose bindings were edited between handing it out and taking it back", async () => {
    const template = await named("three-shots");
    const tampered: Template = {
      ...template,
      manifest: {
        ...template.manifest,
        slots: template.manifest.slots.map((slot) =>
          slot.kind === "media"
            ? {
                ...slot,
                bindings: [{ target: "clipMedia", clip: "clp_ghost", fit: fitOf(slot) }],
              }
            : slot,
        ),
      },
    };

    await expect(
      createTemplateBackend(tampered, answersFor(tampered, () => asset("wide", 1920, 1080, 30))),
    ).rejects.toThrow();
  });
});

describe("saving a project as a template", () => {
  it("comes back as a template that bakes with different material", async () => {
    const doc = new VideolaDocument(await createWasmBackend());
    const original = asset("original", 1280, 720, 20);
    doc.dispatch({ type: "media.import", asset: original });
    doc.dispatch({ type: "track.add", kind: "video", name: "V1", index: null });
    const track = doc.state.timeline.tracks[0]!.id;
    doc.dispatch({
      type: "clip.add",
      track,
      source: { kind: "media", media: original.id },
      start: 0,
      duration: 4 * SECOND,
    });

    const bytes = doc.saveAsTemplate(
      {
        appVersion: "0.0.0-test",
        created: "2026-08-08T10:00:00Z",
        modified: "2026-08-08T10:00:00Z",
        locale: "de",
      },
      "mine",
    );
    const template = await readTemplateFile(bytes);

    // The recipe travels, the footage does not.
    expect(template.project.library).toEqual([]);
    expect(template.manifest.slots.filter((slot) => slot.kind === "media")).toHaveLength(1);

    const replacement = asset("replacement", 640, 480, 20);
    const baked = new VideolaDocument(
      await createTemplateBackend(template, answersFor(template, () => replacement)),
    );

    expect(clips(baked)[0]?.source).toEqual({ kind: "media", media: replacement.id });
    expect(clips(baked)[0]?.duration).toBe(4 * SECOND);
  });

  it("does not mistake an ordinary project file for a template", async () => {
    const doc = new VideolaDocument(await createWasmBackend());
    const bytes = doc.save(
      {
        appVersion: "0.0.0-test",
        created: "2026-08-08T10:00:00Z",
        modified: "2026-08-08T10:00:00Z",
        locale: "de",
      },
      new Map(),
    );

    await expect(readTemplateFile(bytes)).rejects.toThrow();
  });
});

function clipsOf(template: Template): Clip[] {
  return template.project.timeline.tracks.flatMap((track) => track.clips);
}

function fitOf(slot: Slot): { mode: "cover"; x: number; y: number; width: number; height: number } {
  const binding = slot.bindings.find((entry) => entry.target === "clipMedia");
  if (binding?.target !== "clipMedia") throw new Error("no media binding");
  return binding.fit as { mode: "cover"; x: number; y: number; width: number; height: number };
}
