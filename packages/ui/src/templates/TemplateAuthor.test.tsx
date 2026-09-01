import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Project } from "@videola/core";

import { I18nProvider } from "../i18n/I18nProvider";
import { TemplateAuthor, elementsOf } from "./TemplateAuthor";

const SECOND = 705_600_000;

function project(): Project {
  return {
    meta: { id: "prj_1", title: "Mein Film", tags: [] },
    settings: { width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 }, background: "#000000" },
    library: [
      { id: "med_intro", originalName: "intro.mp4", kind: "video", duration: 2 * SECOND },
      { id: "med_shot", originalName: "urlaub.mp4", kind: "video", duration: 8 * SECOND },
    ],
    timeline: {
      tracks: [
        {
          id: "trk_1",
          kind: "video",
          name: "V1",
          clips: [
            clip("clp_intro", { kind: "media", media: "med_intro" }),
            clip("clp_shot", { kind: "media", media: "med_shot" }),
            clip("clp_title", {
              kind: "generator",
              generator: { type: "text", content: "Sommer 2026\nzweite Zeile", style: {} },
            }),
            clip("clp_field", { kind: "generator", generator: { type: "solid", color: "#112233" } }),
          ],
        },
      ],
      markers: [],
    },
  } as unknown as Project;
}

function clip(id: string, source: unknown): unknown {
  return {
    id,
    source,
    start: 0,
    duration: 2 * SECOND,
    inPoint: 0,
    effects: [],
    keyframes: {},
    transform: {},
    speed: { rate: 1, reverse: false, preservePitch: true },
    volume: 1,
    enabled: true,
  };
}

interface Saved {
  marked: readonly string[];
  fixed: readonly string[];
  name: string;
}

function show(): { saved: Saved[] } {
  const saved: Saved[] = [];
  render(
    <I18nProvider>
      <TemplateAuthor
        project={project()}
        onSave={(marked, fixed, name) => saved.push({ marked: [...marked], fixed: [...fixed], name })}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
  return { saved };
}

const box = (clip: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-clip="${clip}"]`)!;

describe("the template author", () => {
  // The list is what somebody decides over, so it has to name things the way the timeline does.
  it("lists every element a template could ask about, by what it is", () => {
    show();

    const rows = [...document.querySelectorAll(".v-author__row")].map((row) => row.textContent);

    expect(rows[0]).toContain("intro.mp4");
    expect(rows[1]).toContain("urlaub.mp4");
    // The first line of the title, not both: a row is a line.
    expect(rows[2]).toContain("Sommer 2026");
    expect(rows[2]).not.toContain("zweite Zeile");
    expect(rows[3]).toContain("#112233");
  });

  // What somebody making a template out of a finished edit almost always means, and no more than
  // that: a colour that becomes a question is a question about a design nobody asked to change.
  it("starts with the media and the words asked for and the colours kept", () => {
    show();

    expect(box("clp_intro").checked).toBe(true);
    expect(box("clp_shot").checked).toBe(true);
    expect(box("clp_title").checked).toBe(true);
    expect(box("clp_field").checked).toBe(false);
  });

  it("hands over exactly what is ticked, and the name typed beside it", () => {
    const { saved } = show();

    // The intro is part of the recipe: unticked, so it travels inside the template with its file.
    fireEvent.click(box("clp_intro"));
    fireEvent.change(screen.getByTestId("author-name"), { target: { value: "Reise-Vorlage" } });
    fireEvent.click(screen.getByTestId("author-save"));

    expect(saved).toHaveLength(1);
    expect([...saved[0]!.marked].sort()).toEqual(["clp_shot", "clp_title"]);
    expect(saved[0]!.name).toBe("Reise-Vorlage");
  });

  // The question that makes a template a template rather than a template for one particular video:
  // how long the shot somebody drops in is allowed to be. Only asked about a shot, and only about one
  // that is a question at all.
  it("asks about the length of a shot, and only of a shot", () => {
    show();

    expect(document.querySelector('[data-length="clp_shot"]')).toBeTruthy();
    expect(document.querySelector('[data-length="clp_title"]')).toBeNull();
    expect(document.querySelector('[data-length="clp_field"]')).toBeNull();

    // Not a question, not a length: unticking the shot takes the row with it.
    fireEvent.click(box("clp_shot"));
    expect(document.querySelector('[data-length="clp_shot"]')).toBeNull();
  });

  it("lets the material decide by default, and takes a fixed length when asked", () => {
    const { saved } = show();

    fireEvent.change(screen.getByTestId("author-name"), { target: { value: "Reise" } });
    fireEvent.click(screen.getByTestId("author-save"));
    expect(saved[0]?.fixed).toEqual([]);

    fireEvent.change(document.querySelector('[data-length="clp_intro"]')!, {
      target: { value: "fixed" },
    });
    fireEvent.click(screen.getByTestId("author-save"));
    expect(saved[1]?.fixed).toEqual(["clp_intro"]);
    // And the other shot still follows its material.
    expect(saved[1]?.marked).toContain("clp_shot");
  });

  // Every row says in words what the tick means, because a checkbox on its own says "on" and the
  // question here is "asked for or kept" -- two states nobody guesses from a tick.
  it("says on every row what will happen to it", () => {
    show();

    expect(document.querySelector('[data-clip="clp_shot"]')?.closest(".v-author__row")?.textContent)
      .toContain("wird gefragt");
    expect(document.querySelector('[data-clip="clp_field"]')?.closest(".v-author__row")?.textContent)
      .toContain("bleibt drin");
  });

  // A compound has no slot kind that could stand in for it, so offering it would be offering a
  // switch that does nothing.
  it("leaves out what no slot could replace", () => {
    const withCompound = project();
    (withCompound.timeline.tracks[0]!.clips as unknown[]).push(
      clip("clp_nested", { kind: "compound", timeline: { tracks: [], markers: [] } }),
    );

    expect(elementsOf(withCompound, "de").map((entry) => entry.clip)).toEqual([
      "clp_intro",
      "clp_shot",
      "clp_title",
      "clp_field",
    ]);
  });
});
