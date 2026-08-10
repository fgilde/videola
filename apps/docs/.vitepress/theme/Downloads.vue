<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

const props = defineProps<{ lang: "de" | "en" }>();

// The one place the platform roster lives. Each entry knows how to spot its own asset in a release
// by the tail of the file name, because that is what the Tauri bundler decides and not this page.
interface Platform {
  id: string;
  name: string;
  note: { de: string; en: string };
  /** Matched against the asset name, lower-cased. The first hit wins. */
  suffixes: readonly string[];
  /** True where this platform is the one asking. */
  detect: (agent: string, platform: string) => boolean;
}

const PLATFORMS: readonly Platform[] = [
  {
    id: "windows",
    name: "Windows",
    note: { de: "Installer, 64 Bit", en: "Installer, 64-bit" },
    suffixes: ["-setup.exe", ".msi"],
    detect: (agent, platform) => /win/i.test(platform) || /windows/i.test(agent),
  },
  {
    id: "macos",
    name: "macOS",
    note: { de: "Apple Silicon, unsigniert", en: "Apple Silicon, unsigned" },
    suffixes: [".dmg"],
    detect: (agent, platform) => /mac/i.test(platform) || /mac os x/i.test(agent),
  },
  {
    id: "linux-appimage",
    name: "Linux · AppImage",
    note: { de: "Läuft ohne Installation", en: "Runs without installing" },
    suffixes: [".appimage"],
    detect: (agent, platform) => /linux/i.test(platform) && !/android/i.test(agent),
  },
  {
    id: "linux-deb",
    name: "Linux · .deb",
    note: { de: "Debian und Ubuntu", en: "Debian and Ubuntu" },
    suffixes: [".deb"],
    detect: () => false,
  },
  {
    id: "android",
    name: "Android",
    note: { de: "APK, nur mit Signaturschlüssel gebaut", en: "APK, built only where a signing key exists" },
    suffixes: [".apk"],
    detect: (agent) => /android/i.test(agent),
  },
  {
    id: "ios",
    name: "iOS",
    note: { de: "IPA, nur mit Zertifikat gebaut", en: "IPA, built only where a certificate exists" },
    suffixes: [".ipa"],
    detect: (agent) => /iphone|ipad|ipod/i.test(agent),
  },
];

const TEXT = {
  de: {
    suggested: "Für dein System",
    others: "Andere Systeme",
    unavailable: "In dieser Ausgabe nicht enthalten",
    unavailableWhy: "Diese Datei entsteht nur, wenn der Signaturschlüssel gesetzt ist.",
    browser: "Oder im Browser bleiben",
    browserBody:
      "Videola läuft vollständig im Browser: Projekte liegen in der Ablage des Browsers, nichts wird hochgeladen. Der Editor ist derselbe.",
    loading: "Aktuelle Ausgabe wird gelesen …",
    failed: "Die Liste der Dateien war nicht erreichbar.",
    failedLink: "Zu den Releases auf GitHub",
    version: "Ausgabe",
    get: "Herunterladen",
    all: "Alle Dateien und Anmerkungen zu dieser Ausgabe",
    docker: "Selbst hosten",
    dockerBody: "Ein Node-Prozess liefert Editor, HTTP-Schnittstelle und MCP-Server.",
  },
  en: {
    suggested: "For your system",
    others: "Other systems",
    unavailable: "Not part of this release",
    unavailableWhy: "This file is built only where the signing key is set.",
    browser: "Or stay in the browser",
    browserBody:
      "Videola runs entirely in the browser: projects live in the browser's own storage and nothing is uploaded. The editor is the same one.",
    loading: "Reading the current release …",
    failed: "The file list could not be reached.",
    failedLink: "Releases on GitHub",
    version: "Release",
    get: "Download",
    all: "Every file and the notes for this release",
    docker: "Self-hosting",
    dockerBody: "One Node process serves the editor, the HTTP API and the MCP server.",
  },
} as const;

const REPO = "https://github.com/fgilde/videola";

interface Asset {
  name: string;
  url: string;
  bytes: number;
}

const assets = ref<Asset[] | undefined>(undefined);
const version = ref<string | undefined>(undefined);
const failed = ref(false);
const mine = ref<string | undefined>(undefined);
const t = computed(() => TEXT[props.lang]);

// Read once, on the client. The release is not baked into the page: a page built in March would go
// on offering March's files months after the fact, and a version number in the source is a number
// somebody has to remember to change.
onMounted(async () => {
  mine.value = detectPlatform();
  try {
    const response = await fetch("https://api.github.com/repos/fgilde/videola/releases/latest");
    if (!response.ok) throw new Error(String(response.status));
    const release = (await response.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string; size: number }[];
    };
    version.value = release.tag_name;
    assets.value = release.assets.map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      bytes: asset.size,
    }));
  } catch {
    failed.value = true;
  }
});

function detectPlatform(): string | undefined {
  const agent = navigator.userAgent;
  const platform = navigator.platform ?? "";
  return PLATFORMS.find((entry) => entry.detect(agent, platform))?.id;
}

function assetFor(platform: Platform): Asset | undefined {
  return assets.value?.find((asset) =>
    platform.suffixes.some((suffix) => asset.name.toLowerCase().endsWith(suffix)),
  );
}

const suggested = computed(() => PLATFORMS.find((entry) => entry.id === mine.value));
const others = computed(() => PLATFORMS.filter((entry) => entry.id !== mine.value));

