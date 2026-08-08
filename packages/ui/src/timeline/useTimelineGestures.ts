import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

import {
  cmd,
  type Clip,
  type ClipId,
  type Command,
  type Project,
  type Time,
  type TrackId,
  type TrimEdge,
} from "@videola/core";

import {
  COARSE_TRIM_ZONE_PX,
  FINE_TRIM_ZONE_PX,
  tickStep,
  trackAt,
  xToTime,
  type TimeRange,
  type ZoomBy,
} from "./geometry";
import {
  snapCandidates,
  snapSpan,
  snapTime,
  SNAP_RADIUS_PX,
  type SnapCandidate,
  type SnapOptions,
} from "./snapping";

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 3;
const WHEEL_ZOOM_FACTOR = 1.15;

export interface ClipMenu {
  clip: ClipId;
  x: number;
  y: number;
}

export interface TimelineGestures {
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  onPointerMove(event: PointerEvent<HTMLElement>): void;
  onPointerUp(event: PointerEvent<HTMLElement>): void;
  onPointerCancel(event: PointerEvent<HTMLElement>): void;
  onContextMenu(event: { clientX: number; clientY: number; preventDefault(): void; target: EventTarget | null }): void;
  trimZonePx: number;
  menu: ClipMenu | undefined;
  closeMenu(): void;
  snapLine: Time | undefined;
}

export interface GestureConfig {
  project: Project;
  playhead: Time;
  flicksPerPixel: number;
  surface: RefObject<HTMLElement | null>;
  tracksArea: RefObject<HTMLElement | null>;
  dispatch: (command: Command, coalesceKey?: string) => void;
  onSeek: (time: Time) => void;
  onSelect: (clip: ClipId | undefined) => void;
  zoom: ZoomBy;
  snapEnabled: boolean;
  range: TimeRange;
}

type Drag =
  | { mode: "move"; pointerId: number; clip: ClipId; track: TrackId; clientX: number; clientY: number; start: Time; key: string; live: boolean }
  | { mode: "trim"; pointerId: number; clip: ClipId; edge: TrimEdge; clientX: number; clientY: number; edgeTime: Time; key: string; live: boolean }
  | { mode: "scrub"; pointerId: number }
  | { mode: "pinch" ; distance: number; flicksPerPixel: number };

let gestureSequence = 0;

