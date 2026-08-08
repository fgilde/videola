import type { ReactElement } from "react";

import { FLICKS_PER_SECOND, type Rate } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { rulerTicks, tickStep, timeToX, type TimeRange } from "./geometry";

export interface RulerProps {
  range: TimeRange;
  flicksPerPixel: number;
  fps: Rate;
}

export function Ruler({ range, flicksPerPixel, fps }: RulerProps): ReactElement {
  const { t, formatTimecode } = useI18n();
  const step = tickStep(flicksPerPixel, fps);
  return (
    <div className="v-ruler" data-timeline-ruler aria-label={t("timeline.ruler")}>
      {rulerTicks(range, step).map((at) => (
        <span
          key={at}
          className="v-ruler__tick"
          data-tick={at}
          style={{ left: `${timeToX(at, flicksPerPixel)}px` }}
        >
          {formatTimecode(at / FLICKS_PER_SECOND, fps)}
        </span>
      ))}
    </div>
  );
}
