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
      title: "The picture is the biggest thing on screen",
      text: "Grade on the shot itself: the curve field, the wheels and the three scopes all read the frame under the playhead, and the box on the picture is the clip's real geometry rather than a handle drawn near it.",
    },
    de: {
      title: "Das Bild ist das Größte auf dem Schirm",
      text: "Gradiert wird auf der Aufnahme: Kurvenfeld, Farbräder und die drei Messgeräte lesen das Bild unter dem Playhead, und der Rahmen darauf ist die echte Geometrie des Clips und kein danebengezeichneter Griff.",
    },
  },
  {
    src: "/editor-effects.webp",
    en: {
      title: "Effects you can see before you choose",
      text: "Every tile in the shelf is your own frame with that effect on it, rendered when the shelf opens and thrown away when it closes. A grid of words would make you apply six things to find one.",
    },
    de: {
      title: "Effekte, die man vor der Wahl sieht",
      text: "Jede Kachel im Regal ist das eigene Bild mit diesem Effekt darauf, gerendert beim Öffnen und danach weggeworfen. Ein Raster aus Wörtern hieße, sechs Sachen anzuwenden, um eine zu finden.",
    },
  },
  {
    src: "/editor-templates.webp",
    en: {
      title: "Templates that are generators, not stock footage",
      text: "A lower third, a countdown, a picture-in-picture: each one draws itself from the project's own numbers, so nothing here is somebody else's clip with a licence attached to it.",
    },
    de: {
      title: "Vorlagen sind Generatoren, kein fremdes Material",
      text: "Bauchbinde, Countdown, Bild-im-Bild: Jede zeichnet sich aus den Zahlen des Projekts, also liegt hier nirgends der Clip von jemand anderem mit einer Lizenz daran.",
    },
  },
  {
    src: "/editor-import.webp",
    en: {
      title: "One dialogue, both ways in",
      text: "A file from this machine on the left, a link or a search on the right — codec, format and quality where you can see them. What arrives lands in the library and nowhere else; the timeline is yours to fill.",
    },
    de: {
      title: "Ein Dialog, beide Wege hinein",
      text: "Links eine Datei von hier, rechts ein Link oder eine Suche — Codec, Format und Qualität sichtbar. Was ankommt, geht in die Bibliothek und sonst nirgendwohin; die Zeitleiste füllst du selbst.",
    },
  },
  {
    src: "/editor-destinations.webp",
    en: {
      title: "Eight places to send it",
      text: "YouTube and Vimeo, and the ones that ask nobody's permission: PeerTube on a machine you own, Bluesky with an app password, Mastodon, Telegram, a page, or any URL of your own.",
    },
    de: {
      title: "Acht Orte, an die es gehen kann",
      text: "YouTube und Vimeo — und die, die niemanden um Erlaubnis fragen: PeerTube auf der eigenen Maschine, Bluesky mit App-Passwort, Mastodon, Telegram, eine Seite oder jede eigene Adresse.",
    },
  },
  {
    src: "/editor-phone.webp",
    en: {
      title: "The phone is the same editor",
      text: "Not a viewer and not a second implementation: the same pointer path, with every target grown to 44 px because the pointer is a finger.",
    },
    de: {
      title: "Das Telefon ist derselbe Editor",
      text: "Kein Betrachter und keine zweite Umsetzung: derselbe Zeigerweg, mit jedem Ziel auf 44 px gewachsen, weil der Zeiger ein Finger ist.",
    },
  },
];

const german = computed(() => lang.value.startsWith("de"));
const heading = computed(() =>
  german.value ? "Was dabei herauskommt" : "What it actually looks like",
);
const note = computed(() =>
  german.value
    ? "Jedes Bild hier stammt aus dem Browser-Prüflauf, der dieselbe Oberfläche vermisst. Handgemachte Screenshots veralten; diese können es nicht."
    : "Every picture here was taken by the browser harness while it measured that same surface. Hand-made screenshots drift out of date; these cannot.",
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
