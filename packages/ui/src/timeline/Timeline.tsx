import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";

import {
  canMergeCaptions,
  cmd,
  FLICKS_PER_SECOND,
  mergeCaptions,
  on,
  pasteAttributes,
  transitionEveryCut,
  splitScreen,
  stageFor,
  type Clip as ClipModel,
  type ClipId,
  type Command,
  type CurveShape,
  type Interp,
  type Keyframe,
  type MediaId,
  type Project,
  type Time,
  type TrackId,
} from "@videola/core";

import type { Peaks } from "@videola/media";

import { useI18n } from "../i18n/useI18n";
import type { EffectDescriptor } from "../inspector/Inspector";
import { Icon, IconButton } from "../primitives/Icon";
import { chosenTransition } from "../inspector/Inspector";
import { mediaNameIndex } from "./Clip";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { KeyframeCurve } from "./KeyframeCurve";
import { KeyframeLane, KeyframeLaneHeaders, paramLabel, type KeyframeSelection } from "./KeyframeLane";
import {
  isSpeedRow,
  laneRows,
  offeredFor,
  OFFERED_ON_SPEED,
  type LaneRow,
} from "./keyframes";
import { MarkerList } from "./MarkerList";
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
  trackAt,
  trackHeight,
  visibleRange,
  xToTime,
  type MediaDrop,
  type MediaGrab,
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

// How long a freeze holds by default: two seconds, which is what a beat on a face is.
const FREEZE_HOLD = 2 * FLICKS_PER_SECOND;

export interface TimelineProps {
  project: Project;
  playhead: Time;
  /**
   * True while the transport is running. The view then pages ahead to keep the playhead on screen;
   * standing still it never scrolls itself, because a view that moves under a hand that is not
   * asking it to is a view nobody can aim.
   */
  playing?: boolean;
  /**
   * Peaks per clip id, from whoever decoded the audio. Absent means no strip at all rather than an
   * empty one: a flat line promises a signal that has not been read yet.
   */
  waveforms?: ReadonlyMap<string, Peaks>;
  /**
   * What the keyframe lane calls an effect and its parameters. Absent means the lane falls back to
   * the raw keys -- a track under a name no manifest declares is a project from a later version,
   * and showing the name it carries beats showing nothing.
   */
  effects?: readonly EffectDescriptor[];
  /**
   * The core's own easing, sampled: what the curve editor plots. Absent means no curve editor at
   * all, only the presets -- a curve drawn from a second easing written on this side would look
   * like one thing and animate like another, and offering it without the core is exactly that.
   */
  curveShape?: CurveShape;
  /**
   * Must throw when the core refuses a command, and must not report it itself. Hitting a clip's
   * limit is ordinary during a drag and the timeline swallows it; a caller that catches first
   * produces one error banner per pointer movement.
   */
  dispatch: (command: Command, coalesceKey?: string) => void;
  onSeek: (time: Time) => void;
  /** Cut every clip the markers pass through. Absent where the host offers no such edit. */
  onSplitAtMarkers?: () => void;
  /**
   * Hold one frame of this clip for a while. Composed of two cuts and a rate of zero, which needs the
   * project as it stands *between* those edits — so it is the host's to run, not this component's: a
   * prop is a snapshot, and the second cut would name a clip the first one had already retired.
   */
  onFreeze?: (clip: ClipId, at: Time, hold: Time) => void;
  onSelectionChange?: (clips: readonly ClipId[]) => void;
  /**
   * A medium the media library has under a pointer. The timeline judges the whole gesture from
   * here on -- the drag threshold, the track under the finger and the time it lands on are all its
   * own geometry, and a second opinion on any of them could disagree with the first.
   */
  grab?: MediaGrab;
  /** Released over a track. One command, so one undo step. */
  onDropMedia?: (drop: MediaDrop) => void;
  /** Released anywhere else, or cancelled. The grab is over either way. */
  onGrabEnd?: () => void;
}

