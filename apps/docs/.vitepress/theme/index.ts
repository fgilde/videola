import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";

import Downloads from "./Downloads.vue";
import FilmStrip from "./FilmStrip.vue";
import Gallery from "./Gallery.vue";
import "./custom.css";

/**
 * The home page's two extra acts, placed through the default layout's own slots.
 *
 * A slot rather than a whole layout of our own: everything else on this site is documentation and
 * the default theme is good at documentation. What it has no answer for is a landing page that has
 * to look like the thing it is about -- so the reel goes under the hero, and the pictures the
 * checks took go under the feature cards.
 */
export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "home-hero-after": () => h(FilmStrip),
      "home-features-after": () => h(Gallery),
    }),
  enhanceApp({ app }) {
    // Registered globally so a Markdown page can place it with one tag. The download list is the one
    // thing on this site that cannot be written down: which files exist is a fact about the latest
    // release, and a page that spelled them out would go on offering last spring's build.
    app.component("Downloads", Downloads);
  },
} satisfies Theme;
