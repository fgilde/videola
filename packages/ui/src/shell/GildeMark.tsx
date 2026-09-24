import type { ReactElement } from "react";

/**
 * The workshop's mark, drawn rather than fetched.
 *
 * Inline SVG because a file in an `<img>` cannot be drawn on: both strokes carry `pathLength="1"`,
 * and the stylesheet walks a dash along them — the same mark and the same movement the website's
 * footer has, so the two ends of the project sign off in one hand.
 */
export function GildeMark(): ReactElement {
  return (
    <svg className="v-gilde" viewBox="0 0 512 512" width="18" height="18" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="videolaGildeGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe6a8" />
          <stop offset="0.45" stopColor="#e0a24e" />
          <stop offset="1" stopColor="#a9761f" />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke="url(#videolaGildeGold)"
        strokeWidth="56"
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <path pathLength={1} d="M376 88H112v264l144 112 144-112v-96H280" />
        <path pathLength={1} d="M280 216h120" />
      </g>
    </svg>
  );
}
