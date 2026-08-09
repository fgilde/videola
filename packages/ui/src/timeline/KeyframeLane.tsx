import type { ReactElement } from "react";

import { timeToSeconds, type Clip, type Keyframe, type Rate, type Time } from "@videola/core";

import { useI18n, type Locale } from "../i18n/useI18n";
import type { EffectDescriptor } from "../inspector/Inspector";
import { timeToX, type TimeRange } from "./geometry";
import type { LaneRow } from "./keyframes";

/** Which keyframe the lane has under the hand: the row it lives on and the instant it sits at. */
export interface KeyframeSelection {
  row: string;
  time: Time;
}

export interface KeyframeLaneProps {
  clip: Clip;
  rows: readonly LaneRow[];
  flicksPerPixel: number;
  range: TimeRange;
  fps: Rate;
  effects: readonly EffectDescriptor[];
  selection: KeyframeSelection | undefined;
}

/**
 * The keyframes of the selected clip, on the timeline's own axis. It sits inside the same scrolling
 * content the tracks and the ruler sit in, so `timeToX` is the only conversion involved and the
 * playhead line crosses it without anything having to agree on where "now" is.
 */
export function KeyframeLane({
  clip,
  rows,
  flicksPerPixel,
  range,
  fps,
  effects,
  selection,
}: KeyframeLaneProps): ReactElement {
  const { t, locale, formatTimecode } = useI18n();

  return (
    <div
      className="v-keylane"
      data-testid="keyframe-lane"
      role="group"
      aria-label={t("keyframe.lane")}
    >
      {/* A selected clip with nothing on it still gets a lane, saying where keyframes come from.
          Without it the lane only ever appears once somebody has already found the switch that
          makes it appear. */}
      {rows.length === 0 && <p className="v-keylane__empty">{t("keyframe.none")}</p>}
      {rows.map((row) => {
        const name = paramLabel(row, effects, locale, t);
        return (
          <div
            key={row.id}
            className="v-keylane__row"
            data-keyframe-row={row.id}
            data-overridden={row.overridden || undefined}
          >
            {/* Drawn first and never pointed at: a segment says how the travel after a key is
                timed, and the key is what carries that setting. Two things to grab where there is
                one thing to change would be a second way to mean the same edit. */}
            {segmentsIn(row.track, range).map(({ left, right }) => (
              <span
                key={left.time}
                className="v-keylane__segment"
                data-interp={left.interp}
                style={{
                  left: `${timeToX(left.time, flicksPerPixel)}px`,
                  width: `${Math.max(0, timeToX(right.time - left.time, flicksPerPixel))}px`,
                }}
              />
            ))}
            {row.track
              .filter((entry) => entry.time >= range.from && entry.time <= range.to)
              .map((entry) => (
                // A real button, like a clip: focus, the accessible name and keyboard activation
                // come from the platform, and the pointer path reads the same element through the
                // event target rather than through a second geometry of its own.
                <button
                  key={entry.time}
                  type="button"
                  className="v-keylane__key"
                  data-keyframe-row={row.id}
                  data-keyframe-clip={clip.id}
                  data-keyframe-effect={row.effectType ?? ""}
                  data-keyframe-key={row.key}
                  data-keyframe-time={entry.time}
                  data-interp={entry.interp}
                  aria-pressed={selection?.row === row.id && selection.time === entry.time}
                  aria-label={t("keyframe.at", {
                    name,
                    time: formatTimecode(timeToSeconds(entry.time), fps),
                  })}
                  style={{ left: `${timeToX(entry.time, flicksPerPixel)}px` }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** The header column beside the lane. Same rows, same order, same heights -- one list, two ends. */
export function KeyframeLaneHeaders({
  rows,
  effects,
}: {
  rows: readonly LaneRow[];
  effects: readonly EffectDescriptor[];
}): ReactElement {
  const { t, locale } = useI18n();
  return (
    <>
      {rows.map((row) => (
        <div key={row.id} className="v-keylane__header" data-overridden={row.overridden || undefined}>
          <span className="v-keylane__headerName">{paramLabel(row, effects, locale, t)}</span>
          {/* The precedence rule made visible. Without it the two rows are simply keyframes that
              never move anything, and nothing on screen says why. */}
          {row.overridden && (
            <span className="v-keylane__headerNote">{t("keyframe.overridden")}</span>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * What a row is called. An effect parameter is named by the manifest that declares it, and a
 * transform field by the same catalogue entry the inspector's own row uses -- so a lane row and the
 * slider it belongs to never disagree about what is being animated. A key no manifest and no
 * catalogue knows falls back to the key itself, which is a project from a later version.
 */
export function paramLabel(
  row: LaneRow,
  effects: readonly EffectDescriptor[],
  locale: Locale,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (row.effectType === null) {
    const label = t(`inspector.${row.key}`);
    return label === `inspector.${row.key}` ? row.key : label;
  }
  const manifest = effects.find((candidate) => candidate.id === row.effectType);
  const param = manifest?.params.find((candidate) => candidate.key === row.key);
  if (manifest === undefined || param === undefined) return `${row.effectType} · ${row.key}`;
  return `${manifest.name[locale]} · ${param.name[locale]}`;
}

interface Segment {
  left: Keyframe;
  right: Keyframe;
}

// Every gap between two neighbouring keys that the window touches. The core keeps a track sorted on
// every write, so neighbours are neighbours in the array.
function segmentsIn(track: readonly Keyframe[], range: TimeRange): Segment[] {
  const segments: Segment[] = [];
  for (let index = 0; index + 1 < track.length; index += 1) {
    const left = track[index] as Keyframe;
    const right = track[index + 1] as Keyframe;
    if (left.time > range.to || right.time < range.from) continue;
    segments.push({ left, right });
  }
  return segments;
}
