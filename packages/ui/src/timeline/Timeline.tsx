import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";

import { cmd, FLICKS_PER_SECOND, type ClipId, type Command, type Project, type Time } from "@videola/core";

import type { Peaks } from "@videola/media";

import { useI18n } from "../i18n/useI18n";
import { mediaNameIndex } from "./Clip";
import { ContextMenu } from "./ContextMenu";
import { Ruler } from "./Ruler";
import { Track } from "./Track";
import { findClip, useTimelineGestures } from "./useTimelineGestures";
import {
  clampZoom,
  projectEnd,
  timeToX,
  trackHeight,
  visibleRange,
  xToTime,
  type TimeRange,
  type ZoomBy,
} from "./geometry";
import "./Timeline.css";

export const DEFAULT_FLICKS_PER_PIXEL = FLICKS_PER_SECOND / 100;

const ZOOM_FACTOR = 2;

export interface TimelineProps {
  project: Project;
  playhead: Time;
  /**
   * Peaks per clip id, from whoever decoded the audio. Absent means no strip at all rather than an
   * empty one: a flat line promises a signal that has not been read yet.
   */
  waveforms?: ReadonlyMap<string, Peaks>;
  /**
   * Must throw when the core refuses a command, and must not report it itself. Hitting a clip's
   * limit is ordinary during a drag and the timeline swallows it; a caller that catches first
   * produces one error banner per pointer movement.
   */
  dispatch: (command: Command, coalesceKey?: string) => void;
  onSeek: (time: Time) => void;
  onSelectionChange?: (clip: ClipId | undefined) => void;
}

export function Timeline({
  project,
  playhead,
  waveforms,
  dispatch,
  onSeek,
  onSelectionChange,
}: TimelineProps): ReactElement {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [flicksPerPixel, setFlicksPerPixel] = useState(DEFAULT_FLICKS_PER_PIXEL);
  const [selected, setSelected] = useState<ClipId>();
  const [snapEnabled, setSnapEnabled] = useState(true);
  const viewport = useViewport(scrollRef);
  const end = useMemo(() => projectEnd(project), [project]);
  const zoom = useAnchoredZoom(scrollRef, flicksPerPixel, setFlicksPerPixel, end);
  const range: TimeRange = visibleRange(viewport.scrollLeft, viewport.width, flicksPerPixel);

  const select = useCallback(
    (clip: ClipId | undefined) => {
      setSelected(clip);
      onSelectionChange?.(clip);
    },
    [onSelectionChange],
  );

  const gestures = useTimelineGestures({
    project,
    playhead,
    flicksPerPixel,
    surface: scrollRef,
    tracksArea: tracksRef,
    dispatch,
    onSeek,
    onSelect: select,
    zoom,
    snapEnabled,
    range,
  });

  const tracks = project.timeline.tracks;
  // Top row first, because tracks[0] is the one the compositor draws lowest.
  const rows = useMemo(() => tracks.map((track, index) => ({ track, index })).reverse(), [tracks]);
  const mediaNames = useMemo(() => mediaNameIndex(project.library), [project.library]);
  const menu = gestures.menu;
  // Read at render, not when the menu opened: from Task 14 the playhead moves while the menu
  // stands, and a clip can be gone by the time the item is clicked. An entry that decides once
  // and then dispatches the current playhead offers an edit the core will refuse.
  const menuClip = menu === undefined ? undefined : findClip(project, menu.clip)?.clip;
  // One viewport of slack past the end, so a clip can always be dragged beyond what exists.
  const contentWidth = timeToX(end, flicksPerPixel) + Math.max(viewport.width, 1);

  return (
    <section className="v-timeline" aria-label={t("timeline.label")} data-testid="timeline">
      <div className="v-timeline__toolbar">
        <button
          type="button"
          className="v-button"
          onClick={() => zoom(ZOOM_FACTOR, viewport.width / 2)}
        >
          {t("timeline.zoomOut")}
        </button>
        <button
          type="button"
          className="v-button"
          onClick={() => zoom(1 / ZOOM_FACTOR, viewport.width / 2)}
        >
          {t("timeline.zoomIn")}
        </button>
        <button
          type="button"
          className="v-button"
          aria-pressed={snapEnabled}
          onClick={() => setSnapEnabled((on) => !on)}
        >
          {t("timeline.snap")}
        </button>
      </div>

      <div className="v-timeline__body">
        <div className="v-timeline__headers">
          <div className="v-timeline__rulerSpacer" />
          {rows.map(({ track }) => (
            <div
              key={track.id}
              className="v-timeline__header"
              style={{ height: `${trackHeight(track)}px`, borderLeftColor: track.colorHex }}
            >
              <span className="v-timeline__headerName">{track.name}</span>
              <span className="v-timeline__headerKind">{t(`track.kind.${track.kind}`)}</span>
            </div>
          ))}
        </div>

        <div
          className="v-timeline__scroll"
          ref={scrollRef}
          onPointerDown={gestures.onPointerDown}
          onPointerMove={gestures.onPointerMove}
          onPointerUp={gestures.onPointerUp}
          onPointerCancel={gestures.onPointerCancel}
          onContextMenu={gestures.onContextMenu}
        >
          <div className="v-timeline__content" style={{ width: `${contentWidth}px` }}>
            <Ruler range={range} flicksPerPixel={flicksPerPixel} fps={project.settings.fps} />
            <div className="v-timeline__tracks" ref={tracksRef}>
              {rows.map(({ track, index }) => (
                <Track
                  key={track.id}
                  track={track}
                  index={index}
                  flicksPerPixel={flicksPerPixel}
                  range={range}
                  mediaNames={mediaNames}
                  waveforms={waveforms}
                  selected={selected}
                  trimZonePx={gestures.trimZonePx}
                  onSelect={select}
                />
              ))}
            </div>
            <div
              className="v-timeline__playhead"
              data-testid="timeline-playhead"
              style={{ left: `${timeToX(playhead, flicksPerPixel)}px` }}
            />
            {gestures.snapLine !== undefined && (
              <div
                className="v-timeline__snapLine"
                data-testid="timeline-snapline"
                style={{ left: `${timeToX(gestures.snapLine, flicksPerPixel)}px` }}
              />
            )}
          </div>
        </div>
      </div>

      {tracks.length === 0 && <p className="v-timeline__empty">{t("empty.noTracks")}</p>}

      {menu !== undefined && menuClip !== undefined && (
        <ContextMenu
          menu={menu}
          canSplit={playhead > menuClip.start && playhead < menuClip.start + menuClip.duration}
          onSplit={() => {
            dispatch(cmd.clipSplit(menu.clip, playhead));
            gestures.closeMenu();
          }}
          onDelete={() => {
            dispatch(cmd.clipRemove(menu.clip));
            select(undefined);
            gestures.closeMenu();
          }}
          onClose={gestures.closeMenu}
        />
      )}
    </section>
  );
}