// In the reader's own notation: a German page writes 7,3 and an English one 7.3, and a number that
// gets that wrong is the first thing on the page that reads as machine-made.
const megabytes = (bytes: number): string =>
  `${(bytes / 1_000_000).toLocaleString(props.lang === "de" ? "de-DE" : "en-GB", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MB`;
</script>

<template>
  <section class="dl">
    <p v-if="failed" class="dl__note">
      {{ t.failed }}
      <a :href="`${REPO}/releases`" target="_blank" rel="noreferrer">{{ t.failedLink }}</a>
    </p>
    <p v-else-if="assets === undefined" class="dl__note">{{ t.loading }}</p>

    <template v-if="suggested !== undefined">
      <h2 class="dl__heading">{{ t.suggested }}</h2>
      <a
        v-if="assetFor(suggested) !== undefined"
        class="dl__primary"
        :href="assetFor(suggested)!.url"
        :data-platform="suggested.id"
      >
        <span class="dl__primaryName">{{ suggested.name }}</span>
        <span class="dl__primaryMeta">
          {{ suggested.note[props.lang] }} · {{ megabytes(assetFor(suggested)!.bytes) }}
        </span>
      </a>
      <p v-else class="dl__note">{{ t.unavailable }} — {{ t.unavailableWhy }}</p>
    </template>

    <h2 class="dl__heading">{{ suggested === undefined ? t.suggested : t.others }}</h2>
    <ul class="dl__grid">
      <li v-for="platform of others" :key="platform.id" class="dl__card" :data-platform="platform.id">
        <span class="dl__cardName">{{ platform.name }}</span>
        <span class="dl__cardNote">{{ platform.note[props.lang] }}</span>
        <a v-if="assetFor(platform) !== undefined" class="dl__cardLink" :href="assetFor(platform)!.url">
          {{ t.get }} · {{ megabytes(assetFor(platform)!.bytes) }}
        </a>
        <span v-else class="dl__cardMissing">{{ t.unavailable }}</span>
      </li>
    </ul>

    <p class="dl__note">
      <a :href="version === undefined ? `${REPO}/releases` : `${REPO}/releases/tag/${version}`" target="_blank" rel="noreferrer">
        {{ t.all }}<template v-if="version !== undefined"> ({{ t.version }} {{ version }})</template>
      </a>
    </p>

    <div class="dl__pair">
      <section class="dl__aside">
        <h2 class="dl__heading">{{ t.browser }}</h2>
        <p>{{ t.browserBody }}</p>
      </section>
      <section class="dl__aside">
        <h2 class="dl__heading">{{ t.docker }}</h2>
        <p>{{ t.dockerBody }}</p>
        <pre><code>docker run --rm -p 8080:7331 ghcr.io/fgilde/videola:latest</code></pre>
      </section>
    </div>
  </section>
</template>

<style scoped>
.dl {
  margin-top: 2rem;
}

.dl__heading {
  margin: 2rem 0 0.75rem;
  padding-top: 0;
  border-top: none;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--vp-c-text-1);
}

.dl__heading:first-child {
  margin-top: 0;
}

/* The one the visitor almost certainly wants, at the size that says so.

   The fill is the site's own gradient and it does not change on hover. It used to go to
   --vp-c-brand-2, which is #7d9bff -- white type on that is about 2.3:1, so the label all but
   vanished under the pointer. What hover changes instead is the light around the button: a glow, a
   brighter edge and a sheen that travels across it once. Nothing that touches the contrast of the
   text, because a button says what it is at every moment a pointer is over it. */
.dl__primary {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 1.1rem 1.4rem;
  border-radius: 12px;
  border: 1px solid rgb(255 255 255 / 0.16);
  background: var(--v-gradient);
  color: #ffffff;
  text-decoration: none;
  box-shadow: 0 2px 10px -4px rgb(0 0 0 / 0.6);
  transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}

/* The sheen. Parked off the left edge and sent across on hover: one pass, not a loop, so it reads as
   a highlight catching the surface rather than as something demanding attention. */
.dl__primary::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(
    100deg,
    transparent 20%,
    rgb(255 255 255 / 0.22) 45%,
    transparent 70%
  );
  transform: translateX(-120%);
  transition: transform 0.6s ease;
}

.dl__primary:hover,
.dl__primary:focus-visible {
  transform: translateY(-2px);
  border-color: rgb(255 255 255 / 0.55);
  box-shadow:
    0 10px 30px -8px var(--v-blue),
    0 0 0 3px rgb(91 140 255 / 0.28);
}

.dl__primary:hover::after,
.dl__primary:focus-visible::after {
  transform: translateX(120%);
}

/* A glow is a decoration and a travel is a movement: whoever asked for less of the second keeps the
   first, because the contrast of the label never depended on either. */
@media (prefers-reduced-motion: reduce) {
  .dl__primary,
  .dl__primary::after {
    transition: none;
  }

  .dl__primary:hover,
  .dl__primary:focus-visible {
    transform: none;
  }

  .dl__primary:hover::after,
  .dl__primary:focus-visible::after {
    transform: translateX(-120%);
  }
}

.dl__primaryName {
  font-size: 1.25rem;
  font-weight: 700;
}

.dl__primaryMeta {
  font-size: 0.85rem;
  opacity: 0.85;
}

.dl__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dl__card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}

.dl__cardName {
  font-weight: 600;
}

.dl__cardNote,
.dl__cardMissing {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}

.dl__cardLink {
  margin-top: 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.dl__note {
  margin: 1rem 0 0;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}

.dl__pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1.5rem;
  margin-top: 2.5rem;
}

.dl__aside p {
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
}

.dl__aside pre {
  overflow-x: auto;
}
</style>
