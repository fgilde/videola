import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";

import { FLICKS_PER_SECOND, type Project, type Time } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { mediaNameIndex } from "./Clip";
import { Ruler } from "./Ruler";
import { Track } from "./Track";
import {
  clampZoom,
  timeToX,
  trackHeight,
  visibleRange,
  xToTime,
  type TimeRange,
} from "./geometry";
import "./Timeline.css";

export const DEFAULT_FLICKS_PER_PIXEL = FLICKS_PER_SECOND / 100;

const ZOOM_FACTOR = 2;

export interface TimelineProps {
  project: Project;
  playhead: Time;
}

export function Timeline({ project, playhead }: TimelineProps): ReactElement {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flicksPerPixel, setFlicksPerPixel] = useState(DEFAULT_FLICKS_PER_PIXEL);
  const viewport = useViewport(scrollRef);
  const projectEnd = useMemo(() => timelineEnd(project), [project]);
  const zoom = useAnchoredZoom(scrollRef, flicksPerPixel, setFlicksPerPixel, projectEnd);

  const tracks = project.timeline.tracks;
  // Top row first, because tracks[0] is the one the compositor draws lowest.
  const rows = useMemo(() => tracks.map((track, index) => ({ track, index })).reverse(), [tracks]);
  const mediaNames = useMemo(() => mediaNameIndex(project.library), [project.library]);
  const range: TimeRange = visibleRange(viewport.scrollLeft, viewport.width, flicksPerPixel);
  // One viewport of slack past the end, so a clip can always be dragged beyond what exists.
  const contentWidth = timeToX(projectEnd, flicksPerPixel) + Math.max(viewport.width, 1);

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
      </div>

      <div className="v-timeline__body">
        <div className="v-timeline__headers">
          <div className="v-timeline__rulerSpacer" />
          {rows.map(({ track }) => (
            <div
              key={track.id}
              className="v-timeline__header"
              style={{ height: `${trackHeight(track)}px` }}
            >
              <span className="v-timeline__headerName">{track.name}</span>
              <span className="v-timeline__headerKind">{t(`track.kind.${track.kind}`)}</span>
            </div>
          ))}
        </div>

        <div className="v-timeline__scroll" ref={scrollRef}>
          <div className="v-timeline__content" style={{ width: `${contentWidth}px` }}>
            <Ruler range={range} flicksPerPixel={flicksPerPixel} fps={project.settings.fps} />
            <div className="v-timeline__tracks">
              {rows.map(({ track, index }) => (
                <Track
                  key={track.id}
                  track={track}
                  index={index}
                  flicksPerPixel={flicksPerPixel}
                  range={range}
                  mediaNames={mediaNames}
                />
              ))}
            </div>
            <div
              className="v-timeline__playhead"
              data-testid="timeline-playhead"
              style={{ left: `${timeToX(playhead, flicksPerPixel)}px` }}
            />
          </div>
        </div>
      </div>

      {tracks.length === 0 && <p className="v-timeline__empty">{t("empty.noTracks")}</p>}
    </section>
  );
}

function timelineEnd(project: Project): Time {
  return project.timeline.tracks.reduce((longest, track) => {
    // Clips are kept sorted by start, but the last one is not necessarily the longest.
    const end = track.clips.reduce((last, clip) => Math.max(last, clip.start + clip.duration), 0);
    return Math.max(longest, end);
  }, 0);
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

export type ZoomBy = (factor: number, anchorX: number) => void;

// Zooming keeps the time under the anchor pixel where it was; without that the timeline jumps
// away from whatever the user was pointing at.
function useAnchoredZoom(
  ref: RefObject<HTMLElement | null>,
  flicksPerPixel: number,
  setFlicksPerPixel: (next: number) => void,
  contentDuration: Time,
): ZoomBy {
  const pending = useRef<{ time: Time; x: number }>(undefined);

  useLayoutEffect(() => {
    const anchor = pending.current;
    const element = ref.current;
    pending.current = undefined;
    if (anchor === undefined || element === null) return;
    element.scrollLeft = Math.max(0, timeToX(anchor.time, flicksPerPixel) - anchor.x);
  }, [ref, flicksPerPixel]);

  return useCallback(
    (factor, anchorX) => {
      const next = clampZoom(flicksPerPixel * factor, contentDuration);
      if (next === flicksPerPixel) return;
      const element = ref.current;
      const scrollLeft = element?.scrollLeft ?? 0;
      pending.current = { time: xToTime(scrollLeft + anchorX, flicksPerPixel), x: anchorX };
      setFlicksPerPixel(next);
    },
    [ref, flicksPerPixel, setFlicksPerPixel, contentDuration],
  );
}
