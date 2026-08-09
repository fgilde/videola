import { consumedSource } from "@videola/core";
import type { Clip, Frame, Localized, Project, Slot, Template, Time } from "@videola/core";

import type { Locale } from "../i18n/useI18n";
import { projectEnd } from "../timeline/geometry";

// A template brings its own words: it can come from a file this build has never seen, so its name
// cannot be a catalogue key.
export function localized(text: Localized, locale: Locale): string {
  return locale === "de" ? text.de : text.en;
}

// The order the gallery lists categories in: roughly the order someone works, from the opening of a
// film to the thing it is selling. A category this build has never heard of -- one that arrived on
// a file -- lands after these rather than being hidden, because a template nobody can find is the
// same as a template that failed to load.
export const CATEGORY_ORDER = ["intro", "slideshow", "social", "titles", "product"];

export function categoriesOf(templates: readonly Template[]): string[] {
  const present = [...new Set(templates.map((entry) => entry.manifest.category))];
  return [
    ...CATEGORY_ORDER.filter((category) => present.includes(category)),
    ...present.filter((category) => !CATEGORY_ORDER.includes(category)),
  ];
}

// The shape a card is drawn in: the first frame the template offers, because that is the one its
// preview is rendered at and the one it was authored for. An upright template gets an upright card,
// which is half of what someone is choosing between.
export function templateFrame(template: Template): Frame {
  return (
    template.manifest.aspectRatios[0] ?? {
      width: template.project.settings.width,
      height: template.project.settings.height,
    }
  );
}

export interface TemplateBlock {
  clip: string;
  track: number;
  left: number;
  width: number;
  dissolve: boolean;
}

// The gallery's picture of a template is the timeline it will actually build -- read straight off
// the project the bake starts from, so the card cannot show a rhythm the result does not have.
// A rendered preview would need footage, and no shipped template carries any.
export function templateBlocks(template: Template): TemplateBlock[] {
  const total = templateDuration(template);
  if (total <= 0) return [];
  return template.project.timeline.tracks.flatMap((track, index) =>
    track.clips.map((clip) => ({
      clip: clip.id,
      track: index,
      left: clip.start / total,
      width: clip.duration / total,
      dissolve: clip.transitionIn != null,
    })),
  );
}

export function templateDuration(template: Template): Time {
  return projectEnd(template.project);
}

// How much material a slot reads at the far end of its longest clip -- `Clip::out_point()` in the
// core, which is the number bake measures a file against. Stated as a recommendation rather than a
// gate: the core decides what it will refuse, and repeating that rule here would be a second
// authority to keep in step.
export function slotNeeds(template: Template, slot: Slot): Time {
  let needed = 0;
  for (const binding of slot.bindings) {
    if (binding.target !== "clipMedia") continue;
    const clip = findClip(template.project, binding.clip);
    if (clip === undefined) continue;
    needed = Math.max(needed, clip.inPoint + consumedSource(clip));
  }
  return needed;
}

function findClip(project: Project, id: string): Clip | undefined {
  return project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);
}
