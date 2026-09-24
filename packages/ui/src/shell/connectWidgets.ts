/**
 * The two gilde.org widgets: a way to write to whoever made this, and a way to support it.
 *
 * They are custom elements served from connect.gilde.org, which is the one thing in this editor
 * that would reach another machine -- so the script is fetched when somebody opens the dialogue and
 * never before. An editor that has not been asked for it makes no request, which is the promise the
 * rest of the application keeps.
 */
const SCRIPT = "https://connect.gilde.org/widgets/v1.js";

export const CONNECT_PROJECT = "fgilde/videola";

/** Loads the widget script once. Safe to call on every open: the second call finds it there. */
export function loadWidgets(): void {
  if (document.querySelector(`script[data-gilde-widgets]`) !== null) return;
  const tag = document.createElement("script");
  tag.type = "module";
  tag.src = SCRIPT;
  tag.dataset.gildeWidgets = "";
  document.head.append(tag);
}

/**
 * The accent the surface is wearing, so the widget is part of it rather than a visitor.
 *
 * Read off the document rather than written down here: the theme owns that colour, and a second
 * copy of it in this file is the copy that stays behind when the theme changes.
 */
export function accentColour(fallback = "#5b8cff"): string {
  if (typeof getComputedStyle !== "function") return fallback;
  const found = getComputedStyle(document.documentElement).getPropertyValue("--v-accent").trim();
  return found === "" ? fallback : found;
}

/**
 * What every widget is given, whether it is drawn in place or behind a button.
 *
 * The two shapes differ in exactly two attributes, and they differ for a reason: a widget drawn
 * into a panel already stands under a heading that says what it is, so a description and a footer
 * of its own would say it twice. A button opens a dialogue with nothing else in it, and there both
 * belong.
 */
export function widgetAttributes(options: {
  widget: "contact" | "support";
  inline: boolean;
  language: string;
  accent: string;
  title: string;
}): Record<string, string> {
  const shown = options.inline ? "false" : "true";
  return {
    project: CONNECT_PROJECT,
    widget: options.widget,
    ...(options.inline ? { inline: "" } : {}),
    theme: "dark",
    accent: options.accent,
    language: options.language,
    title: options.title,
    width: "540",
    radius: "18",
    padding: "24",
    "show-logo": "true",
    "show-description": shown,
    "show-homepage": "true",
    "show-preview-notice": "false",
    "show-footer": shown,
    "footer-brand": "Videola",
    "footer-tagline": "gilde.org",
    ...(options.widget === "support"
      ? {
          "show-support-hint": "false",
          "support-layout": "rows",
          "show-support-icons": "true",
          "show-support-qr": "true",
        }
      : {}),
  };
}
