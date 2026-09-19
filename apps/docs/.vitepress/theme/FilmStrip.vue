<script setup lang="ts">
import { ref } from "vue";

/**
 * The hero's film strip: the editor's own screenshots, on a reel, seen at an angle.
 *
 * Every frame on it is a picture the browser harness took of the running application, which is the
 * only kind of screenshot this project ships — a strip of invented mock-ups under a headline about
 * a video editor would be the first lie on the page.
 *
 * CSS 3D rather than a canvas library: a reel that tilts, drifts and catches the light costs a
 * transform and two keyframes here, and a WebGL scene would cost half a megabyte of JavaScript
 * before the first paint. It stops on hover and it does not move at all for somebody who asked
 * their system for less motion.
 */
const FRAMES = [
  { src: "/editor-desktop.webp", alt: "" },
  { src: "/editor-effects.webp", alt: "" },
  { src: "/editor-templates.webp", alt: "" },
  { src: "/editor-import.webp", alt: "" },
  { src: "/editor-destinations.webp", alt: "" },
  { src: "/editor-tablet.webp", alt: "" },
];

// Twice through, so the reel can loop by translating exactly its own first half.
const reel = [...FRAMES, ...FRAMES];

const stage = ref<HTMLElement>();

/**
 * The reel leans towards the pointer.
 *
 * Two degrees of it, written to a custom property the transform already reads -- the drift keeps
 * running, and what the pointer changes is the angle it is seen from. Only where there is a
 * pointer that hovers: a finger has no hover to lean with, and a strip that tilted under a thumb
 * would be a strip that fights the scroll.
 */
function lean(event: PointerEvent): void {
  const host = stage.value;
  if (host === undefined || event.pointerType !== "mouse") return;
  const box = host.getBoundingClientRect();
  const across = (event.clientX - box.left) / box.width - 0.5;
  const down = (event.clientY - box.top) / box.height - 0.5;
  host.style.setProperty("--lean-y", `${(across * 4).toFixed(2)}deg`);
  host.style.setProperty("--lean-x", `${(16 - down * 5).toFixed(2)}deg`);
}

function settle(): void {
  stage.value?.style.removeProperty("--lean-y");
  stage.value?.style.removeProperty("--lean-x");
}
</script>

<template>
  <div class="strip" aria-hidden="true" @pointermove="lean" @pointerleave="settle">
    <div ref="stage" class="strip__stage">
      <div class="strip__reel">
        <figure v-for="(frame, index) in reel" :key="index" class="strip__frame">
          <img :src="frame.src" :alt="frame.alt" loading="lazy" decoding="async" />
        </figure>
      </div>
    </div>
  </div>
</template>

<style scoped>
.strip {
  /* Full width, out of the hero's column: a reel that stopped at the text margin would read as an
     illustration rather than as film running past. */
  position: relative;
  margin: 1rem calc(50% - 50vw) 0;
  padding: 3.5rem 0 4.5rem;
  overflow: hidden;
  /* Fades at both ends, so the reel arrives from somewhere and leaves for somewhere. */
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.strip__stage {
  --lean-x: 16deg;
  --lean-y: -1.6deg;
  perspective: 1400px;
  perspective-origin: 50% 40%;
}

.strip__reel {
  display: flex;
  gap: 1.25rem;
  width: max-content;
  padding: 0.9rem 0;
  transform: rotateX(var(--lean-x)) rotateZ(var(--lean-y));
  transform-style: preserve-3d;
  transition: transform 0.4s ease-out;
  animation: run 64s linear infinite;
  /* The sprocket rails. Two repeating gradients rather than an image: they take the page's own
     colours, so the strip is the same material as the site around it. */
  background:
    repeating-linear-gradient(
        90deg,
        rgb(147 170 255 / 0.5) 0 8px,
        transparent 8px 26px
      )
      0 0 / 100% 7px no-repeat,
    repeating-linear-gradient(
        90deg,
        rgb(147 170 255 / 0.5) 0 8px,
        transparent 8px 26px
      )
      0 100% / 100% 7px no-repeat,
    linear-gradient(180deg, #0c0f18, #05070c);
  border-block: 1px solid rgb(147 170 255 / 0.22);
}

.strip:hover .strip__reel {
  animation-play-state: paused;
}

.strip__frame {
  margin: 0;
  flex: 0 0 auto;
  width: 22rem;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgb(147 170 255 / 0.25);
  box-shadow:
    0 1.5rem 3rem rgb(0 0 0 / 0.6),
    0 0 0 1px rgb(5 6 9 / 0.9);
  transform: translateZ(28px);
}

.strip__frame img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  /* The middle of the window rather than the top of it: a strip of nothing but menu bars says
     less about an editor than the picture under them does. */
  object-position: center 30%;
}

/* Half the reel is the second copy of the same frames, so translating by exactly that much lands
   on the frame it started from and the loop has no seam. */
@keyframes run {
  from {
    transform: rotateX(var(--lean-x)) rotateZ(var(--lean-y)) translate3d(0, 0, 0);
  }
  to {
    transform: rotateX(var(--lean-x)) rotateZ(var(--lean-y))
      translate3d(calc(-50% - 0.625rem), 0, 0);
  }
}

@media (max-width: 960px) {
  .strip {
    padding: 2rem 0 2.5rem;
  }

  .strip__frame {
    width: 15rem;
  }

  .strip__stage {
    --lean-x: 10deg;
    --lean-y: 0deg;
  }

  .strip__reel {
    animation-duration: 48s;
  }
}

/* A lamp passing over the film. Slow, faint and behind nothing: it is the one thing on this page
   that says "projector" without a picture of one. */
.strip::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    transparent 35%,
    rgb(160 72 248 / 0.12) 48%,
    rgb(91 140 255 / 0.14) 52%,
    transparent 65%
  );
  background-size: 250% 100%;
  animation: sweep 11s ease-in-out infinite;
}

@keyframes sweep {
  0%,
  100% {
    background-position: 130% 0;
  }
  50% {
    background-position: -30% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .strip__reel {
    animation: none;
    transition: none;
  }

  .strip::after {
    animation: none;
    opacity: 0.4;
  }
}
</style>