// One pointer path for mouse, pen and touch. Two separate handlers would drift, and the phone
// layout is not an afterthought here -- it is the same code.
export function useTimelineGestures(config: GestureConfig): TimelineGestures {
  const latest = useRef(config);
  latest.current = config;

  const drag = useRef<Drag | undefined>(undefined);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [trimZonePx, setTrimZonePx] = useState(COARSE_TRIM_ZONE_PX);
  const [menu, setMenu] = useState<ClipMenu>();
  const [snapLine, setSnapLine] = useState<Time>();

  const cancelLongPress = useCallback(() => {
    clearTimeout(longPress.current);
    longPress.current = undefined;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const openMenu = useCallback((clip: ClipId, x: number, y: number) => {
    setMenu({ clip, x, y });
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const config = latest.current;
      // Only the primary button edits. Without this the right button starts a move drag and the
      // context menu opens on top of the edit it just made.
      if (event.button !== 0) return;
      notePointerType(event.pointerType, setTrimZonePx);
      // A press left over from an earlier pointerdown would fire into this gesture and cancel
      // its drag half a second in; only one press timer may ever be pending.
      cancelLongPress();
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      setMenu(undefined);

      if (pointers.current.size >= 2) {
        // A stray second contact during a drag must not end it -- on a phone that is a palm,
        // not a request to zoom. Only a gesture that is not already moving something pinches.
        if (drag.current?.mode === "move" || drag.current?.mode === "trim") return;
        drag.current = {
          mode: "pinch",
          distance: pointerDistance(pointers.current),
          flicksPerPixel: config.flicksPerPixel,
        };
        return;
      }

      capture(event);
      const hit = hitTest(event.target);
      if (hit === undefined) {
        config.onSelect(undefined);
        drag.current = undefined;
        return;
      }
      if (hit.kind === "ruler") {
        drag.current = { mode: "scrub", pointerId: event.pointerId };
        setSnapLine(seekTo(config, event.clientX, snapOptions(config, event.altKey))?.time);
        return;
      }

      const found = findClip(config.project, hit.clip);
      if (found === undefined) return;
      config.onSelect(hit.clip);
      longPress.current = setTimeout(() => {
        drag.current = undefined;
        openMenu(hit.clip, event.clientX, event.clientY);
      }, LONG_PRESS_MS);

      drag.current =
        hit.edge === undefined
          ? {
              mode: "move",
              pointerId: event.pointerId,
              clip: hit.clip,
              track: found.track,
              clientX: event.clientX,
              clientY: event.clientY,
              start: found.clip.start,
              key: `timeline-${(gestureSequence += 1)}`,
              live: false,
            }
          : {
              mode: "trim",
              pointerId: event.pointerId,
              clip: hit.clip,
              edge: hit.edge,
              clientX: event.clientX,
              clientY: event.clientY,
              edgeTime: edgeTime(found.clip, hit.edge),
              key: `timeline-${(gestureSequence += 1)}`,
              live: false,
            };
    },
    [cancelLongPress, openMenu],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      notePointerType(event.pointerType, setTrimZonePx);
      const known = pointers.current.get(event.pointerId);
      if (known !== undefined) {
        known.x = event.clientX;
        known.y = event.clientY;
      }
      const active = drag.current;
      if (active === undefined) return;
      const config = latest.current;

      if (active.mode === "pinch") {
        const distance = pointerDistance(pointers.current);
        if (distance <= 0 || active.distance <= 0) return;
        config.zoom(
          (active.flicksPerPixel * active.distance) / distance / config.flicksPerPixel,
          pinchAnchorX(pointers.current, config.surface),
        );
        return;
      }
      if (active.mode === "scrub") {
        setSnapLine(seekTo(config, event.clientX, snapOptions(config, event.altKey))?.time);
        return;
      }

      const dx = event.clientX - active.clientX;
      const dy = event.clientY - active.clientY;
      if (!active.live) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        // A press that turns into a drag is no longer a press.
        cancelLongPress();
        active.live = true;
      }

      const options = snapOptions(config, event.altKey);
      setSnapLine(
        active.mode === "move"
          ? applyMove(config, active, dx, dy, options)?.time
          : applyTrim(config, active, dx, options)?.time,
      );
    },
    [cancelLongPress],
  );

  // Leaving the coalesce key off from here on is what closes the undo step; the next
  // pointerdown mints a fresh one.
  const releasePointer = useCallback(
    (event: PointerEvent<HTMLElement>, revert: boolean) => {
      cancelLongPress();
      pointers.current.delete(event.pointerId);
      const active = drag.current;
      if (active === undefined) return;

      if (active.mode === "pinch") {
        // Lifting one of three fingers leaves a pinch that can still run; re-seeding from the
        // remaining pair continues it instead of ending the gesture under the user's hands.
        drag.current =
          pointers.current.size >= 2
            ? {
                mode: "pinch",
                distance: pointerDistance(pointers.current),
                flicksPerPixel: latest.current.flicksPerPixel,
              }
            : undefined;
        return;
      }
      if (active.pointerId !== event.pointerId) return;
      if (revert) revertDrag(latest.current, active);
      drag.current = undefined;
      setSnapLine(undefined);
    },
    [cancelLongPress],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => releasePointer(event, false),
    [releasePointer],
  );

  // The browser cancels a pointer when it takes the gesture over -- a phone doing that mid-drag
  // is ordinary, and committing half a drag the user never finished is an edit they did not make.
  const onPointerCancel = useCallback(
    (event: PointerEvent<HTMLElement>) => releasePointer(event, true),
    [releasePointer],
  );

  const onContextMenu = useCallback(
    (event: { clientX: number; clientY: number; preventDefault(): void; target: EventTarget | null }) => {
      const hit = hitTest(event.target);
      if (hit === undefined || hit.kind !== "clip") return;
      event.preventDefault();
      latest.current.onSelect(hit.clip);
      openMenu(hit.clip, event.clientX, event.clientY);
    },
    [openMenu],
  );

  useWheelZoom(config.surface, latest);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu,
    trimZonePx,
    menu,
    closeMenu: useCallback(() => setMenu(undefined), []),
    snapLine,
  };
}

function applyMove(
  config: GestureConfig,
  active: { clip: ClipId; clientY: number; start: Time; key: string },
  dx: number,
  dy: number,
  options: SnapOptions,
): SnapCandidate | undefined {
  const found = findClip(config.project, active.clip);
  if (found === undefined) return undefined;
  // No lower clamp here: clip.move already pins the start at zero, and a second clamp in the UI
  // would be a rule that can drift away from the one the core enforces.
  const wanted = active.start + xToTime(dx, config.flicksPerPixel);
  const snapped = snapSpan(wanted, found.clip.duration, candidatesFor(config, active.clip), options);
  const tracks = config.project.timeline.tracks;
  const top = config.tracksArea.current?.getBoundingClientRect().top ?? 0;
  const row = trackAt(tracks, active.clientY + dy - top);
  const toTrack = tracks[row]?.id ?? found.track;
  attempt(() => config.dispatch(cmd.clipMove(active.clip, toTrack, snapped.time), active.key));
  return snapped.candidate;
}

// The trim command takes a delta, so each move dispatches the step from where the clip actually
// is to where the pointer wants it. Reading the edge back instead of accumulating means a step
// the core refused (a trim that would empty the clip) cannot desynchronise the rest of the drag.
function applyTrim(
  config: GestureConfig,
  active: { clip: ClipId; edge: TrimEdge; edgeTime: Time; key: string },
  dx: number,
  options: SnapOptions,
): SnapCandidate | undefined {
  const found = findClip(config.project, active.clip);
  if (found === undefined) return undefined;
  const wanted = active.edgeTime + xToTime(dx, config.flicksPerPixel);
  const snapped = snapTime(wanted, candidatesFor(config, active.clip), options);
  const step = snapped.time - edgeTime(found.clip, active.edge);
  if (step !== 0) {
    attempt(() => config.dispatch(cmd.clipTrim(active.clip, active.edge, step), active.key));
  }
  return snapped.candidate;
}

