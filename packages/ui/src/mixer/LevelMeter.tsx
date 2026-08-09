import { useEffect, useRef, type ReactElement } from "react";

/**
 * What one bar of the meter shows, in dBFS. Structurally the engine's `Level`, spelled here so the
 * mixer package does not depend on the engine -- the same arrangement `MixerEffectDescriptor` has.
 */
export interface MeterLevel {
  peak: number;
  rms: number;
  hold: number;
}

/**
 * Asked once per animation frame with that frame's own timestamp. The timestamp is the whole reason
 * it is a parameter: every strip on the desk is asked inside the same frame and has to be answered
 * from one reading of the graph, and a caller that told them apart by wall clock would take a
 * separate reading per strip.
 */
export type ReadLevel = (nowMs: number) => MeterLevel | undefined;

export interface LevelMeterProps {
  /**
   * The reason this is a function and not a prop: a level arriving as React state would re-render
   * the whole mixer sixty times a second while nothing but three lengths had changed. What comes
   * back here is written straight onto the elements.
   */
  read: ReadLevel;
  label: string;
  /**
   * False when nothing is rolling. The loop then paints silence once and stops, which is not
   * an optimisation: an animation frame loop that never ends keeps the page from ever going
   * idle, and a browser driven under a virtual clock -- which is how this project takes its
   * screenshots and half its checks -- then never advances past it. Measured: two harness
   * runs stopped finishing the moment the meters arrived.
   */
  active?: boolean;
}

// The bottom of the scale. Below this a bar is a sliver nobody can tell from silence, and a mixer
// meter is read at a glance rather than measured off -- the loudness readout is what carries a
// number. Everything quieter is drawn as nothing at all.
const FLOOR_DBFS = -60;

// Where the bar changes colour: full scale is where a sample clips, and the last six decibels are
// the ones worth being warned about before it does.
const HOT_DBFS = -6;

// What a stopped transport reads. Spelled here rather than imported from the engine for the
// same reason `MeterLevel` is: this package draws meters, it does not measure.
const SILENT: MeterLevel = {
  peak: Number.NEGATIVE_INFINITY,
  rms: Number.NEGATIVE_INFINITY,
  hold: Number.NEGATIVE_INFINITY,
};

export function LevelMeter({ read, label, active = true }: LevelMeterProps): ReactElement {
  const bar = useRef<HTMLDivElement>(null);
  const rms = useRef<HTMLDivElement>(null);
  const peak = useRef<HTMLDivElement>(null);
  const hold = useRef<HTMLDivElement>(null);
  // Through a ref rather than as an effect dependency: the strip re-renders on every edit, and a
  // loop torn down and restarted with each of them would lose the peak it was holding. This way a
  // caller may hand in a fresh closure per render without having to know that.
  const latest = useRef(read);
  latest.current = read;

  useEffect(() => {
    let frame = 0;
    let shown = Number.NaN;
    const step = (now: number): void => {
      if (active) frame = requestAnimationFrame(step);
      const level = active ? latest.current(now) : SILENT;
      if (level === undefined || bar.current === null) return;
      rms.current!.style.width = `${scale(level.rms)}%`;
      peak.current!.style.width = `${scale(level.peak)}%`;
      // A hold that never rose off the floor would sit at the left edge as a permanent tick, so it
      // is hidden rather than drawn at zero -- an empty meter has no marker on it.
      hold.current!.style.left = `${scale(level.hold)}%`;
      hold.current!.hidden = !Number.isFinite(level.hold);
      bar.current.classList.toggle("v-meter--hot", level.peak >= HOT_DBFS);
      // A whole number, and only when it changes. `meter` is not a live region, so this is a value
      // to go and read rather than one that announces itself sixty times a second.
      const rounded = Math.round(Math.max(level.peak, FLOOR_DBFS));
      if (rounded !== shown) {
        shown = rounded;
        bar.current.setAttribute("aria-valuenow", String(rounded));
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div
      ref={bar}
      className="v-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={FLOOR_DBFS}
      aria-valuemax={0}
      aria-valuenow={FLOOR_DBFS}
      data-testid="meter"
    >
      <div ref={peak} className="v-meter__peak" style={{ width: "0%" }} />
      <div ref={rms} className="v-meter__rms" style={{ width: "0%" }} />
      <div ref={hold} className="v-meter__hold" hidden style={{ left: "0%" }} />
    </div>
  );
}

/**
 * Decibels onto the width of the bar. Linear in decibels rather than in amplitude, which is the
 * whole reason a meter is readable: half the bar is 30 dB down rather than half the voltage, and
 * the quiet end of the range gets as much room as the loud one.
 */
export function scale(dbfs: number): number {
  if (Number.isNaN(dbfs)) return 0;
  if (!Number.isFinite(dbfs)) return dbfs > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, ((dbfs - FLOOR_DBFS) / -FLOOR_DBFS) * 100));
}