export function Timeline({
  project,
  playhead,
  playing = false,
  waveforms,
  effects = [],
  curveShape,
  dispatch,
  onSeek,
  onSplitAtMarkers,
  onFreeze,
  onSelectionChange,
  grab,
  onDropMedia,
  onGrabEnd,
}: TimelineProps): ReactElement {
  const { t, locale } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const clipboard = useRef<Copied[]>([]);
  const [flicksPerPixel, setFlicksPerPixel] = useState(DEFAULT_FLICKS_PER_PIXEL);
  const [selected, setSelected] = useState<ReadonlySet<ClipId>>(() => new Set());
  const [keyframe, setKeyframe] = useState<KeyframeSelection>();
  // Kept here rather than left to the element: a `<details>` that owns its own state closes every
  // time the bar around it is rebuilt -- which is on every pointer move of a handle drag, and on
  // every change of picked key. Somebody shaping one curve after another opens it once.
  const [curveOpen, setCurveOpen] = useState(false);
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
    onSelectMany: useCallback(
      (clips: readonly ClipId[]) => {
        setSelected(new Set(clips));
        onSelectionChange?.([...clips]);
      },
      [onSelectionChange],
    ),
    onSelectKeyframe: useCallback((hit) => setKeyframe({ row: hit.row, time: hit.time }), []),
    selection: selected,
    zoom,
    snapEnabled,
    edgeMode,
    dragMode,
    range,
  });

  const tracks = project.timeline.tracks;
  const dropping = useMediaDrop({
    grab,
    project,
    flicksPerPixel,
    surface: scrollRef,
    tracksArea: tracksRef,
    onDropMedia,
    onGrabEnd,
  });
  // Top row first, because tracks[0] is the one the compositor draws lowest.
  const rows = useMemo(() => tracks.map((track, index) => ({ track, index })).reverse(), [tracks]);
  const mediaNames = useMemo(() => mediaNameIndex(project.library), [project.library]);
  const markers = project.markers.filter(
    (marker) => marker.time >= range.from && marker.time <= range.to,
  );
  const menu = gestures.menu;
  // One viewport of slack past the end, so a clip can always be dragged beyond what exists.
  const contentWidth = timeToX(end, flicksPerPixel) + Math.max(viewport.width, 1);

  // The lane follows the clip selection, so it and the inspector are always showing the same clip.
  const laneClip = useMemo(() => {
    const first = [...selected][0];
    return first === undefined ? undefined : findClip(project, first)?.clip;
  }, [project, selected]);
  const laneRowList = useMemo(() => (laneClip === undefined ? [] : laneRows(laneClip)), [laneClip]);
  // Derived rather than kept in step by an effect: a keyframe that was deleted, or one on a clip
  // that is no longer selected, simply stops being found -- there is no stale selection to clear.
  const picked = pickedKeyframe(laneRowList, keyframe);

  const removeKeyframe = useCallback(() => {
    if (laneClip === undefined || picked === undefined) return;
    dispatch(
      cmd.keyframeRemove(
        on.clip(laneClip.id),
        picked.row.effectType,
        picked.row.key,
        picked.entry.time,
      ),
    );
    setKeyframe(undefined);
  }, [dispatch, laneClip, picked]);

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

  // The model is the clip on the clipboard, which is what a copy already put there. A second store
  // for "the clip whose look I want" would be a second thing to keep in step with the first, and
  // the question "which clip is the model" has one honest answer: the one you copied.
  const pasteLook = useCallback(() => {
    const model = clipboard.current[0]?.clip;
    if (model === undefined || selected.size === 0) return;
    const key = `timeline-attributes-${(actionSequence += 1)}`;
    for (const command of pasteAttributes(model, [...selected])) dispatch(command, key);
  }, [dispatch, selected]);

  // A selection is a set of ids, and an undo, a ripple delete or a nest can take the clip an id
  // names away. Pruned here, once, rather than at every use: a set holding a dead id is not merely
  // untidy -- every action that reads "is there a selection" then says yes and finds nothing to do,
  // which is exactly how a key that works comes to look broken.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const live = new Set<ClipId>();
      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) if (current.has(clip.id)) live.add(clip.id);
      }
      if (live.size === current.size) return current;
      onSelectionChange?.([...live]);
      return live;
    });
  }, [project, onSelectionChange]);

  // The view pages ahead of a running transport rather than following it pixel by pixel: a scroll
  // that moves every frame is unreadable, and one that moves every frame under a finger fights the
  // finger. A tenth of the width of lead-in, so the playhead arrives with the next few seconds
  // already visible instead of glued to the left edge.
  //
  // Only while playing. Standing still, the timeline never scrolls itself -- somebody who scrolled
  // away to look at something else did that on purpose.
  useLayoutEffect(() => {
    if (!playing) return;
    const element = scrollRef.current;
    if (element === null || element.clientWidth < 1) return;
    const x = timeToX(playhead, flicksPerPixel);
    const width = element.clientWidth;
    const lead = width / 10;
    if (x >= element.scrollLeft + width - lead || x < element.scrollLeft) {
      element.scrollLeft = Math.max(0, x - lead);
    }
  }, [playing, playhead, flicksPerPixel]);

  // The whole edit in the window, which is where a person starts and returns to. Set rather than
  // stepped: a factor from here would need a loop, and the loop would stop on the clamp at a zoom
  // that is nearly right instead of the one that fits.
  const fit = useCallback(() => {
    if (viewport.width < 1) return;
    setFlicksPerPixel(clampZoom(end / viewport.width, end));
    if (scrollRef.current !== null) scrollRef.current.scrollLeft = 0;
  }, [end, viewport.width]);

  // Around the playhead where the playhead is on screen, around the middle of the view otherwise.
  // Zooming away from what somebody is working on is what a fixed centre does the moment they have
  // scrolled anywhere.
  const zoomBy = useCallback(
    (factor: number) => {
      const at = timeToX(playhead, flicksPerPixel) - viewport.scrollLeft;
      const anchor = at >= 0 && at <= viewport.width ? at : viewport.width / 2;
      zoom(factor, anchor);
    },
    [zoom, playhead, flicksPerPixel, viewport.scrollLeft, viewport.width],
  );

  const selectAll = useCallback(() => {
    const every = project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
    setSelected(new Set(every));
    onSelectionChange?.(every);
  }, [project, onSelectionChange]);

  // A copy laid down directly behind the original, which is what a duplicate is. Through `clip.paste`
  // and not through a second kind of add: the clipboard path already carries every attribute a clip
  // has, and a duplicate that carried fewer would be a copy that quietly lost its effects.
  const duplicate = useCallback(() => {
    const key = `timeline-duplicate-${(actionSequence += 1)}`;
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (!selected.has(clip.id)) continue;
        dispatch(cmd.clipPaste(track.id, clip, clip.start + clip.duration), key);
      }
    }
  }, [project, selected, dispatch]);

  // Every selected clip the playhead stands inside, or -- with nothing selected -- every clip it
  // stands inside at all. A key that did nothing where nothing was selected would be the one people
  // press first and report as broken.
  const split = useCallback(() => {
    const key = `timeline-split-${(actionSequence += 1)}`;
    let cut = 0;
    for (const track of project.timeline.tracks) {
      if (track.locked) continue;
      for (const clip of track.clips) {
        if (selected.size > 0 && !selected.has(clip.id)) continue;
        if (playhead <= clip.start || playhead >= clip.start + clip.duration) continue;
        dispatch(cmd.clipSplit(clip.id, playhead), key);
        cut += 1;
      }
    }
    return cut;
  }, [project, selected, playhead, dispatch]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const action = shortcut(event);
      if (action === undefined) return;
      event.preventDefault();
      // A keyframe under the hand is what the delete keys aim at; there is no rippling a keyframe,
      // so both spellings mean the one thing they can mean here.
      if (picked !== undefined && (action === "delete" || action === "rippleDelete")) {
        return removeKeyframe();
      }
      switch (action) {
        case "split":
          return void split();
        case "duplicate":
          return duplicate();
        case "selectAll":
          return selectAll();
        case "zoomIn":
          return zoomBy(1 / ZOOM_FACTOR);
        case "zoomOut":
          return zoomBy(ZOOM_FACTOR);
        case "zoomFit":
          return fit();
        case "toStart":
          return onSeek(0);
        case "toEnd":
          return onSeek(end);
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
        case "nest":
          // The core refuses an empty list, and a refusal out of a key nobody aimed anywhere is
          // an error banner for a keystroke that meant nothing.
          if (selected.size === 0) return;
          return dispatch(cmd.clipNest([...selected]));
        case "marker":
          return dispatch(cmd.markerAdd(playhead, ""));
      }
    },
    [
      remove,
      copy,
      cut,
      paste,
      dispatch,
      project,
      selected,
      playhead,
      picked,
      removeKeyframe,
      split,
      duplicate,
      selectAll,
      zoomBy,
      fit,
      onSeek,
      end,
    ],
  );

  return (
    <section
      className="v-timeline"
      aria-label={t("timeline.label")}
      data-testid="timeline"
      onKeyDown={onKeyDown}
    >
      {/* Symbols, not words. Six German labels at 44 px each are a whole row of the screen on a
          tablet, and every one of them is a tool a person reaches for by shape. */}
      <div className="v-timeline__toolbar">
        <div className="v-timeline__tools">
          <IconButton
            icon="zoomOut"
            label={t("timeline.zoomOut")}
            onClick={() => zoom(ZOOM_FACTOR, viewport.width / 2)}
          />
          <IconButton
            icon="zoomIn"
            label={t("timeline.zoomIn")}
            onClick={() => zoom(1 / ZOOM_FACTOR, viewport.width / 2)}
          />
          <IconButton
            icon="magnet"
            label={t("timeline.snap")}
            pressed={snapEnabled}
            onClick={() => setSnapEnabled((on) => !on)}
          />
          <IconButton
            icon="flag"
            label={t("timeline.addMarker")}
            onClick={() => dispatch(cmd.markerAdd(playhead, ""))}
          />
          {/* Beside the button that sets one, and opening over the tracks rather than above them:
              the picture is the largest zone on this screen and a list nobody has opened must not
              take a row of it. */}
          <MarkerList
            markers={project.markers}
            fps={project.settings.fps}
            dispatch={dispatch}
            onSeek={onSeek}
            onSplitAtMarkers={onSplitAtMarkers}
          />
          {/* A slideshow is fifty pictures and forty-nine dissolves. The select names the transition
              and the walk finds the cuts, so what would be forty-nine trips through the properties
              panel is one choice -- and its first entry takes them all away again. */}
          {effects.length > 0 && (
            <select
              className="v-timeline__everyCut"
              aria-label={t("timeline.everyCut")}
              value=""
              onChange={(event) => {
                const picked = event.target.value;
                if (picked === "") return;
                const key = `timeline-transitions-${(actionSequence += 1)}`;
                // "none" and the empty heading are different answers: the heading is "I have not
                // chosen", and one that cleared every transition would do it the moment the select
                // was reset after a choice.
                const chosen = picked === "none" ? null : chosenTransition(picked, undefined);
                for (const command of transitionEveryCut(project, chosen)) dispatch(command, key);
              }}
            >
              <option value="">{t("timeline.everyCut")}</option>
              <option value="none">{t("timeline.everyCutNone")}</option>
              {effects
                .filter((effect) => effect.inputs === 2)
                .map((effect) => (
                  <option key={effect.id} value={effect.id}>
                    {effect.name[locale]}
                  </option>
                ))}
            </select>
          )}
        </div>
        {/* Two plain selects rather than modifier keys: a finger has no modifiers, and the mode a
            drag is in has to be readable before the drag, not guessed from what it just did.
            A group of its own, so on a phone the two of them wrap together instead of leaving one
            symbol stranded on a line by itself. */}
        <div className="v-timeline__modes">
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
        </div>
      </div>

      {/* Only while a keyframe is picked, and outside the scrolling area on purpose: what a
          keyframe is set to has to stay reachable while the lane it lives on is scrolled. */}
      {picked !== undefined && laneClip !== undefined && (
        <div className="v-timeline__keybar" data-testid="keyframe-bar">
          <>
            <span className="v-timeline__keybarName">
              {paramLabel(picked.row, effects, locale, t)}
            </span>
            <select
              aria-label={t("keyframe.interp")}
              value={picked.entry.interp}
              onChange={(event) =>
                dispatch(
                  cmd.keyframeSetInterp(
                    on.clip(laneClip.id),
                    picked.row.effectType,
                    picked.row.key,
                    picked.entry.time,
                    event.target.value as Interp,
                  ),
                )
              }
            >
              {/* The three presets stay one click, and the curve is the fourth entry rather than a
                  mode that replaces them. A rate track never gets it: `integrate` has no exact
                  answer for a bezier, and the core refuses the change -- an entry that could only
                  produce a refusal is worse than one that is not there. */}
              {offeredFor(
                picked.entry.interp,
                isSpeedRow(picked.row) ? OFFERED_ON_SPEED : undefined,
              ).map((interp) => (
                <option key={interp} value={interp}>
                  {t(`interp.${interp}`)}
                </option>
              ))}
            </select>
            {/* A finger has no Delete key, and this is the only way to reach the one thing a picked
                keyframe can have done to it without one. */}
            <IconButton icon="trash" label={t("keyframe.delete")} onClick={removeKeyframe} />
          </>
          {/* A native disclosure that opens over the tracks, exactly like the marker list beside it
              and for the same reason: the field is square, the timeline is the shortest panel on
              this screen, and a curve nobody has opened must not take a row away from it.
              Only where there is a segment to shape -- the last key of a track has none, and its own
              arriving handle belongs to the field of the key before it. */}
          {curveShape !== undefined && curveNeighbour(picked) !== undefined && (
            <details
              className="v-keycurve__disclosure"
              data-testid="keyframe-curve-disclosure"
              open={curveOpen}
              onToggle={(event) => setCurveOpen(event.currentTarget.open)}
            >
              <summary className="v-keycurve__summary">{t("keyframe.curve")}</summary>
              <KeyframeCurve
                clip={laneClip.id}
                row={picked.row}
                rows={laneRowList}
                left={picked.entry}
                right={curveNeighbour(picked) as Keyframe}
                curveShape={curveShape}
                dispatch={dispatch}
              />
            </details>
          )}
        </div>
      )}

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
              {/* On the header and not in a menu: a lock is read as often as it is set -- the
                  question "why will this clip not move" is answered by looking at the row. */}
              <button
                type="button"
                className="v-timeline__lock"
                aria-label={t(track.locked ? "track.unlock" : "track.lock", { name: track.name })}
                title={t(track.locked ? "track.unlock" : "track.lock", { name: track.name })}
                aria-pressed={track.locked}
                onClick={() => dispatch(cmd.trackSetFlags(track.id, null, null, !track.locked, null))}
              >
                <Icon name={track.locked ? "lock" : "unlock"} />
              </button>
            </div>
          ))}
          <KeyframeLaneHeaders rows={laneRowList} effects={effects} />
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
                  dropTarget={dropping?.track === track.id}
                  onSelect={select}
                />
              ))}
            </div>
            {/* Inside the same content the tracks are in, so the lane's x axis is the timeline's
                x axis by construction rather than by agreement, and the playhead crosses it. */}
            {laneClip !== undefined && (
              <KeyframeLane
                clip={laneClip}
                rows={laneRowList}
                flicksPerPixel={flicksPerPixel}
                range={range}
                fps={project.settings.fps}
                effects={effects}
                selection={picked === undefined ? undefined : keyframe}
              />
            )}
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
            {dropping !== undefined && (
              <div
                className="v-timeline__dropLine"
                data-testid="timeline-dropline"
                style={{ left: `${timeToX(dropping.at, flicksPerPixel)}px` }}
              />
            )}
            <div
              className="v-timeline__playhead"
              data-testid="timeline-playhead"
              style={{ left: `${timeToX(playhead, flicksPerPixel)}px` }}
            />
            {/* Drawn inside the tracks area and after the clips, so it lies over them: the band is
                feedback about a gesture in flight and has to be visible over what it covers. */}
            {gestures.marquee !== undefined && (
              <div
                className="v-timeline__marquee"
                data-testid="timeline-marquee"
                style={{
                  left: `${gestures.marquee.left}px`,
                  top: `${gestures.marquee.top}px`,
                  width: `${gestures.marquee.width}px`,
                  height: `${gestures.marquee.height}px`,
                }}
              />
            )}
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
          onPasteLook={pasteLook}
          onFreeze={onFreeze}
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
  onPasteLook: () => void;
  onFreeze?: (clip: ClipId, at: Time, hold: Time) => void;
}

