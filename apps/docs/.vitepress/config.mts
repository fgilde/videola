import { defineConfig, type DefaultTheme } from "vitepress";

const REPO = "https://github.com/fgilde/videola";

// The footer link the owner asked for. `message` is rendered as HTML, so the anchor lives here
// rather than needing a theme slot.
const footerMessage = (licence: string) =>
  `${licence} · <a href="https://www.gilde.org" target="_blank" rel="noreferrer">www.gilde.org</a>`;

function sidebar(prefix: string, text: string, items: [string, string][]): DefaultTheme.Sidebar {
  return [{ text, items: items.map(([label, slug]) => ({ text: label, link: `${prefix}/guide/${slug}` })) }];
}

const CHAPTERS: [string, string][] = [
  ["Getting started", "getting-started"],
  ["Architecture", "architecture"],
  ["Exporting", "exporting"],
  ["The .videola format", "videola-format"],
  ["Commands and undo", "commands-and-undo"],
  ["Building and releasing", "building-and-releasing"],
  ["Design documents", "design-documents"],
];

const KAPITEL: [string, string][] = [
  ["Einstieg", "getting-started"],
  ["Architektur", "architecture"],
  ["Exportieren", "exporting"],
  ["Das .videola-Format", "videola-format"],
  ["Commands und Undo", "commands-and-undo"],
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
      description: "A video editor built on a Rust core. Early: the core and the shell exist.",
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
          copyright: "Copyright © 2026 Florian Gilde",
        },
      },
    },

    de: {
      label: "Deutsch",
      lang: "de-DE",
      description:
        "Ein Video-Editor auf einem Rust-Kern. Noch früh: Kern und Anwendungsrahmen stehen, die Editor-Oberfläche nicht.",
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
          copyright: "Copyright © 2026 Florian Gilde",
        },
      },
    },
  },
});
