import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FLICKS_PER_SECOND } from "@videola/core";
import type { MediaAsset, SlotAnswer, Template } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { TemplateGallery } from "./TemplateGallery";
import { slotNeeds, templateBlocks, templateDuration } from "./outline";
import { TemplateWizard } from "./TemplateWizard";

const SECOND = FLICKS_PER_SECOND;

// A template of the shape the core actually ships: two clips on one track, the second dissolving
// into the first, one media slot filling both, and a title and a colour behind one step.
function template(overrides: Partial<Template["manifest"]> = {}): Template {
  return {
    manifest: {
      schemaVersion: 1,
      id: "twofold",
      version: 1,
      name: { de: "Zweimal", en: "Twofold" },
      description: { de: "Beschreibung", en: "Description" },
      category: "montage",
      tags: [],
      aspectRatios: [
        { width: 1920, height: 1080 },
        { width: 1080, height: 1920 },
      ],
      slots: [
        {
          id: "shot",
          kind: "media",
          label: { de: "Aufnahme", en: "Shot" },
          hint: { de: "Ein Video", en: "A video" },
          required: true,
          bindings: [
            { target: "clipMedia", clip: "clp_a", fit: fit() },
            { target: "clipMedia", clip: "clp_b", fit: fit() },
          ],
        },
        {
          id: "title",
          kind: "text",
          label: { de: "Titel", en: "Title" },
          hint: { de: "Benennt", en: "Names" },
          required: false,
          bindings: [{ target: "projectTitle" }],
        },
        {
          id: "color",
          kind: "color",
          label: { de: "Farbe", en: "Colour" },
          hint: { de: "Hinten", en: "Behind" },
          required: false,
          bindings: [{ target: "background" }],
        },
      ],
      steps: [
        { title: { de: "Material", en: "Footage" }, slots: ["shot"] },
        { title: { de: "Feinschliff", en: "Finishing" }, slots: ["title", "color"] },
      ],
      ...overrides,
    },
    project: {
      schemaVersion: 1,
      meta: { id: "prj_t", title: "", tags: [] },
      settings: {
        width: 1920,
        height: 1080,
        fps: { numerator: 30, denominator: 1 },
        sampleRate: 48000,
        audioChannels: 2,
        colorSpace: "srgb",
        background: "#101820",
      },
      library: [],
      timeline: {
        tracks: [
          {
            id: "trk_a",
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
            effects: [],
            clips: [clip("clp_a", 0, 2 * SECOND), clip("clp_b", 1.5 * SECOND, 2 * SECOND, true)],
          },
        ],
      },
      markers: [],
      master: { volume: 1, effects: [] },
    },
  } as Template;
}

function fit(): { mode: "cover"; x: number; y: number; width: number; height: number } {
  return { mode: "cover", x: 0, y: 0, width: 1, height: 1 };
}

function clip(id: string, start: number, duration: number, dissolve = false): unknown {
  return {
    id,
    source: { kind: "media", media: "med_placeholder" },
    start,
    duration,
    inPoint: 0,
    speed: { rate: 1, reverse: false, preservePitch: true },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 1,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
    blend: "normal",
    fades: { inDuration: 0, outDuration: 0 },
    volume: 1,
    pan: 0,
    effects: [],
    keyframes: {},
    ...(dissolve
      ? {
          transitionIn: {
            transitionType: "crossfade",
            duration: 0.5 * SECOND,
            alignment: "in",
            params: {},
          },
        }
      : {}),
  };
}

function asset(name: string, seconds: number): MediaAsset {
  return {
    id: `med_${name}`,
    originalName: `${name}.mp4`,
    mime: "video/mp4",
    kind: "video",
    sizeBytes: 1000n,
    duration: seconds * SECOND,
    width: 1920,
    height: 1080,
  } as MediaAsset;
}

describe("the outline a gallery card draws", () => {
  it("measures the template it will build, not the clips in isolation", () => {
    // Two two-second clips overlapping by half a second: 3.5 s, not 4.
    expect(templateDuration(template())).toBe(3.5 * SECOND);
  });

  it("places every clip as a fraction of the whole and marks the dissolve", () => {
    const blocks = templateBlocks(template());

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ left: 0, width: 2 / 3.5, dissolve: false });
    expect(blocks[1]).toMatchObject({ left: 1.5 / 3.5, width: 2 / 3.5, dissolve: true });
  });

  it("says how much material a slot with two clips needs, not how much one of them does", () => {
    const shot = template().manifest.slots[0]!;

    expect(slotNeeds(template(), shot)).toBe(2 * SECOND);
  });

  it("reads the slot's own speed rather than assuming normal playback", () => {
    const slowed = template();
    slowed.project.timeline.tracks[0]!.clips[0]!.speed.rate = 2;

    expect(slotNeeds(slowed, slowed.manifest.slots[0]!)).toBe(4 * SECOND);
  });
});