// Every entry either does something or is disabled. What decides that is read at render time and
// not when the menu opened: the playhead moves while the menu stands, and a clip can be gone by
// the time an entry is clicked.
// Exactly two clips, in the order the tracks stack them, or nothing. A split screen of one clip is
// not a split screen, and of three there is no half to give the third.
function splitPair(
  project: Project,
  selected: ReadonlySet<string>,
): readonly [ClipModel, ClipModel] | undefined {
  const found = project.timeline.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => selected.has(clip.id));
  return found.length === 2 ? ([found[0]!, found[1]!] as const) : undefined;
}

// The lowest video track above the one a clip stands on, so the second half of a split screen has
// somewhere to go when both clips started on the same track.
function trackAbove(project: Project, clip: string): string | undefined {
  const index = project.timeline.tracks.findIndex((track) =>
    track.clips.some((candidate) => candidate.id === clip),
  );
  if (index < 0) return undefined;
  return project.timeline.tracks.slice(index + 1).find((track) => track.kind === "video")?.id;
}

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
    {
      // Two seconds, which is what a beat on a face is. It has to fit inside the clip with material
      // left over on both sides: a freeze at an edge is a cut with nothing between its two halves.
      label: t("timeline.freeze"),
      disabled:
        props.onFreeze === undefined ||
        !(playhead > clip.start && playhead + FREEZE_HOLD < clip.start + clip.duration),
      onSelect: close(() => props.onFreeze?.(clip.id, playhead, FREEZE_HOLD)),
    },
    { label: t("timeline.deleteClip"), onSelect: close(() => props.onDelete(false)) },
    { label: t("timeline.rippleDelete"), onSelect: close(() => props.onDelete(true)) },
    { label: t("timeline.copy"), onSelect: close(props.onCopy) },
    { label: t("timeline.cut"), onSelect: close(props.onCut) },
    { label: t("timeline.paste"), disabled: !props.hasClipboard, onSelect: close(props.onPaste) },
    {
      label: t("timeline.pasteAttributes"),
      disabled: !props.hasClipboard || props.selected.size === 0,
      onSelect: close(props.onPasteLook),
    },
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
    {
      label: t("timeline.nest"),
      disabled: selected.size < 1,
      onSelect: close(() => dispatch(cmd.clipNest([...selected]))),
    },
    // Beside split, because they are the same pair of gestures on a caption: cut one in two, or
    // fold two into one. Three commands under one key, so the whole merge is one undo step and a
    // half-merged pair is never a state anyone can land on.
    {
      label: t("timeline.mergeCaption"),
      disabled: !canMergeCaptions(project, clip.id),
      onSelect: close(() => {
        const key = `timeline-merge-caption-${(actionSequence += 1)}`;
        for (const command of mergeCaptions(project, clip.id)) dispatch(command, key);
      }),
    },
    // The one preset that belongs here rather than in the inspector: it is the only one about two
    // clips, and the timeline is where two clips are selected. The rest live beside the clip's own
    // settings, which is what they are.
    {
      label: t("timeline.splitScreen"),
      disabled: splitPair(project, selected) === undefined,
      onSelect: close(() => {
        const pair = splitPair(project, selected);
        if (pair === undefined) return;
        const key = `timeline-split-screen-${(actionSequence += 1)}`;
        const above = trackAbove(project, pair[1].id);
        const stages = [stageFor(project, pair[0]), stageFor(project, pair[1])] as const;
        for (const command of splitScreen(pair, stages, "sideBySide", above)) {
          dispatch(command, key);
        }
      }),
    },
  ];
  return (
    <ContextMenu x={menu.x} y={menu.y} label={t("timeline.clipMenu")} items={items} onClose={onClose} />
  );
}

