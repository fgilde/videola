<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useData } from "vitepress";

/**
 * Writing to whoever made this, and supporting it: gilde.org's own two widgets.
 *
 * `inline` draws them into the page, which is what a section at the foot of the home page wants;
 * without it each is a button that opens its own dialogue, which is what a sidebar wants. The two
 * differ in exactly two switches -- a widget standing in a page is already under a heading that
 * says what it is, so a description and a footer of its own would say it twice.
 */
const props = withDefaults(defineProps<{ inline?: boolean }>(), { inline: false });

const { lang } = useData();
const language = computed(() => lang.value.slice(0, 2));
const german = computed(() => language.value === "de");

const contactTitle = computed(() => (german.value ? "Kontakt" : "Contact"));
const supportTitle = computed(() => (german.value ? "Videola unterstützen" : "Support Videola"));
const heading = computed(() => (german.value ? "Kontakt & Unterstützen" : "Contact & support"));
const intro = computed(() =>
  german.value
    ? "Schreib uns, wenn etwas fehlt oder klemmt — oder unterstütze die Arbeit an Videola."
    : "Write to us when something is missing or in the way — or support the work on Videola.",
);

// The site's own accent, read off the page rather than written down here: the stylesheet owns that
// colour, and a second copy of it in this file is the copy that stays behind when it changes.
const accent = ref("#5b8cff");
onMounted(() => {
  const found = getComputedStyle(document.documentElement)
    .getPropertyValue("--vp-c-brand-3")
    .trim();
  if (found !== "") accent.value = found;
});

const shown = computed(() => (props.inline ? "false" : "true"));
</script>

<template>
  <section class="connect" :class="{ 'connect--inline': props.inline }">
    <template v-if="props.inline">
      <h2>{{ heading }}</h2>
      <p>{{ intro }}</p>
    </template>

    <div class="connect__widgets">
      <gilde-contact
        project="fgilde/videola"
        widget="contact"
        :inline.attr="props.inline ? '' : null"
        theme="dark"
        :accent.attr="accent"
        :language.attr="language"
        :title.attr="contactTitle"
        width="540"
        radius="18"
        padding="24"
        show-logo="true"
        :show-description.attr="shown"
        show-homepage="true"
        show-preview-notice="false"
        :show-footer.attr="shown"
        footer-brand="Videola"
        footer-tagline="gilde.org"
        >{{ contactTitle }}</gilde-contact
      >

      <gilde-support
        project="fgilde/videola"
        widget="support"
        :inline.attr="props.inline ? '' : null"
        theme="dark"
        :accent.attr="accent"
        :language.attr="language"
        :title.attr="supportTitle"
        width="540"
        radius="18"
        padding="24"
        show-logo="true"
        :show-description.attr="shown"
        show-homepage="true"
        show-preview-notice="false"
        :show-footer.attr="shown"
        footer-brand="Videola"
        footer-tagline="gilde.org"
        show-support-hint="false"
        support-layout="rows"
        show-support-icons="true"
        show-support-qr="true"
        >{{ supportTitle }}</gilde-support
      >
    </div>
  </section>
</template>

<style scoped>
.connect {
  display: grid;
  gap: 12px;
}

/* The section on the home page, in the same container the features stand in. */
.connect--inline {
  max-width: 1152px;
  margin: 64px auto 0;
  padding: 0 24px;
}

.connect--inline h2 {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  border: 0;
}

.connect--inline p {
  margin: 0;
  color: var(--vp-c-text-2);
}

.connect__widgets {
  display: grid;
  gap: 20px;
  margin-top: 12px;
  align-items: start;
}

/* Side by side once there is room for two cards, stacked before that. */
@media (min-width: 860px) {
  .connect--inline .connect__widgets {
    grid-template-columns: 1fr 1fr;
  }
}

/* A custom element is inline by default, which in a grid cell leaves a gap nobody put there. */
.connect__widgets gilde-contact,
.connect__widgets gilde-support {
  display: block;
  max-width: 100%;
}

/* In the sidebar the two are buttons, and a sidebar is narrow. */
.connect:not(.connect--inline) {
  margin: 16px 0 24px;
  padding-top: 16px;
  border-top: 1px solid var(--vp-c-divider);
}

.connect:not(.connect--inline) .connect__widgets {
  gap: 8px;
  margin-top: 0;
}
</style>
