import type { Clip, Localized, Project, Slot, Template, Time } from "@videola/core";

import type { Locale } from "../i18n/useI18n";
import { projectEnd } from "../timeline/geometry";

// A template brings its own words: it can come from a file this build has never seen, so its name
// cannot be a catalogue key.
export function localized(text: Localized, locale: Locale): string {
  return locale === "de" ? text.de : text.en;
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
    needed = Math.max(needed, clip.inPoint + Math.round(clip.duration * clip.speed.rate));
  }
  return needed;
}

function findClip(project: Project, id: string): Clip | undefined {
  return project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);
}
