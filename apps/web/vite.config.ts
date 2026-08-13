import { readFileSync } from "node:fs";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One source for the version, and it is the one the release is cut from: the desktop build's own
// manifest, which is also what the installers and the deployment files are checked against. Read at
// build time and compiled in, because the editor stamps it into every `.videola` it writes and shows
// it in the about dialogue -- a hand-kept constant in the source was two releases behind.
const { version } = JSON.parse(
  readFileSync(new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { target: "es2022" },
  define: { __VIDEOLA_VERSION__: JSON.stringify(version) },
});
