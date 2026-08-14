import type { JsonValue } from "@videola/core";

import type { Locale } from "../i18n/useI18n";

export interface TextPreset {
  id: string;
  name: Record<Locale, string>;
  /** The whole style, not a patch: a preset that only sets half a style inherits the other half. */
  style: Readonly<Record<string, JsonValue>>;
}

/**
 * Ready-made titles: a name, and the style that makes it.
 *
 * Data, not code, and that is why there can be a hundred of them. Every field here is one the
 * renderer already reads — colour, weight, tracking, position, box, stroke, shadow, and the movement
 * presets — so a new title is a new entry in this list and nothing else. Nothing is downloaded and
 * nothing is licensed from anybody: the look is arithmetic over a font the system already has.
 *
 * The whole style is written rather than merged, deliberately. A preset that set only the colour would
 * leave the previous preset's tracking and shadow behind, and the second thing somebody tried would
 * come out as neither of the two looks they picked.
 */
export const TEXT_PRESETS: readonly TextPreset[] = [
  {
    id: "plain",
    name: { de: "Klartext", en: "Plain" },
    style: {
      fontSize: 0.075,
      fontWeight: 700,
      color: "#ffffff",
      align: "center",
      y: 0.5,
      maxWidth: 0.8,
      shadowBlur: 0.01,
      shadowY: 0.006,
      shadowColor: "#000000a0",
      animateIn: "fade",
      animateInSeconds: 0.4,
      animateOut: "fade",
      animateOutSeconds: 0.4,
    },
  },
  {
    id: "lower-third",
    name: { de: "Bauchbinde", en: "Lower third" },
    style: {
      fontSize: 0.045,
      fontWeight: 700,
      color: "#ffffff",
      align: "left",
      x: 0.08,
      y: 0.8,
      maxWidth: 0.55,
      background: "#101828cc",
      padding: 0.6,
      animateIn: "rise",
      animateInSeconds: 0.45,
      animateOut: "fade",
    },
  },
  {
    id: "headline",
    name: { de: "Schlagzeile", en: "Headline" },
    style: {
      fontSize: 0.12,
      fontWeight: 800,
      letterSpacing: -0.02,
      color: "#ffffff",
      y: 0.44,
      maxWidth: 0.86,
      shadowBlur: 0.02,
      shadowColor: "#000000b0",
      animateIn: "grow",
      animateInSeconds: 0.35,
      animateOut: "fade",
    },
  },
  {
    id: "breaking",
    name: { de: "Eilmeldung", en: "Breaking news" },
    style: {
      fontSize: 0.052,
      fontWeight: 800,
      letterSpacing: 0.08,
      color: "#ffffff",
      align: "left",
      x: 0.07,
      y: 0.86,
      maxWidth: 0.7,
      background: "#c62222",
      padding: 0.7,
      animateIn: "fall",
      animateInSeconds: 0.3,
    },
  },
  {
    id: "neon",
    name: { de: "Neon", en: "Neon" },
    style: {
      fontSize: 0.1,
      fontWeight: 800,
      letterSpacing: 0.04,
      color: "#f6f2ff",
      y: 0.46,
      maxWidth: 0.82,
      // The glow is a wide soft shadow in the ink's own colour, which is what a tube does to the wall
      // behind it. Two shadows would be closer still; the generator carries one.
      shadowBlur: 0.06,
      shadowX: 0,
      shadowY: 0,
      shadowColor: "#b061ffcc",
      animateIn: "grow",
      loop: "pulse",
      loopSeconds: 2.4,
    },
  },
  {
    id: "quote",
    name: { de: "Zitat", en: "Quotation" },
    style: {
      fontSize: 0.062,
      fontWeight: 400,
      italic: true,
      lineHeight: 1.35,
      color: "#f4f1e8",
      y: 0.46,
      maxWidth: 0.68,
      animateIn: "rise",
      animateInSeconds: 0.7,
      animateOut: "fade",
      animateOutSeconds: 0.7,
    },
  },
  {
    id: "caption",
    name: { de: "Untertitel", en: "Caption" },
    style: {
      fontSize: 0.042,
      fontWeight: 600,
      color: "#ffffff",
      y: 0.88,
      maxWidth: 0.8,
      background: "#000000a8",
      padding: 0.45,
      animateIn: "none",
      animateOut: "none",
    },
  },
  {
    id: "outline",
    name: { de: "Konturschrift", en: "Outlined" },
    style: {
      fontSize: 0.11,
      fontWeight: 800,
      color: "#ffe14d",
      strokeWidth: 0.012,
      strokeColor: "#1a1206",
      letterSpacing: 0.01,
      y: 0.45,
      maxWidth: 0.84,
      animateIn: "grow",
      animateInSeconds: 0.3,
      animateOut: "fade",
    },
  },
  {
    id: "credit",
    name: { de: "Abspannzeile", en: "Credit line" },
    style: {
      fontSize: 0.034,
      fontWeight: 600,
      letterSpacing: 0.3,
      color: "#cdd6e6",
      y: 0.5,
      maxWidth: 0.7,
      animateIn: "fade",
      animateInSeconds: 0.8,
      animateOut: "fade",
      animateOutSeconds: 0.8,
    },
  },
  {
    id: "sticker",
    name: { de: "Aufkleber", en: "Sticker" },
    style: {
      fontSize: 0.085,
      fontWeight: 800,
      color: "#101010",
      y: 0.22,
      maxWidth: 0.6,
      background: "#ffd54d",
      padding: 0.55,
      animateIn: "grow",
      animateInSeconds: 0.25,
      loop: "pulse",
      loopSeconds: 1.6,
    },
  },
  {
    id: "vertical-hook",
    name: { de: "Hochkant-Aufhänger", en: "Upright hook" },
    style: {
      fontSize: 0.07,
      fontWeight: 800,
      color: "#ffffff",
      y: 0.16,
      maxWidth: 0.86,
      background: "#111827b0",
      padding: 0.5,
      animateIn: "fall",
      animateInSeconds: 0.35,
      animateOut: "fade",
    },
  },
  {
    id: "handwriting",
    name: { de: "Notiz", en: "Note" },
    style: {
      fontFamily: "cursive",
      fontSize: 0.07,
      fontWeight: 400,
      color: "#fff6d8",
      y: 0.7,
      maxWidth: 0.6,
      shadowBlur: 0.012,
      shadowColor: "#00000090",
      animateIn: "rise",
      animateInSeconds: 0.5,
      animateOut: "fade",
    },
  },
];
