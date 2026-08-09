import { timeToSeconds, cmd, type Command, type Marker, type Rate, type Time } from "@videola/core";

import type { ReactElement } from "react";

import { useI18n } from "../i18n/useI18n";
import { IconButton } from "../primitives/Icon";
import "./MarkerList.css";

export interface MarkerListProps {
  markers: readonly Marker[];
  fps: Rate;
  dispatch: (command: Command, coalesceKey?: string) => void;
  onSeek: (time: Time) => void;
}

/**
 * Every marker in the project, in time order, with the two things a marker is for: a colour that
 * says what kind it is, and a note that says what it is about. Clicking one jumps there, which is
 * the whole reason a list beats a row of pins on the ruler once there are more than a handful.
 *
 * A native `<details>` rather than a panel of its own: it is closed most of the time, and the
 * browser already knows how to open and close a disclosure with a keyboard.
 */
export function MarkerList({ markers, fps, dispatch, onSeek }: MarkerListProps): ReactElement {
  const { t, formatTimecode } = useI18n();
  const ordered = [...markers].sort((a, b) => a.time - b.time);

  return (
    <details className="v-markers" data-testid="marker-list">
      <summary className="v-markers__summary">
        {t("markers.label", { count: ordered.length })}
      </summary>
      {ordered.length === 0 ? (
        <p className="v-markers__empty">{t("markers.empty")}</p>
      ) : (
        <ul className="v-markers__list">
          {ordered.map((marker) => (
            <li key={marker.id} className="v-markers__item" data-marker-id={marker.id}>
              {/* Native, so a colour is picked with the operating system's own picker and comes
                  back as the `#rrggbb` the core already accepts. */}
              <input
                type="color"
                className="v-markers__color"
                aria-label={t("markers.color")}
                value={sixDigit(marker.colorHex)}
                onChange={(event) => dispatch(cmd.markerSetColor(marker.id, event.target.value))}
              />
              <button
                type="button"
                className="v-markers__time"
                onClick={() => onSeek(marker.time)}
              >
                {formatTimecode(timeToSeconds(marker.time), fps)}
              </button>
              {/* One dispatch per keystroke under one coalesce key, the same shape a slider drag
                  has: typing a label is one undo step, not one per letter. */}
              <input
                type="text"
                className="v-markers__label"
                aria-label={t("markers.name")}
                placeholder={t("timeline.markerUnnamed")}
                value={marker.label}
                onChange={(event) =>
                  dispatch(cmd.markerRename(marker.id, event.target.value), `marker-label-${marker.id}`)
                }
              />
              <input
                type="text"
                className="v-markers__note"
                aria-label={t("markers.note")}
                placeholder={t("markers.notePlaceholder")}
                value={marker.note ?? ""}
                onChange={(event) =>
                  dispatch(cmd.markerSetNote(marker.id, event.target.value), `marker-note-${marker.id}`)
                }
              />
              <IconButton
                icon="trash"
                label={t("timeline.deleteMarker")}
                onClick={() => dispatch(cmd.markerRemove(marker.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * The one shape `<input type="color">` will show. The model accepts three, six and eight digits,
 * and a value the input cannot parse is silently replaced with black -- which would then be
 * written back to the project on the next change as if somebody had chosen it.
 */
export function sixDigit(hex: string): string {
  const digits = hex.startsWith("#") ? hex.slice(1) : "";
  if (digits.length === 3) return `#${[...digits].map((digit) => digit + digit).join("")}`;
  if (digits.length === 8) return `#${digits.slice(0, 6)}`;
  return digits.length === 6 ? `#${digits}` : "#000000";
}

/** The marker to jump to from `at`, in the direction given, or nothing where there is none. */
export function markerAfter(
  markers: readonly Marker[],
  at: Time,
  direction: 1 | -1,
): Marker | undefined {
  const ahead = markers.filter((marker) =>
    direction === 1 ? marker.time > at : marker.time < at,
  );
  if (ahead.length === 0) return undefined;
  return ahead.reduce((best, marker) =>
    direction === 1
      ? marker.time < best.time
        ? marker
        : best
      : marker.time > best.time
        ? marker
        : best,
  );
}
