import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";

import Connect from "./Connect.vue";
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
      // Under the chapter list rather than under every page: two buttons at the foot of the
      // navigation are there when somebody wants a person, and out of the way while they read.
      "sidebar-nav-after": () => h(Connect),
    }),
  enhanceApp({ app }) {
    // Registered globally so a Markdown page can place it with one tag. The download list is the one
    // thing on this site that cannot be written down: which files exist is a fact about the latest
    // release, and a page that spelled them out would go on offering last spring's build.
    app.component("Downloads", Downloads);
    // Placed by the home pages with one tag, the way the download list is.
    app.component("Connect", Connect);
  },
} satisfies Theme;