// ponytail: the restore rides the gesture's own coalesce key, so the whole drag collapses into
// one history entry with an empty patch -- an undo step that does nothing. Dropping the entry
// outright needs a history.drop(key) in the core, which does not exist.
function revertDrag(config: GestureConfig, active: Drag): void {
  if (active.mode === "move") {
    if (!active.live) return;
    const command = cmd.clipMove(active.clip, active.track, active.start);
    attempt(() => config.dispatch(command, active.key));
    return;
  }
  if (active.mode !== "trim" || !active.live) return;
  const found = findClip(config.project, active.clip);
  if (found === undefined) return;
  const step = active.edgeTime - edgeTime(found.clip, active.edge);
  if (step === 0) return;
  const command = cmd.clipTrim(active.clip, active.edge, step);
  attempt(() => config.dispatch(command, active.key));
}

function candidatesFor(config: GestureConfig, exclude: ClipId): SnapCandidate[] {
  return snapCandidates(config.project, {
    range: config.range,
    playhead: config.playhead,
    exclude,
  });
}

// A radius of zero is how snapping gets switched off -- one number instead of a second code path
// that could disagree with the first.
function snapOptions(config: GestureConfig, modifierHeld: boolean): SnapOptions {
  return {
    radiusPx: config.snapEnabled && !modifierHeld ? SNAP_RADIUS_PX : 0,
    flicksPerPixel: config.flicksPerPixel,
    gridStep: tickStep(config.flicksPerPixel, config.project.settings.fps),
  };
}

// The core is the authority on what an edit may do. A rejected step during a drag means the edge
// hit its limit, not that the gesture is broken -- the next move recomputes from where the core
// left the clip.
function attempt(action: () => void): void {
  try {
    action();
  } catch {
    /* the clip stays where the core last allowed it */
  }
}

function seekTo(
  config: GestureConfig,
  clientX: number,
  options: SnapOptions,
): SnapCandidate | undefined {
  const surface = config.surface.current;
  const left = surface?.getBoundingClientRect().left ?? 0;
  const scrollLeft = surface?.scrollLeft ?? 0;
  const wanted = Math.max(0, xToTime(clientX - left + scrollLeft, config.flicksPerPixel));
  // No playhead candidate here: the playhead is the thing being moved.
  const snapped = snapTime(wanted, snapCandidates(config.project, { range: config.range }), options);
  config.onSeek(snapped.time);
  return snapped.candidate;
}

type Hit = { kind: "ruler" } | { kind: "clip"; clip: ClipId; edge?: TrimEdge };

// The DOM already knows what was hit; re-deriving it from coordinates would be a second,
// competing geometry. The trim zones are real elements, so their width is the hit area.
function hitTest(target: EventTarget | null): Hit | undefined {
  if (!(target instanceof Element)) return undefined;
  if (target.closest("[data-timeline-ruler]") !== null) return { kind: "ruler" };
  const clip = target.closest<HTMLElement>("[data-clip-id]");
  const id = clip?.dataset.clipId;
  if (id === undefined) return undefined;
  const edge = target.closest<HTMLElement>("[data-edge]")?.dataset.edge;
  return { kind: "clip", clip: id, edge: edge === "start" || edge === "end" ? edge : undefined };
}

export function findClip(project: Project, id: ClipId): { clip: Clip; track: TrackId } | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === id);
    if (clip !== undefined) return { clip, track: track.id };
  }
  return undefined;
}

function edgeTime(clip: Clip, edge: TrimEdge): Time {
  return edge === "start" ? clip.start : clip.start + clip.duration;
}

function notePointerType(type: string, set: (px: number) => void): void {
  // Coarse is the default, so a finger gets a usable target on its very first touch; only a
  // mouse, which has proven itself precise, narrows the zone.
  set(type === "mouse" ? FINE_TRIM_ZONE_PX : COARSE_TRIM_ZONE_PX);
}

function capture(event: PointerEvent<HTMLElement>): void {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    /* not every environment implements capture; the drag still works inside the element */
  }
}

function pointerDistance(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  if (a === undefined || b === undefined) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pinchAnchorX(
  pointers: Map<number, { x: number; y: number }>,
  surface: RefObject<HTMLElement | null>,
): number {
  const [a, b] = [...pointers.values()];
  if (a === undefined || b === undefined) return 0;
  return (a.x + b.x) / 2 - (surface.current?.getBoundingClientRect().left ?? 0);
}

// A trackpad pinch never arrives as two pointers -- the browser turns it into ctrl+wheel. React
// attaches wheel passively at the root, so preventDefault only works from a native listener.
function useWheelZoom(
  surface: RefObject<HTMLElement | null>,
  latest: RefObject<GestureConfig>,
): void {
  useEffect(() => {
    const element = surface.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const config = latest.current;
      config.zoom(
        event.deltaY > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR,
        event.clientX - element.getBoundingClientRect().left,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [surface, latest]);
}