interface Viewport {
  scrollLeft: number;
  width: number;
}

// ponytail: window resize only. A splitter that resizes the timeline panel without resizing the
// window would need a ResizeObserver; there is no such splitter yet.
function useViewport(ref: RefObject<HTMLElement | null>): Viewport {
  const [viewport, setViewport] = useState<Viewport>({ scrollLeft: 0, width: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () =>
      setViewport((previous) =>
        previous.scrollLeft === element.scrollLeft && previous.width === element.clientWidth
          ? previous
          : { scrollLeft: element.scrollLeft, width: element.clientWidth },
      );
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      element.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [ref]);

  return viewport;
}

// Zooming keeps the time under the anchor pixel where it was; without that the timeline jumps
// away from whatever the user was pointing at.
function useAnchoredZoom(
  ref: RefObject<HTMLElement | null>,
  flicksPerPixel: number,
  setFlicksPerPixel: (next: number) => void,
  contentDuration: Time,
): ZoomBy {
  const pending = useRef<{ time: Time; x: number } | undefined>(undefined);
  // React state is one value per task, but a wheel delivers ten notches into the same one and a
  // finger drums the button faster than it re-renders. The ref carries the zoom forward inside
  // the task so a burst compounds instead of collapsing to a single step.
  const live = useRef(flicksPerPixel);
  live.current = flicksPerPixel;

  useLayoutEffect(() => {
    const anchor = pending.current;
    const element = ref.current;
    pending.current = undefined;
    if (anchor === undefined || element === null) return;
    element.scrollLeft = Math.max(0, timeToX(anchor.time, flicksPerPixel) - anchor.x);
  }, [ref, flicksPerPixel]);

  return useCallback(
    (factor, anchorX) => {
      const current = live.current;
      const next = clampZoom(current * factor, contentDuration);
      if (next === current) return;
      const element = ref.current;
      const scrollLeft = element?.scrollLeft ?? 0;
      // First step of a burst wins the anchor: it is the only one that sees a scroll offset
      // the layout effect has not already invalidated.
      pending.current ??= { time: xToTime(scrollLeft + anchorX, current), x: anchorX };
      live.current = next;
      setFlicksPerPixel(next);
    },
    [ref, setFlicksPerPixel, contentDuration],
  );
}
