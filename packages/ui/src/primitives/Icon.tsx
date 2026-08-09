import type { ReactElement } from "react";

// Inline SVG in one place, so a symbol costs a path string rather than an icon dependency and a
// build step. Everything is drawn in a 24x24 box and takes its colour from the text around it.
const OUTLINED = {
  menu: "M4 7h16M4 12h16M4 17h16",
  undo: "M9 8 5 12l4 4M5 12h9a5 5 0 0 1 0 10h-2",
  redo: "M15 8l4 4-4 4M19 12h-9a5 5 0 0 0 0 10h2",
  sun: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4",
  moon: "M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z",
  zoomIn: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M20 20l-4.4-4.4M11 8v6M8 11h6",
  zoomOut: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13M20 20l-4.4-4.4M8 11h6",
  magnet: "M6 4v8a6 6 0 0 0 12 0V4M6 10h4M14 10h4",
  flag: "M6 3v18M6 4.5h11l-2.4 3.75L17 12H6",
  plus: "M12 5v14M5 12h14",
  link: "M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 1 0-5.7-5.7l-1.2 1.2M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 1 0 5.7 5.7l1.2-1.2",
  chevronLeft: "M14.5 6 8.5 12l6 6",
  chevronRight: "M9.5 6l6 6-6 6",
  // The empty diamond is "no keyframe here"; the filled one below is "there is one". A shape that
  // fills is what a switch looks like when a tint alone has to carry pressed and disabled as well.
  keyframe: "M12 4.8 19.2 12 12 19.2 4.8 12Z",
  // Three traces at three heights -- a waveform, which is the instrument this opens.
  waveform: "M4 15h2.5l2-7 2.5 11 2.5-9 2 5H20",
  // Three faders at three settings. A mixing desk is drawn this way everywhere it is drawn.
  mixer: "M7 4v5M7 15v5M12 4v9M12 19v1M17 4v1M17 11v9M4.5 12h5M9.5 16h5M14.5 8h5",
  trash: "M4.5 7h15M10 7V4.8h4V7M6.5 7l1 12.2h9L17.5 7M10.2 10.5v5.4M13.8 10.5v5.4",
  // "Take a range out of this medium." The blades are what says the entry is material to cut from
  // rather than a file to open.
  scissors:
    "M9 9 19 19M9 15 19 5M7.6 7.6a2.6 2.6 0 1 1-3.7 3.7 2.6 2.6 0 0 1 3.7-3.7M7.6 16.4a2.6 2.6 0 1 0-3.7-3.7 2.6 2.6 0 0 0 3.7 3.7",
} as const;

// Filled rather than stroked: a transport symbol is a solid shape at every size, and a 1.8 px
// outline around a 6 px triangle is a smudge.
const FILLED = {
  play: "M8 5.2v13.6L19 12z",
  pause: "M8 5h3.2v14H8zM12.8 5H16v14h-3.2z",
  skipStart: "M6 6h2.2v12H6zM19 6v12l-9-6z",
  skipEnd: "M15.8 6H18v12h-2.2zM5 6v12l9-6z",
  stepBack: "M13 6v12l-8-6zM15 6h2.4v12H15z",
  stepForward: "M11 6v12l8-6zM6.6 6H9v12H6.6z",
  keyframeSet: "M12 4.8 19.2 12 12 19.2 4.8 12Z",
  // J and L. Two triangles, which is what every deck and every editor has drawn on those keys.
  rewind: "M11 6v12l-8-6zM21 6v12l-8-6z",
  fastForward: "M13 6v12l8-6zM3 6v12l8-6z",
  // The two brackets an in and an out point are drawn as everywhere they are drawn at all.
  markIn: "M6 5h2.6v14H6zM8.6 5H18v2.6H8.6zM8.6 16.4H18V19H8.6z",
  markOut: "M15.4 5H18v14h-2.6zM6 5h9.4v2.6H6zM6 16.4h9.4V19H6z",
} as const;

export type IconName = keyof typeof OUTLINED | keyof typeof FILLED;

export function Icon({ name }: { name: IconName }): ReactElement {
  const filled = name in FILLED;
  return (
    <svg
      className="v-icon"
      viewBox="0 0 24 24"
      // The button around it carries the accessible name; the picture inside must not be read
      // out a second time, and it is never a focus stop of its own.
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={filled ? FILLED[name as keyof typeof FILLED] : OUTLINED[name as keyof typeof OUTLINED]} />
    </svg>
  );
}

export interface IconButtonProps {
  icon: IconName;
  /** The accessible name. A control with no words has none without it. */
  label: string;
  onClick?: () => void;
  /** A switch rather than an action: reported to assistive tech and shown as a tint. */
  pressed?: boolean;
  disabled?: boolean;
  primary?: boolean;
}

export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  primary = false,
}: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={`v-button v-button--icon${primary ? " v-button--primary" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