/**
 * The keyframe the lane has picked, resolved against the rows that exist right now. A row that is
 * gone, or a time nothing sits at any more, is simply not found -- which is what makes a delete and
 * a change of clip need no cleanup of their own.
 */
function pickedKeyframe(
  rows: readonly LaneRow[],
  selection: KeyframeSelection | undefined,
): { row: LaneRow; entry: Keyframe } | undefined {
  if (selection === undefined) return undefined;
  const row = rows.find((candidate) => candidate.id === selection.row);
  const entry = row?.track.find((candidate) => candidate.time === selection.time);
  return row === undefined || entry === undefined ? undefined : { row, entry };
}

/**
 * The key after the picked one on the same row, which is the other end of the segment a curve field
 * shapes. Nothing where the picked key is the last: there is no travel after it to time, and its own
 * incoming handle is reached from the field of the key before it.
 */
function curveNeighbour(picked: { row: LaneRow; entry: Keyframe }): Keyframe | undefined {
  const index = picked.row.track.findIndex((entry) => entry.time === picked.entry.time);
  return index < 0 ? undefined : picked.row.track[index + 1];
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
  | "split"
  | "duplicate"
  | "selectAll"
  | "zoomIn"
  | "zoomOut"
  | "zoomFit"
  | "toStart"
  | "toEnd"
  | "delete"
  | "rippleDelete"
  | "copy"
  | "cut"
  | "paste"
  | "group"
  | "ungroup"
  | "nest"
  | "marker";

// Fields inside the timeline keep their own keys. The marker list renames a marker in a text input
// and picks its colour in another, and both of them sit inside this section -- so without this,
// typing "m" into a marker's name drops a marker for every letter.
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// A pure function of the event, so the keys a timeline answers to can be read in one place.
function shortcut(event: KeyboardEvent<HTMLElement>): Shortcut | undefined {
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable === true) return undefined;
  if (TYPING.has(target?.tagName ?? "")) return undefined;
  const command = event.ctrlKey || event.metaKey;
  if (event.key === "Delete" || event.key === "Backspace") {
    return event.shiftKey ? "rippleDelete" : "delete";
  }
  if (command && event.key.toLowerCase() === "c") return "copy";
  if (command && event.key.toLowerCase() === "a") return "selectAll";
  if (command && event.key.toLowerCase() === "d") return "duplicate";
  if (command && event.key.toLowerCase() === "x") return "cut";
  if (command && event.key.toLowerCase() === "v") return "paste";
  if (command && event.key.toLowerCase() === "g") return event.shiftKey ? "ungroup" : "group";
  // Unmodified, like the marker key: every ctrl/cmd combination near this one is taken by the
  // browser itself, and a shortcut the browser eats is a shortcut that does not exist.
  if (!command && event.key.toLowerCase() === "n") return "nest";
  if (!command && event.key.toLowerCase() === "m") return "marker";
  if (!command && event.key.toLowerCase() === "s") return "split";
  // Both spellings of each, because a keyboard without a numeric pad puts the plus behind a shift
  // and reports the unshifted key on some layouts either way.
  if (!command && (event.key === "+" || event.key === "=")) return "zoomIn";
  if (!command && (event.key === "-" || event.key === "_")) return "zoomOut";
  if (!command && event.key === "0") return "zoomFit";
  if (event.key === "Home") return "toStart";
  if (event.key === "End") return "toEnd";
  return undefined;
}

