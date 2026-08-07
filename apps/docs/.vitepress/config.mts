import { defineConfig } from "vitepress";

// Served from https://fgilde.github.io/videola/, so every asset URL needs the repository
// segment in front of it; without it the CSS and JS bundles resolve against the user page
// root and 404.
export default defineConfig({
  base: "/videola/",
  lang: "en-GB",
  title: "Videola",
  description: "A browser-based video editor built on a Rust core. Early: core and shell only.",
  cleanUrls: true,
  lastUpdated: true,
  head: [["link", { rel: "icon", href: "/videola/favicon.svg" }]],
  themeConfig: {
    nav: [
      { text: "Documentation", link: "/guide/getting-started" },
      { text: "Architecture", link: "/guide/architecture" },
      { text: "Downloads", link: "https://github.com/fgilde/videola/releases" },
    ],
    sidebar: [
      {
        text: "Documentation",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Architecture", link: "/guide/architecture" },
          { text: "The .videola format", link: "/guide/videola-format" },
          { text: "Commands and undo", link: "/guide/commands-and-undo" },
          { text: "Building and releasing", link: "/guide/building-and-releasing" },
          { text: "Design documents", link: "/guide/design-documents" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/fgilde/videola" }],
    editLink: {
      pattern: "https://github.com/fgilde/videola/edit/main/apps/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "GPL-3.0-or-later",
      copyright: "Copyright © 2026 Florian Gilde",
    },
  },
});
