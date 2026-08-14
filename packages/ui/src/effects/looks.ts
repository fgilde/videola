import type { Locale } from "../i18n/useI18n";

export interface Look {
  id: string;
  name: Record<Locale, string>;
  /** Effect ids from the registry, in the order they go on the chain. */
  effects: readonly string[];
}

/**
 * Named arrangements of the effects that already exist.
 *
 * Twenty-three effects are unusable by somebody who does not know what "posterize" means. A look is the
 * same effects picked and ordered by somebody who does — one press, three entries on the chain, one
 * step of history. Every id here is checked against the registry by a test, because a look naming an
 * effect that has been renamed would add two of three and say nothing.
 *
 * Order matters and is the reason this is a list rather than a set: the chain runs top to bottom, so a
 * grain laid on before a fade is a fade over grain, and the grain comes out of it soft. Grain last,
 * always — it is the film, not the picture.
 */
export const LOOKS: readonly Look[] = [
  {
    id: "vintage",
    name: { de: "Vintage", en: "Vintage" },
    effects: ["film-look", "vignette", "grain"],
  },
  {
    id: "cinema",
    name: { de: "Kino", en: "Cinema" },
    effects: ["contrast", "temperature", "vignette"],
  },
  {
    id: "summer",
    name: { de: "Sommer", en: "Summer" },
    effects: ["saturation", "temperature", "glow"],
  },
  {
    id: "night",
    name: { de: "Nacht", en: "Night" },
    effects: ["brightness", "temperature", "grain"],
  },
  {
    id: "noir",
    name: { de: "Schwarzweiß-Film", en: "Film noir" },
    effects: ["monochrome", "contrast", "vignette", "grain"],
  },
  {
    id: "dream",
    name: { de: "Traum", en: "Dream" },
    effects: ["glow", "film-look", "blur"],
  },
  {
    id: "comic",
    name: { de: "Comic", en: "Comic" },
    effects: ["posterize", "saturation", "sharpen"],
  },
  {
    id: "vhs",
    name: { de: "VHS", en: "VHS" },
    effects: ["rgb-split", "grain", "film-look"],
  },
];
