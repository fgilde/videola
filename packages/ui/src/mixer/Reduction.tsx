import { useEffect, useRef, useState, type ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";

/** How hard this compressor is working, in decibels below zero, asked once per animation frame. */
export type ReadReduction = () => number | undefined;

/** The floor of the bar, in decibels. Past twenty a compressor is a limiter and the number is enough. */
const FLOOR_DB = 20;

/**
 * The gain reduction of one compressor: a bar that grows downwards and a number beside it.
 *
 * The one reading about a compressor that cannot be derived from its settings — what it does depends on
 * what is going through it. It comes from `DynamicsCompressorNode.reduction`, which is why this is the
 * only control in the chain that reads the graph rather than the project.
 *
 * Its own component, and its own animation frame, for the same reason the level meters have theirs: a
 * reading that changes sixty times a second must not put the panel that holds it through a render, or
 * every slider in the strip re-renders with it.
 */
export function Reduction({
  read,
  active = false,
  label,
}: {
  read: ReadReduction;
  /** False while nothing is scheduled: a bar left standing reports a compressor working on silence. */
  active?: boolean;
  label: string;
}): ReactElement {
  const { t, formatNumber } = useI18n();
  const bar = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!active) {
      setShown(0);
      if (bar.current !== null) bar.current.style.blockSize = "0%";
      return;
    }
    let frame = 0;
    const tick = (): void => {
      const db = read() ?? 0;
      const share = Math.min(1, Math.max(0, -db / FLOOR_DB));
      // The bar is written to the element directly and the number through state: the bar changes every
      // frame and nothing else depends on it, while the number is read rather than watched and one
      // decimal at a time is as fast as a person can follow.
      if (bar.current !== null) bar.current.style.blockSize = `${share * 100}%`;
      setShown((was) => (Math.abs(was - db) < 0.5 ? was : db));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [read, active]);

  return (
    <div className="v-reduction" data-testid="reduction" aria-label={label}>
      <span className="v-reduction__label">{t("mixer.reductionShort")}</span>
      <div className="v-reduction__track">
        <div className="v-reduction__bar" ref={bar} />
      </div>
      {/* Rounded to a tenth and read as a number rather than announced: a live region that spoke every
          frame would talk over everything else on the page. */}
      <span className="v-reduction__value">
        {shown === 0 ? "0" : formatNumber(Math.round(shown * 10) / 10)} dB
      </span>
    </div>
  );
}
