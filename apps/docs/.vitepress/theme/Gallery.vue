<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";

/**
 * What it looks like, in the pictures the checks took.
 *
 * Under the feature cards, because the cards are claims and these are the evidence: every image
 * here was written by the browser harness while it was measuring the thing in the picture. The
 * captions say what is worth looking at rather than repeating the heading above them.
 */
const { lang } = useData();

interface Shot {
  src: string;
  wide?: boolean;
  en: { title: string; text: string };
  de: { title: string; text: string };
}

const SHOTS: Shot[] = [
  {
    src: "/editor-desktop.webp",
    wide: true,
    en: {
      title: "Colour, with the scopes right there",
      text: "Curves, colour wheels and your own LUTs, and a waveform, vectorscope and histogram that follow the frame you are on. The box on the picture is the clip itself — drag it, scale it, turn it.",
    },
    de: {
      title: "Farbe machen, mit den Messgeräten daneben",
      text: "Kurven, Farbräder und eigene LUTs, dazu Waveform, Vektorskop und Histogramm, die immer das Bild unter dem Playhead zeigen. Der Rahmen im Bild ist der Clip selbst: verschieben, skalieren, drehen.",
    },
  },
  {
    src: "/editor-effects.webp",
    en: {
      title: "Pick an effect by looking at it",
      text: "Every tile shows your own frame with that effect applied. Sixteen effects, seven transitions, and you can put a transition on every cut at once.",
    },
    de: {
      title: "Effekte aussuchen, indem man sie ansieht",
      text: "Jede Kachel zeigt dein eigenes Bild mit dem Effekt darauf. Sechzehn Effekte, sieben Übergänge — und einen Übergang auf alle Schnitte gleichzeitig legen geht auch.",
    },
  },
  {
    src: "/editor-templates.webp",
    en: {
      title: "Titles and lower thirds, ready to go",
      text: "Fifteen templates: lower thirds, countdowns, picture-in-picture, end cards. Fill in the text, drop them into the project as their own tracks, undo in one press if you change your mind.",
    },
    de: {
      title: "Titel und Bauchbinden, fertig zum Einsetzen",
      text: "Fünfzehn Vorlagen: Bauchbinden, Countdowns, Bild-im-Bild, Abspanne. Text eintragen, als eigene Spuren ins Projekt legen, und ein Rückgängig nimmt alles wieder zurück.",
    },
  },
  {
    src: "/editor-import.webp",
    en: {
      title: "Your files, or a video from the web",
      text: "Drag files in on the left. On the right, paste a link or search — YouTube, Vimeo, TikTok and most other sites — and choose the format and quality before it downloads.",
    },
    de: {
      title: "Eigene Dateien oder ein Video aus dem Netz",
      text: "Links Dateien hineinziehen. Rechts einen Link einfügen oder suchen — YouTube, Vimeo, TikTok und die meisten anderen Seiten — und vorher Format und Qualität wählen.",
    },
  },
  {
    src: "/editor-destinations.webp",
    en: {
      title: "Upload straight from the editor",
      text: "Set up a channel once, then send finished videos there with one press: YouTube, Vimeo, PeerTube, Mastodon, Bluesky, Telegram, a Facebook page or any address of your own.",
    },
    de: {
      title: "Hochladen direkt aus dem Editor",
      text: "Einen Kanal einmal einrichten, danach geht das fertige Video mit einem Druck dorthin: YouTube, Vimeo, PeerTube, Mastodon, Bluesky, Telegram, eine Facebook-Seite oder eine eigene Adresse.",
    },
  },
  {
    src: "/editor-phone.webp",
    en: {
      title: "The same editor on a phone",
      text: "Not a viewer and not a cut-down version: the same app, with every button grown to a size you can actually hit with a thumb.",
    },
    de: {
      title: "Derselbe Editor auf dem Telefon",
      text: "Kein Betrachter und keine abgespeckte Fassung: dieselbe App, nur mit Knöpfen in einer Größe, die man mit dem Daumen auch trifft.",
    },
  },
];

const german = computed(() => lang.value.startsWith("de"));
const heading = computed(() =>
  german.value ? "So sieht das aus" : "Here is what it looks like",
);
const note = computed(() =>
  german.value
    ? "Alle Bilder kommen direkt aus den automatischen Tests, die den Editor bedienen — sie zeigen also immer den aktuellen Stand."
    : "All of these come straight out of the automated tests that drive the editor, so they always show the current build.",
);
</script>

<template>
  <section class="gallery">
    <div class="gallery__head">
      <h2>{{ heading }}</h2>
      <p>{{ note }}</p>
    </div>
    <div class="gallery__grid">
      <figure
        v-for="shot in SHOTS"
        :key="shot.src"
        class="gallery__shot"
        :class="{ 'gallery__shot--wide': shot.wide }"
      >
        <img :src="shot.src" alt="" loading="lazy" decoding="async" />
        <figcaption>
          <strong>{{ german ? shot.de.title : shot.en.title }}</strong>
          <span>{{ german ? shot.de.text : shot.en.text }}</span>
        </figcaption>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.gallery {
  max-width: 1152px;
  margin: 1rem auto 5rem;
  padding: 0 24px;
}

.gallery__head h2 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.6rem, 1.2rem + 1.4vw, 2.2rem);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.gallery__head p {
  margin: 0 0 2rem;
  max-width: 44rem;
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

.gallery__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.5rem;
}

.gallery__shot {
  margin: 0;
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  /* A shot lifts a little towards the pointer. Two degrees, not ten: this is a page about an
     editor, and a card that flips over is a card nobody reads the caption of. */
  transition:
    transform 0.35s ease,
    border-color 0.35s ease,
    box-shadow 0.35s ease;
}

.gallery__shot:hover {
  transform: perspective(900px) rotateX(1.5deg) translateY(-4px);
  border-color: rgb(147 170 255 / 0.45);
  box-shadow: 0 1.5rem 3rem rgb(0 0 0 / 0.5);
}

.gallery__shot--wide {
  grid-column: 1 / -1;
}

.gallery__shot img {
  display: block;
  width: 100%;
  border-bottom: 1px solid var(--vp-c-divider);
}

.gallery__shot figcaption {
  display: grid;
  gap: 0.4rem;
  padding: 1.1rem 1.25rem 1.35rem;
}

.gallery__shot figcaption strong {
  font-weight: 600;
}

.gallery__shot figcaption span {
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.65;
}

@media (max-width: 860px) {
  .gallery__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gallery__shot,
  .gallery__shot:hover {
    transform: none;
    transition: border-color 0.2s ease;
  }
}
</style>
