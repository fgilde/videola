import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";

import {
  cmd,
  FLICKS_PER_SECOND,
  type Clip as ClipModel,
  type ClipId,
  type Command,
  type Project,
  type Time,
  type TrackId,
} from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { mediaNameIndex } from "./Clip";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { Ruler } from "./Ruler";
import { Track } from "./Track";
import {
  findClip,
  groupMates,
  selectionAfter,
  useTimelineGestures,
  type DragMode,
  type EdgeMode,
  type SelectHow,
} from "./useTimelineGestures";
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

const EDGE_MODES: EdgeMode[] = ["trim", "ripple", "roll"];
const DRAG_MODES: DragMode[] = ["move", "slip", "slide"];

// One clipboard entry keeps the track it came from, so a paste lands where the material was cut
// rather than always on the first track.
interface Copied {
  clip: ClipModel;
  track: TrackId;
}

let actionSequence = 0;

export interface TimelineProps {
  project: Project;
  playhead: Time;
  /**
   * Must throw when the core refuses a command, and must not report it itself. Hitting a clip's
   * limit is ordinary during a drag and the timeline swallows it; a caller that catches first
   * produces one error banner per pointer movement.
   */
  dispatch: (command: Command, coalesceKey?: string) => void;
  onSeek: (time: Time) => void;
  onSelectionChange?: (clips: readonly ClipId[]) => void;
}

export function Timeline({
  project,
  playhead,
  dispatch,
  onSeek,
  onSelectionChange,
}: TimelineProps): ReactElement {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const clipboard = useRef<Copied[]>([]);
  const [flicksPerPixel, setFlicksPerPixel] = useState(DEFAULT_FLICKS_PER_PIXEL);
  const [selected, setSelected] = useState<ReadonlySet<ClipId>>(() => new Set());
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [edgeMode, setEdgeMode] = useState<EdgeMode>("trim");
  const [dragMode, setDragMode] = useState<DragMode>("move");
  const viewport = useViewport(scrollRef);
  const end = useMemo(() => projectEnd(project), [project]);
  const zoom = useAnchoredZoom(scrollRef, flicksPerPixel, setFlicksPerPixel, end);
  const range: TimeRange = visibleRange(viewport.scrollLeft, viewport.width, flicksPerPixel);

  const select = useCallback(
    (clip: ClipId | undefined, how?: SelectHow) => {
      setSelected((current) => {
        const next = selectionAfter(project, current, clip, how);
        onSelectionChange?.([...next]);
        return next;
      });
    },
    [project, onSelectionChange],
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
    selection: selected,
    zoom,
    snapEnabled,
    edgeMode,
    dragMode,
    range,
  });

  const tracks = project.timeline.tracks;
  // Top row first, because tracks[0] is the one the compositor draws lowest.
  const rows = useMemo(() => tracks.map((track, index) => ({ track, index })).reverse(), [tracks]);
  const mediaNames = useMemo(() => mediaNameIndex(project.library), [project.library]);
  const markers = project.markers.filter(
    (marker) => marker.time >= range.from && marker.time <= range.to,
  );
  const menu = gestures.menu;
  // One viewport of slack past the end, so a clip can always be dragged beyond what exists.
  const contentWidth = timeToX(end, flicksPerPixel) + Math.max(viewport.width, 1);

  const remove = useCallback(
    (ripple: boolean) => {
      const key = `timeline-delete-${(actionSequence += 1)}`;
      for (const clip of selected) {
        dispatch(ripple ? cmd.clipRippleDelete(clip) : cmd.clipRemove(clip), key);
      }
      select(undefined);
    },
    [selected, dispatch, select],
  );

  const copy = useCallback(() => {
    const copied: Copied[] = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selected.has(clip.id)) copied.push({ clip, track: track.id });
      }
    }
    clipboard.current = copied;
  }, [project, selected]);

  const paste = useCallback(() => {
    const copied = clipboard.current;
    const first = copied[0];
    if (first === undefined) return;
    // The clips keep their spacing, with the earliest one landing on the playhead.
    const earliest = copied.reduce((lowest, entry) => Math.min(lowest, entry.clip.start), Infinity);
    const key = `timeline-paste-${(actionSequence += 1)}`;
    const fallback = project.timeline.tracks[0]?.id;
    for (const entry of copied) {
      const track = project.timeline.tracks.some((candidate) => candidate.id === entry.track)
        ? entry.track
        : fallback;
      if (track === undefined) return;
      dispatch(cmd.clipPaste(track, entry.clip, playhead + entry.clip.start - earliest), key);
    }
  }, [project, dispatch, playhead]);

  const cut = useCallback(() => {
    copy();
    remove(false);
  }, [copy, remove]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const action = shortcut(event);
      if (action === undefined) return;
      event.preventDefault();
      switch (action) {
        case "delete":
          return remove(false);
        case "rippleDelete":
          return remove(true);
        case "copy":
          return copy();
        case "cut":
          return cut();
        case "paste":
          return paste();
        case "group":
          return dispatch(cmd.clipGroup([...selected]));
        case "ungroup":
          // One command per group, not per clip: the first one dissolves the group, and the
          // second clip of it would then be a clip the core rightly says is in no group.
          for (const clip of groupLeaders(project, selected)) dispatch(cmd.clipUngroup(clip));
          return;
        case "marker":
          return dispatch(cmd.markerAdd(playhead, ""));
      }
    },
    [remove, copy, cut, paste, dispatch, project, selected, playhead],
  );

  return (
    <section
      className="v-timeline"
      aria-label={t("timeline.label")}
      data-testid="timeline"
      onKeyDown={onKeyDown}
    >
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
        {/* Two plain selects rather than modifier keys: a finger has no modifiers, and the mode a
            drag is in has to be readable before the drag, not guessed from what it just did. */}
        <select
          aria-label={t("timeline.edgeMode")}
          value={edgeMode}
          onChange={(event) => setEdgeMode(event.target.value as EdgeMode)}
        >
          {EDGE_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`timeline.edgeMode.${mode}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("timeline.dragMode")}
          value={dragMode}
          onChange={(event) => setDragMode(event.target.value as DragMode)}
        >
          {DRAG_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`timeline.dragMode.${mode}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="v-button"
          onClick={() => dispatch(cmd.markerAdd(playhead, ""))}
        >
          {t("timeline.addMarker")}
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
                  selected={selected}
                  trimZonePx={gestures.trimZonePx}
                  onSelect={select}
                />
              ))}
            </div>
            {markers.map((marker) => (
              <button
                key={marker.id}
                type="button"
                className="v-timeline__marker"
                data-marker-id={marker.id}
                style={{
                  left: `${timeToX(marker.time, flicksPerPixel)}px`,
                  backgroundColor: marker.colorHex,
                }}
                aria-label={
                  marker.label === ""
                    ? t("timeline.markerUnnamed")
                    : t("timeline.marker", { label: marker.label })
                }
                onClick={() => onSeek(marker.time)}
              />
            ))}
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

      {menu !== undefined && (
        <TimelineContextMenu
          menu={menu}
          project={project}
          playhead={playhead}
          selected={selected}
          hasClipboard={clipboard.current.length > 0}
          dispatch={dispatch}
          onClose={gestures.closeMenu}
          onDelete={remove}
          onCopy={copy}
          onCut={cut}
          onPaste={paste}
        />
      )}
    </section>
  );
}

