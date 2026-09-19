import { readStored } from "../storage";
import de from "./catalogs/de.json";
import en from "./catalogs/en.json";
import { translate, type Catalog, type Vars } from "./translate";
import type { Locale } from "./useI18n";

export const LOCALE_KEY = "videola.locale";

export const CATALOGS: Record<Locale, Catalog> = { de, en };

/** Which language this browser is being used in, asked outside React. */
export function readLocale(): Locale {
  const stored = readStored(LOCALE_KEY);
  if (stored === "de" || stored === "en") return stored;
  // English is the fallback because the project's public face - README, release notes, docs
  // site - is English; German is what a German browser asks for, not what everyone else gets.
  return navigator.language.startsWith("de") ? "de" : "en";
}

/**
 * The catalogue for a string that is written into the document rather than drawn from it.
 *
 * A track Videola names itself keeps that name in the file, so the name is settled once, in the
 * language the project was made in, and never translated again -- which is also why this does not
 * go through the provider: the application shell stands above it, and a name is not a rendering.
 */
export function say(key: string, vars?: Vars): string {
  return translate(CATALOGS[readLocale()], key, vars);
}
