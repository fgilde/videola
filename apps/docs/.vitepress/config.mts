import { defineConfig, type DefaultTheme } from "vitepress";

const REPO = "https://github.com/fgilde/videola";

// The footer link the owner asked for. `message` and `copyright` are rendered as HTML, so the mark
// is written out here rather than needing a theme slot -- and inline rather than as an <img>,
// because a file in a tag cannot be drawn on: the two strokes carry `pathLength="1"`, and the
// stylesheet walks a dash along them. The artwork is gilde.org's own, served from public/ so a page
// load never reaches a third party.
const GILDE_MARK = `<svg class="gilde-mark" viewBox="0 0 512 512" width="20" height="20" aria-hidden="true" focusable="false">
  <defs><linearGradient id="gildeGold" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffe6a8"/><stop offset="0.45" stop-color="#e0a24e"/><stop offset="1" stop-color="#a9761f"/>
  </linearGradient></defs>
  <g fill="none" stroke="url(#gildeGold)" stroke-width="56" stroke-linecap="square" stroke-linejoin="miter">
    <path pathLength="1" d="M376 88H112v264l144 112 144-112v-96H280"/>
    <path pathLength="1" d="M280 216h120"/>
  </g>
</svg>`;

const link = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`;

// The licence used to lead this line. It belongs in the repository and on the licence page, not
// under every page of a guide: what a reader wants at the bottom of a page is who made the thing.
const FOOTER = link("https://www.gilde.org", `${GILDE_MARK}<span>gilde.org</span>`);

const COPYRIGHT = `Copyright © 2026 ${link("https://florian.gilde.org", "Florian Gilde")}`;

function sidebar(prefix: string, text: string, items: [string, string][]): DefaultTheme.Sidebar {
  return [{ text, items: items.map(([label, slug]) => ({ text: label, link: `${prefix}/guide/${slug}` })) }];
}

const CHAPTERS: [string, string][] = [
  ["Getting started", "getting-started"],
  ["What Videola does", "features"],
  ["Editing", "editing"],
  ["Templates", "templates"],
  ["From a raw clip to the channel", "channel-recipe"],
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
  ["What is planned", "roadmap"],
];

const KAPITEL: [string, string][] = [
  ["Einstieg", "getting-started"],
  ["Was Videola kann", "features"],
  ["Schneiden", "editing"],
  ["Vorlagen", "templates"],
  ["Vom rohen Clip auf den Kanal", "channel-recipe"],
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
  ["Was geplant ist", "roadmap"],
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

  // The two gilde.org widgets are custom elements, and Vue has to be told so -- otherwise it
  // resolves <gilde-contact> as a component nobody registered and warns on every build.
  vue: {
    template: { compilerOptions: { isCustomElement: (tag: string) => tag.startsWith("gilde-") } },
  },

  head: [
    // Without the leading path of the old github.io address, which is where this had been pointing
    // since the site moved to its own domain -- a favicon nobody ever saw.
    ["link", { rel: "icon", type: "image/png", href: "/videola-icon.png" }],
    ["link", { rel: "apple-touch-icon", href: "/videola-icon.png" }],
    ["meta", { name: "theme-color", content: "#050609" }],
    // What defines those elements. A module tag, so it loads without blocking the page.
    ["script", { type: "module", src: "https://connect.gilde.org/widgets/v1.js" }],
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
          message: FOOTER,
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
          message: FOOTER,
          copyright: COPYRIGHT,
        },
      },
    },
  },
});
