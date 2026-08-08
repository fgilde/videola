import { createElement } from "react";
import { createRoot } from "react-dom/client";

import "../src/theme/tokens.css";

export { createElement, createRoot };
export { I18nProvider } from "../src/i18n/I18nProvider";
export { Timeline } from "../src/timeline/Timeline";
export {
  clampZoom,
  MAX_ELEMENT_WIDTH_PX,
  MAX_FLICKS_PER_PIXEL,
  minZoomFor,
  tickStep,
} from "../src/timeline/geometry";
export { snapTime } from "../src/timeline/snapping";
export { flushSync } from "react-dom";