function card(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-template-id="${id}"]`);
  if (found === null) throw new Error(`no card ${id}`);
  return found;
}

function chip(category: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-category="${category}"]`);
  if (found === null) throw new Error(`no chip ${category}`);
  return found;
}

function showGallery(overrides: Partial<Parameters<typeof TemplateGallery>[0]> = {}): {
  chosen: Template[];
  opened: File[];
} {
  const chosen: Template[] = [];
  const opened: File[] = [];
  render(
    <I18nProvider>
      <TemplateGallery
        templates={[template()]}
        onChoose={(entry) => chosen.push(entry)}
        onOpenTemplate={(file) => opened.push(file)}
        onClose={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { chosen, opened };
}

describe("TemplateGallery", () => {
  it("shows what the template is and how long it runs", () => {
    showGallery();

    expect(screen.getByText("Zweimal")).toBeTruthy();
    expect(screen.getByText("Beschreibung")).toBeTruthy();
    // 3.5 s and three placeholders, both read off the template rather than written down.
    expect(screen.getByText("3,5 s")).toBeTruthy();
    expect(screen.getByText("3 Platzhalter")).toBeTruthy();
  });

  it("draws one block per clip so a card cannot look busier than the result", () => {
    showGallery();

    const blocks = document.querySelectorAll(".v-template__block");
    expect(blocks).toHaveLength(2);
    expect((blocks[1] as HTMLElement).style.left).toBe(`${(1.5 / 3.5) * 100}%`);
  });

  it("hands the chosen template out whole", () => {
    const { chosen } = showGallery();

    fireEvent.click(card("twofold"));

    expect(chosen).toEqual([template()]);
  });

  // The card is the control. A picture with a button under it makes the largest thing on the
  // screen the one part that does nothing, and hands a phone the smallest target on the card.
  it("makes the whole card the thing that is clicked", () => {
    showGallery();

    expect(card("twofold").tagName).toBe("BUTTON");
    expect(card("twofold").querySelector(".v-template__poster")).toBeTruthy();
  });

  it("shows the rendered still where there is one, and the outline where there is not", () => {
    showGallery({ posters: { twofold: "blob:a-still" } });

    const still = card("twofold").querySelector<HTMLImageElement>(".v-template__still");
    expect(still?.src).toBe("blob:a-still");
    expect(card("twofold").querySelector(".v-template__block")).toBeNull();
  });

  // The box has to hold the template's shape before its picture arrives, or the grid reflows under
  // the pointer the moment a still lands and a click goes to the wrong card.
  it("keeps the template's own shape whether or not the picture is there yet", () => {
    showGallery();

    const box = card("twofold").querySelector<HTMLElement>(".v-template__poster");
    expect(box?.style.aspectRatio).toBe("1920 / 1080");
  });

  // The shape it offers first, not the shape it happens to have been authored at -- that is the
  // frame its picture is rendered in, and an upright template has to look upright on the card.
  it("takes its shape from the frame it offers first, not from the project behind it", () => {
    showGallery({
      templates: [
        template({
          aspectRatios: [
            { width: 1080, height: 1920 },
            { width: 1920, height: 1080 },
          ],
        }),
      ],
    });

    const box = card("twofold").querySelector<HTMLElement>(".v-template__poster");
    expect(box?.style.aspectRatio).toBe("1080 / 1920");
  });

  it("filters by category and says so when a category is empty", () => {
    const other = template({ id: "other", category: "intro", name: { de: "Auftakt", en: "Open" } });
    render(
      <I18nProvider>
        <TemplateGallery
          templates={[template(), other]}
          onChoose={vi.fn()}
          onOpenTemplate={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(document.querySelectorAll("[data-template-id]")).toHaveLength(2);

    fireEvent.click(chip("intro"));

    const left = [...document.querySelectorAll("[data-template-id]")];
    expect(left.map((entry) => entry.getAttribute("data-template-id"))).toEqual(["other"]);
    expect(screen.queryByTestId("template-none")).toBeNull();
  });

  // A category this build has no word for still needs a chip, or the template under it cannot be
  // found at all. The raw key is a worse label than a translation and a far better one than none.
  it("gives a category it has never heard of a chip under its own name", () => {
    showGallery();

    expect(chip("montage").textContent).toBe("montage");
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");
  });

  it("offers saving the current project only when there is one to save", () => {
    showGallery();
    expect(screen.queryByText("Projekt als Vorlage speichern")).toBeNull();

    showGallery({ onSaveCurrent: vi.fn() });
    expect(screen.getByText("Projekt als Vorlage speichern")).toBeTruthy();
  });
});

interface WizardResult {
  finished: { answers: Record<string, unknown>; frame: { width: number; height: number } }[];
  picked: [string, File][];
}

function showWizard(
  media: Record<string, MediaAsset> = {},
  overrides: Partial<Parameters<typeof TemplateWizard>[0]> = {},
): WizardResult {
  const finished: WizardResult["finished"] = [];
  const picked: [string, File][] = [];
  render(
    <I18nProvider>
      <TemplateWizard
        template={template()}
        media={media}
        onPickMedia={(slot, file) => picked.push([slot, file])}
        onFinish={(answers, frame) => finished.push({ answers: { ...answers }, frame })}
        onBack={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { finished, picked };
}

function frameSelect(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>(".v-templates__row select");
  if (select === null) throw new Error("no frame select");
  return select;
}

function next(): void {
  fireEvent.click(screen.getByText("Weiter"));
}

describe("TemplateWizard", () => {
  it("asks one step at a time, in the template's own order", () => {
    showWizard({ shot: asset("chosen", 10) });

    expect(screen.getByRole("status").textContent).toContain("Schritt 1 von 2");
    expect(screen.getByText("Aufnahme")).toBeTruthy();
    expect(screen.queryByText("Titel")).toBeNull();

    next();

    expect(screen.getByRole("status").textContent).toContain("Schritt 2 von 2");
    expect(document.querySelector("[data-slot-id='title']")).toBeTruthy();
  });

  it("will not move on while a required slot is empty", () => {
    showWizard();

    expect(screen.getByText("Weiter").closest("button")?.disabled).toBe(true);
  });

  it("moves on once the required slot has material", () => {
    showWizard({ shot: asset("chosen", 10) });

    expect(screen.getByText("Weiter").closest("button")?.disabled).toBe(false);
    expect(document.querySelector("[data-chosen='shot']")?.textContent).toContain("chosen.mp4");
  });

  it("says how much material the slot needs before a file is chosen", () => {
    showWizard();

    expect(screen.getByText("Braucht mindestens 2 s Material.")).toBeTruthy();
  });

  it("hands a chosen file up with the slot it belongs to", () => {
    const { picked } = showWizard();
    const file = new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" });

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    fireEvent.change(input, { target: { files: [file] } });

    expect(picked).toEqual([["shot", file]]);
  });

  // The whole point of the wizard, and the assertion a "a project came out" test would miss: the
  // answers that reach bake have to be the ones that were typed.
  it("carries every answer and the chosen frame into the finish", () => {
    const material = asset("chosen", 10);
    const { finished } = showWizard({ shot: material });

    next();
    fireEvent.change(screen.getByDisplayValue("Zweimal"), { target: { value: "Mein Film" } });
    fireEvent.change(document.querySelector('input[type="color"]')!, {
      target: { value: "#1188ff" },
    });
    fireEvent.change(frameSelect(), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Projekt erstellen"));

    expect(finished).toEqual([
      {
        answers: {
          shot: { kind: "media", asset: material },
          title: { kind: "text", text: "Mein Film" },
          color: { kind: "color", color: "#1188ff" },
        },
        frame: { width: 1080, height: 1920 },
      },
    ]);
  });

  // The other answer to the last step: the same result added to the edit already open. It carries the
  // same answers as the finish, because the two differ in where the result goes and in nothing else.
  it("offers inserting into an open project, with the answers the finish would have carried", () => {
    const inserted: Record<string, SlotAnswer>[] = [];
    const material = asset("chosen", 10);
    showWizard({ shot: material }, { onInsert: (answers) => inserted.push({ ...answers }) });

    next();
    fireEvent.change(screen.getByDisplayValue("Zweimal"), { target: { value: "Mein Film" } });
    fireEvent.click(screen.getByText("Als Spuren einfügen"));

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.shot).toEqual({ kind: "media", asset: material });
    expect(inserted[0]?.title).toEqual({ kind: "text", text: "Mein Film" });
  });

  // A session with nothing open has nowhere to insert into: the first thing a template does there is
  // become the project.
  it("says nothing about inserting where there is no project to insert into", () => {
    showWizard({ shot: asset("chosen", 10) });

    next();

    expect(screen.queryByText("Als Spuren einfügen")).toBeNull();
  });

  it("defaults the title to the template's name and the colour to its background", () => {
    const { finished } = showWizard({ shot: asset("chosen", 10) });

    next();
    fireEvent.click(screen.getByText("Projekt erstellen"));

    expect(finished[0]?.answers.title).toEqual({ kind: "text", text: "Zweimal" });
    expect(finished[0]?.answers.color).toEqual({ kind: "color", color: "#101820" });
  });

  // An emptied optional answer must not be sent: writing "" would replace the template's own
  // value with nothing, which is a different thing from leaving the slot alone.
  it("leaves an emptied optional answer out instead of writing nothing over it", () => {
    const { finished } = showWizard({ shot: asset("chosen", 10) });

    next();
    fireEvent.change(screen.getByDisplayValue("Zweimal"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Projekt erstellen"));

    expect(finished[0]?.answers.title).toBeUndefined();
    expect(finished[0]?.answers.shot).toBeDefined();
  });

  // React 19 swallows a throw out of an event handler, so a broken handler looks like a working
  // one unless the window is listened to.
  it("reports nothing to the window while it is being filled in", () => {
    const reported: unknown[] = [];
    const onError = (event: Event): void => {
      reported.push(event);
    };
    window.addEventListener("error", onError);
    showWizard({ shot: asset("chosen", 10) });

    next();
    fireEvent.change(screen.getByDisplayValue("Zweimal"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Zurück"));
    next();
    fireEvent.click(screen.getByText("Projekt erstellen"));
    window.removeEventListener("error", onError);

    expect(reported).toEqual([]);
  });

  // A wizard that asks across several panels and then acts on all of them at once is asking for a
  // decision nobody has been shown. The last panel has to show every answer, including the ones
  // from panels that have left the screen.
  it("shows every answer on the last panel, including the ones from earlier steps", () => {
    showWizard({ shot: asset("chosen", 10) });
    expect(screen.queryByTestId("template-summary")).toBeNull();

    next();
    fireEvent.change(screen.getByDisplayValue("Zweimal"), { target: { value: "Mein Film" } });

    const summary = screen.getByTestId("template-summary");
    expect(summary.querySelector("[data-answer='shot']")?.textContent).toContain("chosen.mp4");
    expect(summary.querySelector("[data-answer='title']")?.textContent).toContain("Mein Film");
    expect(summary.querySelector("[data-answer='color']")?.textContent).toContain("#101820");
  });

  it("says so in the summary when a slot was never filled in", () => {
    render(
      <I18nProvider>
        <TemplateWizard
          template={template({
            steps: [{ title: { de: "Alles", en: "All" }, slots: ["shot", "title", "color"] }],
          })}
          media={{}}
          onPickMedia={vi.fn()}
          onFinish={vi.fn()}
          onBack={vi.fn()}
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const summary = screen.getByTestId("template-summary");
    expect(summary.querySelector("[data-answer='shot']")?.textContent).toContain("nicht gewählt");
  });

  // The rail is what a step count stands in for: how much is left. It has to name every step and
  // mark exactly one as the one you are on.
  it("shows the whole path, with one step marked as the one you are on", () => {
    showWizard({ shot: asset("chosen", 10) });

    const steps = [...screen.getByTestId("template-rail").children];
    expect(steps.map((entry) => entry.textContent)).toEqual(["Material", "Feinschliff"]);
    expect(steps.map((entry) => entry.getAttribute("data-state"))).toEqual(["here", "ahead"]);

    next();

    const after = [...screen.getByTestId("template-rail").children];
    expect(after.map((entry) => entry.getAttribute("data-state"))).toEqual(["done", "here"]);
  });

  it("keeps what was already answered when a step is walked back", () => {
    const { finished } = showWizard({ shot: asset("chosen", 10) });

    next();
    fireEvent.change(screen.getByDisplayValue("Zweimal"), { target: { value: "Bleibt" } });
    fireEvent.click(screen.getByText("Zurück"));
    next();
    fireEvent.click(screen.getByText("Projekt erstellen"));

    expect(finished[0]?.answers.title).toEqual({ kind: "text", text: "Bleibt" });
  });
});
