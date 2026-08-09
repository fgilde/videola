import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The pictures in the guide come out of the application harness and nowhere else. Hand-made
// screenshots drift: the run that writes these is the same one that measures the layout, so a
// picture in the guide cannot show an editor the checks never saw.
//
// ffmpeg does the encoding because the export harness already demands it. Nothing else is
// installed for this, and a lossy still at quality 82 is a tenth of the PNG.
const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "web", "browser");
const to = join(here, "public");

const SHOTS = {
  "preview.png": "editor-desktop.webp",
  "templates.png": "editor-templates.webp",
  "effects.png": "editor-effects.webp",
  "tablet.png": "editor-tablet.webp",
  "phone.png": "editor-phone.webp",
  "phone-library.png": "editor-phone-library.webp",
  "phone-inspector.png": "editor-phone-inspector.webp",
};

const missing = Object.keys(SHOTS).filter((name) => !existsSync(join(from, name)));
if (missing.length > 0) {
  throw new Error(
    `no screenshots to publish (${missing.join(", ")}) -- run \`pnpm --filter videola-web test:browser\` first`,
  );
}

for (const [png, webp] of Object.entries(SHOTS)) {
  const source = join(from, png);
  const target = join(to, webp);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", source, "-quality", "82", target]);
  const shrunk = Math.round((1 - statSync(target).size / statSync(source).size) * 100);
  console.log(`${webp}  ${statSync(target).size} bytes, ${shrunk}% off the PNG`);
}