interface MenuProps {
  menu: NonNullable<ReturnType<typeof useTimelineGestures>["menu"]>;
  project: Project;
  playhead: Time;
  selected: ReadonlySet<ClipId>;
  hasClipboard: boolean;
  dispatch: (command: Command, coalesceKey?: string) => void;
  onClose: () => void;
  onDelete: (ripple: boolean) => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
}

// Every entry either does something or is disabled. What decides that is read at render time and
// not when the menu opened: the playhead moves while the menu stands, and a clip can be gone by
// the time an entry is clicked.
function TimelineContextMenu(props: MenuProps): ReactElement | null {
  const { t } = useI18n();
  const { menu, project, playhead, selected, dispatch, onClose } = props;

  if (menu.target.kind === "marker") {
    const marker = menu.target.marker;
    if (!project.markers.some((candidate) => candidate.id === marker)) return null;
    return (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        label={t("timeline.markerMenu")}
        onClose={onClose}
        items={[
          {
            label: t("timeline.deleteMarker"),
            onSelect: () => {
              dispatch(cmd.markerRemove(marker));
              onClose();
            },
          },
        ]}
      />
    );
  }

  const clip = findClip(project, menu.target.clip)?.clip;
  if (clip === undefined) return null;
  const close = (action: () => void) => () => {
    action();
    onClose();
  };
  const items: MenuItem[] = [
    {
      label: t("timeline.split"),
      disabled: !(playhead > clip.start && playhead < clip.start + clip.duration),
      onSelect: close(() => dispatch(cmd.clipSplit(clip.id, playhead))),
    },
    { label: t("timeline.deleteClip"), onSelect: close(() => props.onDelete(false)) },
    { label: t("timeline.rippleDelete"), onSelect: close(() => props.onDelete(true)) },
    { label: t("timeline.copy"), onSelect: close(props.onCopy) },
    { label: t("timeline.cut"), onSelect: close(props.onCut) },
    { label: t("timeline.paste"), disabled: !props.hasClipboard, onSelect: close(props.onPaste) },
    {
      label: t("timeline.group"),
      disabled: selected.size < 2,
      onSelect: close(() => dispatch(cmd.clipGroup([...selected]))),
    },
    {
      label: t("timeline.ungroup"),
      disabled: groupMates(project, clip.id).length < 2,
      onSelect: close(() => dispatch(cmd.clipUngroup(clip.id))),
    },
  ];
  return (
    <ContextMenu x={menu.x} y={menu.y} label={t("timeline.clipMenu")} items={items} onClose={onClose} />
  );
}

// One clip out of every group the selection touches, so a command that acts on a whole group is
// sent once per group.
function groupLeaders(project: Project, selected: ReadonlySet<ClipId>): ClipId[] {
  const seen = new Set<string>();
  const leaders: ClipId[] = [];
  for (const clip of project.timeline.tracks.flatMap((track) => track.clips)) {
    if (!selected.has(clip.id) || clip.groupId == null || seen.has(clip.groupId)) continue;
    seen.add(clip.groupId);
    leaders.push(clip.id);
  }
  return leaders;
}

type Shortcut =
  | "delete"
  | "rippleDelete"
  | "copy"
  | "cut"
  | "paste"
  | "group"
  | "ungroup"
  | "marker";

// A pure function of the event, so the keys a timeline answers to can be read in one place.
function shortcut(event: KeyboardEvent<HTMLElement>): Shortcut | undefined {
  const command = event.ctrlKey || event.metaKey;
  if (event.key === "Delete" || event.key === "Backspace") {
    return event.shiftKey ? "rippleDelete" : "delete";
  }
  if (command && event.key.toLowerCase() === "c") return "copy";
  if (command && event.key.toLowerCase() === "x") return "cut";
  if (command && event.key.toLowerCase() === "v") return "paste";
  if (command && event.key.toLowerCase() === "g") return event.shiftKey ? "ungroup" : "group";
  if (!command && event.key.toLowerCase() === "m") return "marker";
  return undefined;
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
