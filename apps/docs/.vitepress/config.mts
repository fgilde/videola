import { defineConfig, type DefaultTheme } from "vitepress";

const REPO = "https://github.com/fgilde/videola";

// The footer links the owner asked for. `message` and `copyright` are rendered as HTML, so the
// anchors live here rather than needing a theme slot. The Audiola mark is inlined rather than
// pulled from audiola.de, because a remote favicon would make every page load reach a third party.
const AUDIOLA_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor" ' +
  'style="vertical-align:-2px;margin-right:.35em">' +
  '<path d="M6 2.5v7.2a2.3 2.3 0 1 0 1.4 2.1V5.4l5.1-1.2v4.3a2.3 2.3 0 1 0 1.4 2.1V1l-7.9 1.5Z"/></svg>';

const link = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;

const footerMessage = (licence: string) =>
  `${licence} · ${link("https://www.gilde.org", "www.gilde.org")} · ` +
  link("https://www.audiola.de", `${AUDIOLA_ICON}www.audiola.de`);

const COPYRIGHT = `Copyright © 2026 ${link("https://florian.gilde.org", "Florian Gilde")}`;

function sidebar(prefix: string, text: string, items: [string, string][]): DefaultTheme.Sidebar {
  return [{ text, items: items.map(([label, slug]) => ({ text: label, link: `${prefix}/guide/${slug}` })) }];
}

const CHAPTERS: [string, string][] = [
  ["Getting started", "getting-started"],
  ["Editing", "editing"],
  ["Architecture", "architecture"],
  ["The .videola format", "videola-format"],
  ["Commands and undo", "commands-and-undo"],
  ["Effects and transitions", "effects-and-transitions"],
  ["Building and releasing", "building-and-releasing"],
  ["Design documents", "design-documents"],
];

const KAPITEL: [string, string][] = [
  ["Einstieg", "getting-started"],
  ["Schneiden", "editing"],
  ["Architektur", "architecture"],
  ["Das .videola-Format", "videola-format"],
  ["Commands und Undo", "commands-and-undo"],
  ["Effekte und Übergänge", "effects-and-transitions"],
  ["Bauen und Ausliefern", "building-and-releasing"],
  ["Design-Dokumente", "design-documents"],
];

export default defineConfig({
  // Served from https://fgilde.github.io/videola/, so every asset URL needs the repository
  // segment in front of it; without it the CSS and JS bundles resolve against the user page
  // root and 404.
  base: "/videola/",
  title: "Videola",
  cleanUrls: true,
  lastUpdated: true,

  // The wordmark and the icon ship with their own near-black ground baked in, so on a light page
  // they would sit in a dark rectangle. Forcing the dark scheme keeps the brand intact instead of
  // matting the assets or maintaining a second set of them.
  appearance: "force-dark",

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/videola/videola-icon.png" }],
    ["meta", { name: "theme-color", content: "#050609" }],
  ],

  themeConfig: {
    logo: "/videola-icon.png",
    socialLinks: [{ icon: "github", link: REPO }],
    search: {
      provider: "local",
      options: {
        locales: {
          de: {
            translations: {
              button: { buttonText: "Suchen", buttonAriaLabel: "Suchen" },
              modal: {
                displayDetails: "Details anzeigen",
                resetButtonTitle: "Suche zurücksetzen",
                noResultsText: "Keine Ergebnisse für",
                footer: {
                  selectText: "auswählen",
                  navigateText: "navigieren",
                  closeText: "schließen",
                },
              },
            },
          },
        },
      },
    },
  },

  locales: {
    root: {
      label: "English",
      lang: "en-GB",
      description: "A browser-based video editor on a Rust core. Import, cut on the timeline and play back; effects and export are still being built.",
      themeConfig: {
        nav: [
          { text: "Documentation", link: "/guide/getting-started" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "Downloads", link: `${REPO}/releases` },
        ],
        sidebar: sidebar("", "Documentation", CHAPTERS),
        editLink: {
          pattern: `${REPO}/edit/main/apps/docs/:path`,
          text: "Edit this page on GitHub",
        },
        lastUpdatedText: "Last updated",
        footer: {
          message: footerMessage("GPL-3.0-or-later"),
          copyright: COPYRIGHT,
        },
      },
    },

    de: {
      label: "Deutsch",
      lang: "de-DE",
      description:
        "Ein Video-Editor im Browser auf einem Rust-Kern. Importieren, auf der Timeline schneiden und abspielen; Effekte und Export entstehen noch.",
      themeConfig: {
        nav: [
          { text: "Dokumentation", link: "/de/guide/getting-started" },
          { text: "Architektur", link: "/de/guide/architecture" },
          { text: "Downloads", link: `${REPO}/releases` },
        ],
        sidebar: sidebar("/de", "Dokumentation", KAPITEL),
        editLink: {
          pattern: `${REPO}/edit/main/apps/docs/:path`,
          text: "Diese Seite auf GitHub bearbeiten",
        },
        lastUpdatedText: "Zuletzt geändert",
        outline: { label: "Auf dieser Seite" },
        docFooter: { prev: "Zurück", next: "Weiter" },
        returnToTopLabel: "Nach oben",
        sidebarMenuLabel: "Kapitel",
        langMenuLabel: "Sprache wechseln",
        footer: {
          message: footerMessage("GPL-3.0-or-later"),
          copyright: COPYRIGHT,
        },
      },
    },
  },
});
