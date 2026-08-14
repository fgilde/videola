import { defineConfig, type DefaultTheme } from "vitepress";

const REPO = "https://github.com/fgilde/videola";

// The footer links the owner asked for. `message` and `copyright` are rendered as HTML, so the
// anchors live here rather than needing a theme slot. Both marks are served from public/ rather
// than from their own sites, so a page load never reaches a third party.
const GILDE_ICON = '<img src="/videola/gilde-icon.webp" alt="" width="16" height="16">';

const link = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;

const footerMessage = (licence: string) =>
  `${licence} · ${link("https://www.gilde.org", `${GILDE_ICON}www.gilde.org`)}`;

const COPYRIGHT = `Copyright © 2026 ${link("https://florian.gilde.org", "Florian Gilde")}`;

function sidebar(prefix: string, text: string, items: [string, string][]): DefaultTheme.Sidebar {
  return [{ text, items: items.map(([label, slug]) => ({ text: label, link: `${prefix}/guide/${slug}` })) }];
}

const CHAPTERS: [string, string][] = [
  ["Getting started", "getting-started"],
  ["What Videola does", "features"],
  ["Editing", "editing"],
  ["Templates", "templates"],
  ["Architecture", "architecture"],
  ["Exporting", "exporting"],
  ["The .videola format", "videola-format"],
  ["Commands and undo", "commands-and-undo"],
  ["The API and the MCP server", "api-and-mcp"],
  ["Effects and transitions", "effects-and-transitions"],
  ["Audio", "audio"],
  ["Running it yourself", "self-hosting"],
  ["Building and releasing", "building-and-releasing"],
  ["Design documents", "design-documents"],
];

const KAPITEL: [string, string][] = [
  ["Einstieg", "getting-started"],
  ["Was Videola kann", "features"],
  ["Schneiden", "editing"],
  ["Vorlagen", "templates"],
  ["Architektur", "architecture"],
  ["Exportieren", "exporting"],
  ["Das .videola-Format", "videola-format"],
  ["Commands und Undo", "commands-and-undo"],
  ["Die API und der MCP-Server", "api-and-mcp"],
  ["Effekte und Übergänge", "effects-and-transitions"],
  ["Ton", "audio"],
  ["Selbst betreiben", "self-hosting"],
  ["Bauen und Ausliefern", "building-and-releasing"],
  ["Design-Dokumente", "design-documents"],
];

export default defineConfig({
  // Served from https://videola.app/ -- its own domain, so the site is at the root. It was under
  // /videola/ while it lived on github.io, and every stylesheet and every link carried that prefix:
  // a base left behind after a domain change is a site with no CSS and links one directory too deep.
  // segment in front of it; without it the CSS and JS bundles resolve against the user page
  // root and 404.
  base: "/",
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
          { text: "Features", link: "/guide/features" },
          { text: "Documentation", link: "/guide/getting-started" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "Downloads", link: "/download" },
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
          { text: "Funktionen", link: "/de/guide/features" },
          { text: "Dokumentation", link: "/de/guide/getting-started" },
          { text: "Architektur", link: "/de/guide/architecture" },
          { text: "Downloads", link: "/de/download" },
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
