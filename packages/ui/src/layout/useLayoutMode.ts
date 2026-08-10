import { useCallback, useEffect, useState } from "react";

import { clearStored, readStored, writeStored } from "../storage";
import {
  detectLayoutMode,
  readViewport,
  type LayoutMode,
  type LayoutPreference,
} from "./detectLayoutMode";

const STORAGE_KEY = "videola.layout";

export function useLayoutMode(preference: LayoutPreference): LayoutMode {
  const [detected, setDetected] = useState<LayoutMode>(() => detectLayoutMode(readViewport()));

  useEffect(() => {
    const update = () => setDetected(detectLayoutMode(readViewport()));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return preference === "auto" ? detected : preference;
}

/**
 * The layout somebody asked for, remembered.
 *
 * Detection is right nearly always and wrong in one case that matters: a wide screen whose browser
 * reports no fine pointer gets the tablet layout, because `(any-pointer: fine)` is the only honest
 * question a page can ask about what is being pointed with. A touchscreen laptop answers it
 * correctly and a headless browser does not answer it at all — so whoever disagrees with the
 * detection has to be able to say so, and be remembered saying it.
 *
 * `auto` clears the key rather than storing the word, so a build that later changes what auto means
 * is not overridden by a preference nobody set.
 */
export function useLayoutPreference(): {
  preference: LayoutPreference;
  setPreference: (next: LayoutPreference) => void;
} {
  const [preference, setStored] = useState<LayoutPreference>(readPreference);

  const setPreference = useCallback((next: LayoutPreference) => {
    setStored(next);
    if (next === "auto") clearStored(STORAGE_KEY);
    else writeStored(STORAGE_KEY, next);
  }, []);

  return { preference, setPreference };
}

function readPreference(): LayoutPreference {
  const stored = readStored(STORAGE_KEY);
  return stored === "desktop" || stored === "tablet" || stored === "phone" ? stored : "auto";
}
