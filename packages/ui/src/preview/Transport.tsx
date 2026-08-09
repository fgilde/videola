import { useEffect, type ReactElement } from "react";

import { timeToSeconds, type Rate, type Time } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { IconButton } from "../primitives/Icon";
import "./Preview.css";

/**
 * The fractions of the screen's own resolution the preview offers. Half in each direction is a
 * quarter of the pixels, which is the whole point: it is the cheapest thing there is to trade for
 * a preview that keeps up on a big project, and every editor has this switch.
 */
export const PREVIEW_RESOLUTIONS: readonly number[] = [1, 0.5, 0.25];

export interface TransportProps {
  playing: boolean;
  time: Time;
  duration: Time;
  fps: Rate;
  /** The shuttle rate, where 1 is ordinary play, a negative number a rewind and 0 halted. */
  rate?: number;
  onPlayPause: () => void;
  onSeek: (time: Time) => void;
  onStep: (direction: 1 | -1) => void;
  /** J and L. Each press in the same direction steps the shuttle up. */
  onShuttle?: (direction: 1 | -1) => void;
  /** Shift and an arrow key: the next marker in that direction, if there is one. */
  onMarkerJump?: (direction: 1 | -1) => void;
  resolution?: number;
  onResolution?: (scale: number) => void;
}

export function Transport({
  playing,
  time,
  duration,
  fps,
  rate = 0,
  onPlayPause,
  onSeek,
  onStep,
  onShuttle,
  onMarkerJump,
  resolution = 1,
  onResolution,
}: TransportProps): ReactElement {
  const { t, formatTimecode } = useI18n();
  useTransportKeys(playing, onPlayPause, onStep, onShuttle, onMarkerJump);

  return (
    <div className="v-transport" role="toolbar" aria-label={t("transport.label")}>
      <IconButton icon="skipStart" label={t("transport.toStart")} onClick={() => onSeek(0)} />
      {onShuttle !== undefined && (
        <IconButton
          icon="rewind"
          label={t("transport.rewind")}
          pressed={rate < 0}
          onClick={() => onShuttle(-1)}
        />
      )}
      <IconButton icon="stepBack" label={t("transport.stepBack")} onClick={() => onStep(-1)} />
      <IconButton
        icon={playing ? "pause" : "play"}
        label={t(playing ? "transport.pause" : "transport.play")}
        primary
        onClick={onPlayPause}
      />
      <IconButton icon="stepForward" label={t("transport.stepForward")} onClick={() => onStep(1)} />
      {onShuttle !== undefined && (
        <IconButton
          icon="fastForward"
          label={t("transport.fastForward")}
          pressed={rate > 1}
          onClick={() => onShuttle(1)}
        />
      )}
      <IconButton icon="skipEnd" label={t("transport.toEnd")} onClick={() => onSeek(duration)} />
      <span className="v-transport__time" aria-label={t("transport.position")}>
        {formatTimecode(timeToSeconds(time), fps)}
        <span className="v-transport__duration"> / {formatTimecode(timeToSeconds(duration), fps)}</span>
      </span>
      {/* Only while it is not one: at ordinary speed the number would be noise beside the
          timecode, and its absence is what makes it readable when it appears. */}
      {rate !== 0 && rate !== 1 && (
        <span className="v-transport__rate" role="status">
          {t("transport.rate", { rate: String(rate) })}
        </span>
      )}
      {onResolution !== undefined && (
        <select
          className="v-transport__resolution"
          aria-label={t("transport.resolution")}
          value={String(resolution)}
          onChange={(event) => onResolution(Number(event.target.value))}
        >
          {PREVIEW_RESOLUTIONS.map((scale) => (
            <option key={scale} value={String(scale)}>
              {scale === 1 ? t("transport.resolution.full") : `1/${Math.round(1 / scale)}`}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// Anything the browser already activates with a space bar, so pressing it there would both
// press the control and toggle playback.
const SPACE_ACTIVATES = new Set(["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A", "SUMMARY"]);
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// The keys belong to the editor, not to the toolbar: the hands are on the timeline while the
// space bar plays. A listener on window is what makes that true wherever the focus sits.
//
// J, K and L are the three every cutter has in their fingers, and they are unmodified because
// every ctrl or cmd combination near them belongs to the browser -- a shortcut the browser eats is
// a shortcut that does not exist.
function useTransportKeys(
  playing: boolean,
  onPlayPause: () => void,
  onStep: (direction: 1 | -1) => void,
  onShuttle: ((direction: 1 | -1) => void) | undefined,
  onMarkerJump: ((direction: 1 | -1) => void) | undefined,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target?.isContentEditable === true) return;
      if (event.key === " ") {
        if (SPACE_ACTIVATES.has(tag)) return;
        event.preventDefault();
        onPlayPause();
        return;
      }
      if (TYPING.has(tag)) return;
      const shuttle = shuttleKey(event.key);
      if (shuttle !== undefined) {
        if (onShuttle === undefined) return;
        event.preventDefault();
        // K halts and does nothing else. On a transport that is already standing still it is not
        // a play button in disguise -- that is what the space bar is for.
        if (shuttle === 0) {
          if (playing) onPlayPause();
          return;
        }
        onShuttle(shuttle);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      // Without this the timeline's scroll container answers the arrow key as well, and the
      // view jumps a scroll step for every frame stepped.
      event.preventDefault();
      if (!event.shiftKey) return onStep(direction);
      onMarkerJump?.(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playing, onPlayPause, onStep, onShuttle, onMarkerJump]);
}

function shuttleKey(key: string): 1 | -1 | 0 | undefined {
  switch (key.toLowerCase()) {
    case "j":
      return -1;
    case "k":
      return 0;
    case "l":
      return 1;
    default:
      return undefined;
  }
}