interface MediaDropConfig {
  grab: MediaGrab | undefined;
  project: Project;
  flicksPerPixel: number;
  surface: RefObject<HTMLElement | null>;
  tracksArea: RefObject<HTMLElement | null>;
  onDropMedia: ((drop: MediaDrop) => void) | undefined;
  onGrabEnd: (() => void) | undefined;
}

// A medium carried from the library onto a track. Listening on the window rather than on the
// timeline's own surface, because the pointer went down in the other panel and never enters this
// one as far as React's tree is concerned.
function useMediaDrop(config: MediaDropConfig): MediaDrop | undefined {
  const { grab, onDropMedia, onGrabEnd } = config;
  const [drop, setDrop] = useState<MediaDrop>();
  const latest = useRef(config);
  latest.current = config;

  useEffect(() => {
    if (grab === undefined) {
      setDrop(undefined);
      return;
    }
    // No travel threshold. A press that has not moved is still on the library entry it started
    // on, and dropAt already refuses anything that is not over the tracks -- so a threshold would
    // be a second, weaker version of a condition that is enforced anyway. A counter-check proved
    // it: removing it changed no outcome.
    const resolve = (x: number, y: number): MediaDrop | undefined =>
      dropAt(latest.current, grab, x, y);
    const onMove = (event: PointerEvent) => setDrop(resolve(event.clientX, event.clientY));
    const onUp = (event: PointerEvent) => {
      // Resolved before either callback runs, so the order the two go out in cannot matter -- a
      // counter-check on swapping them changed no outcome, and an earlier comment here claimed
      // it did.
      const landed = resolve(event.clientX, event.clientY);
      setDrop(undefined);
      if (landed !== undefined) latest.current.onDropMedia?.(landed);
      latest.current.onGrabEnd?.();
    };
    // A cancelled pointer is the browser taking the gesture over. Placing a clip the user never
    // let go of would be an edit they did not make.
    const onCancel = () => {
      setDrop(undefined);
      latest.current.onGrabEnd?.();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [grab, onDropMedia, onGrabEnd]);

  return drop;
}

// The track under the pointer and the time under it, or nothing if the pointer is not over the
// tracks at all. The same two conversions the move gesture uses, from the same geometry.
function dropAt(
  config: MediaDropConfig,
  media: MediaId,
  clientX: number,
  clientY: number,
): MediaDrop | undefined {
  const area = config.tracksArea.current;
  const surface = config.surface.current;
  if (area === null || surface === null) return undefined;
  const box = area.getBoundingClientRect();
  if (clientY < box.top || clientY > box.bottom) return undefined;
  const across = surface.getBoundingClientRect();
  if (clientX < across.left || clientX > across.right) return undefined;
  const row = trackAt(config.project.timeline.tracks, clientY - box.top);
  const track = config.project.timeline.tracks[row];
  if (track === undefined) return undefined;
  return {
    media,
    track: track.id,
    at: Math.max(0, xToTime(clientX - across.left + surface.scrollLeft, config.flicksPerPixel)),
  };
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
