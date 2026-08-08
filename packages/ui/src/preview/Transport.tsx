import { useEffect, type ReactElement } from "react";

import { timeToSeconds, type Rate, type Time } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { IconButton } from "../primitives/Icon";
import "./Preview.css";

export interface TransportProps {
  playing: boolean;
  time: Time;
  duration: Time;
  fps: Rate;
  onPlayPause: () => void;
  onSeek: (time: Time) => void;
  onStep: (direction: 1 | -1) => void;
}

export function Transport({
  playing,
  time,
  duration,
  fps,
  onPlayPause,
  onSeek,
  onStep,
}: TransportProps): ReactElement {
  const { t, formatTimecode } = useI18n();
  useTransportKeys(onPlayPause, onStep);

  return (
    <div className="v-transport" role="toolbar" aria-label={t("transport.label")}>
      <IconButton icon="skipStart" label={t("transport.toStart")} onClick={() => onSeek(0)} />
      <IconButton icon="stepBack" label={t("transport.stepBack")} onClick={() => onStep(-1)} />
      <IconButton
        icon={playing ? "pause" : "play"}
        label={t(playing ? "transport.pause" : "transport.play")}
        primary
        onClick={onPlayPause}
      />
      <IconButton icon="stepForward" label={t("transport.stepForward")} onClick={() => onStep(1)} />
      <IconButton icon="skipEnd" label={t("transport.toEnd")} onClick={() => onSeek(duration)} />
      <span className="v-transport__time" aria-label={t("transport.position")}>
        {formatTimecode(timeToSeconds(time), fps)}
        <span className="v-transport__duration"> / {formatTimecode(timeToSeconds(duration), fps)}</span>
      </span>
    </div>
  );
}

// Anything the browser already activates with a space bar, so pressing it there would both
// press the control and toggle playback.
const SPACE_ACTIVATES = new Set(["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A", "SUMMARY"]);
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// The keys belong to the editor, not to the toolbar: the hands are on the timeline while the
// space bar plays. A listener on window is what makes that true wherever the focus sits.
function useTransportKeys(onPlayPause: () => void, onStep: (direction: 1 | -1) => void): void {
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
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (TYPING.has(tag)) return;
      // Without this the timeline's scroll container answers the arrow key as well, and the
      // view jumps a scroll step for every frame stepped.
      event.preventDefault();
      onStep(event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPlayPause, onStep]);
}
