export type LayoutMode = "desktop" | "tablet" | "phone";
export type LayoutPreference = "auto" | LayoutMode;

export const TABLET_MIN_WIDTH = 768;
export const DESKTOP_MIN_WIDTH = 1280;

export interface Viewport {
  width: number;
  hasFinePointer: boolean;
}

export function detectLayoutMode({ width, hasFinePointer }: Viewport): LayoutMode {
  if (width < TABLET_MIN_WIDTH) {
    return "phone";
  }
  if (width < DESKTOP_MIN_WIDTH || !hasFinePointer) {
    return "tablet";
  }
  return "desktop";
}

export function readViewport(): Viewport {
  return {
    width: window.innerWidth,
    hasFinePointer: matchMedia("(any-pointer: fine)").matches,
  };
}
