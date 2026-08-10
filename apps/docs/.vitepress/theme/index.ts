import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";

import Downloads from "./Downloads.vue";
import "./custom.css";

// Registered globally so a Markdown page can place it with one tag. The download list is the one
// thing on this site that cannot be written down: which files exist is a fact about the latest
// release, and a page that spelled them out would go on offering last spring's build.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Downloads", Downloads);
  },
} satisfies Theme;
