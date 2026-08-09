import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

import {
  cmd,
  on,
  type Clip,
  type ClipId,
  type Command,
  type Keyframe,
  type MarkerId,
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
import { keyframeSpan } from "./keyframes";
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

// Which command an edge drag and a clip drag turn into. Two plain choices instead of modifier keys
// on the pointer: a finger has no modifiers, and shift-click already means "add to the selection".
export type EdgeMode = "trim" | "ripple" | "roll";
export type DragMode = "move" | "slip" | "slide";

export type MenuTarget = { kind: "clip"; clip: ClipId } | { kind: "marker"; marker: MarkerId };

export interface TimelineMenu {
  target: MenuTarget;
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
  menu: TimelineMenu | undefined;
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
  onSelect: (clip: ClipId | undefined, how?: SelectHow) => void;
  /** Which keyframe the lane has under the hand, kept where the timeline keeps its selections. */
  onSelectKeyframe: (keyframe: KeyframeHit) => void;
  selection: ReadonlySet<ClipId>;
  zoom: ZoomBy;
  snapEnabled: boolean;
  edgeMode: EdgeMode;
  dragMode: DragMode;
  range: TimeRange;
}

// Where each clip of the selection stood when the drag began. Every move recomputes the target from
// this, so a step the core refuses for one clip does not desynchronise the others.
interface Held {
  clip: ClipId;
  track: TrackId;
  start: Time;
  inPoint: Time;
}

type Drag =
  | { mode: "move"; pointerId: number; clip: ClipId; track: TrackId; clientX: number; clientY: number; start: Time; held: Held[]; key: string; live: boolean; additive: boolean }
  | { mode: "trim"; pointerId: number; clip: ClipId; edge: TrimEdge; clientX: number; clientY: number; edgeTime: Time; duration: Time; key: string; live: boolean; additive: boolean }
  // `at` is where the core last put the keyframe, not where the pointer wants it. Every move sends
  // the step from there, the same way a trim reads the clip's edge back -- a step the core refused
  // (a neighbour already sits there) then cannot desynchronise the rest of the drag.
  | { mode: "keyframe"; pointerId: number; keyframe: KeyframeHit; at: Time; clientX: number; key: string; live: boolean }
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
  const [menu, setMenu] = useState<TimelineMenu>();
  const [snapLine, setSnapLine] = useState<Time>();

  const cancelLongPress = useCallback(() => {
    clearTimeout(longPress.current);
    longPress.current = undefined;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const openMenu = useCallback((target: MenuTarget, x: number, y: number) => {
    setMenu({ target, x, y });
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
      if (hit.kind === "marker") {
        // Nothing to drag on a marker, but a finger has no right button -- a long press is how a
        // touch device reaches the only thing the marker offers.
        const marker = hit.marker;
        drag.current = undefined;
        longPress.current = setTimeout(() => {
          openMenu({ kind: "marker", marker }, event.clientX, event.clientY);
        }, LONG_PRESS_MS);
        return;
      }
      if (hit.kind === "keyframe") {
        // The press picks it, so the bar above the lane is already aimed at this keyframe before
        // the drag begins -- and a press that never moves is how a keyframe is picked at all.
        config.onSelectKeyframe(hit.keyframe);
        drag.current = {
          mode: "keyframe",
          pointerId: event.pointerId,
          keyframe: hit.keyframe,
          at: hit.keyframe.time,
          clientX: event.clientX,
          key: `timeline-${(gestureSequence += 1)}`,
          live: false,
        };
        return;
      }

      const found = findClip(config.project, hit.clip);
      if (found === undefined) return;
      const additive = isAdditive(event);
      const selection = selectionAfter(config.project, config.selection, hit.clip, { additive });
      config.onSelect(hit.clip, { additive });
      // A modifier click that took the clip out of the selection is a deselection, not the start of
      // a drag of something no longer selected.
      if (!selection.has(hit.clip)) {
        drag.current = undefined;
        return;
      }
      const clip = hit.clip;
      longPress.current = setTimeout(() => {
        drag.current = undefined;
        openMenu({ kind: "clip", clip }, event.clientX, event.clientY);
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
              held: heldClips(config.project, selection),
              key: `timeline-${(gestureSequence += 1)}`,
              live: false,
              additive,
            }
          : {
              mode: "trim",
              pointerId: event.pointerId,
              clip: hit.clip,
              edge: hit.edge,
              clientX: event.clientX,
              clientY: event.clientY,
              edgeTime: edgeTime(found.clip, hit.edge),
              duration: found.clip.duration,
              key: `timeline-${(gestureSequence += 1)}`,
              live: false,
              additive,
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
      if (active.mode === "keyframe") {
        setSnapLine(applyKeyframe(config, active, dx, options)?.time);
        return;
      }
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
      // A press that never became a drag was a click, and a click narrows a multiple selection to
      // the clip it landed on -- the press itself had to keep the rest, to be able to drag it. A
      // modifier click is the one that just widened the selection, so it is exempt.
      else if (active.mode !== "scrub" && active.mode !== "keyframe" && !active.live && !active.additive) {
        latest.current.onSelect(active.clip, { collapse: true });
      }
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
      // A keyframe has no menu: the bar above the lane is always showing, and everything it could
      // offer is already there under a finger as well as under a right button.
      if (hit === undefined || hit.kind === "ruler" || hit.kind === "keyframe") return;
      event.preventDefault();
      if (hit.kind === "marker") {
        openMenu({ kind: "marker", marker: hit.marker }, event.clientX, event.clientY);
        return;
      }
      // A right click inside an existing selection keeps it, so the menu can act on all of it;
      // outside it, it selects what was clicked, the way every editor does.
      const config = latest.current;
      if (!config.selection.has(hit.clip)) config.onSelect(hit.clip);
      openMenu({ kind: "clip", clip: hit.clip }, event.clientX, event.clientY);
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

/** How a press changes the selection: `additive` toggles, `collapse` narrows to the one clip. */
export interface SelectHow {
  additive?: boolean;
  collapse?: boolean;
}

type MoveDrag = Extract<Drag, { mode: "move" }>;
type TrimDrag = Extract<Drag, { mode: "trim" }>;
type KeyframeDrag = Extract<Drag, { mode: "keyframe" }>;

function applyMove(
  config: GestureConfig,
  active: MoveDrag,
  dx: number,
  dy: number,
  options: SnapOptions,
): SnapCandidate | undefined {
  const found = findClip(config.project, active.clip);
  if (found === undefined) return undefined;
  const delta = xToTime(dx, config.flicksPerPixel);
  if (config.dragMode === "slip") {
    // No snap line: slip moves the material behind a window that stays where it is, so there is no
    // edge on the timeline for a line to line up with.
    const step = slipStep(found.clip, active, delta);
    if (step !== 0) attempt(() => config.dispatch(cmd.clipSlip(active.clip, step), active.key));
    return undefined;
  }
  const snapped = snapSpan(active.start + delta, found.clip.duration, candidatesFor(config, active.held), options);
  if (config.dragMode === "slide") {
    const step = snapped.time - found.clip.start;
    if (step !== 0) attempt(() => config.dispatch(cmd.clipSlide(active.clip, step), active.key));
    return snapped.candidate;
  }
  // The whole selection travels by one shift, held back only so the earliest clip stops at zero:
  // `clip.move` pins each start at zero on its own, which would squeeze the selection together.
  const earliest = active.held.reduce((lowest, held) => Math.min(lowest, held.start), Infinity);
  const shift = Math.max(snapped.time - active.start, -earliest);
  const tracks = config.project.timeline.tracks;
  const top = config.tracksArea.current?.getBoundingClientRect().top ?? 0;
  const row = trackAt(tracks, active.clientY + dy - top);
  for (const held of active.held) {
    // Only a single clip changes track: with several, the rows would have to move as a block, and
    // the row under the pointer says nothing about where the others should land.
    const toTrack = active.held.length === 1 ? (tracks[row]?.id ?? held.track) : held.track;
    // The command is built outside the guard: only what the core throws is ordinary here, a
    // TypeError of our own has no business being swallowed.
    const command = cmd.clipMove(held.clip, toTrack, held.start + shift);
    attempt(() => config.dispatch(command, active.key));
  }
  return snapped.candidate;
}

// Every edge command takes a delta, so each move dispatches the step from where the clip actually
// is to where the pointer wants it. Reading the current value back instead of accumulating means a
// step the core refused (a trim that would empty the clip) cannot desynchronise the rest of the drag.
function applyTrim(
  config: GestureConfig,
  active: TrimDrag,
  dx: number,
  options: SnapOptions,
): SnapCandidate | undefined {
  const found = findClip(config.project, active.clip);
  if (found === undefined) return undefined;
  const wanted = active.edgeTime + xToTime(dx, config.flicksPerPixel);
  const snapped = snapTime(wanted, candidatesFor(config, [{ clip: active.clip }]), options);
  const step = edgeStep(config.edgeMode, active, found.clip, snapped.time);
  if (step !== 0) {
    const command = edgeCommand(config.edgeMode, active.clip, active.edge, step);
    attempt(() => config.dispatch(command, active.key));
  }
  return snapped.candidate;
}

/**
 * One step of a keyframe drag. The target is derived from where the gesture began, like every other
 * drag here, and clamped into the clip: outside it the parameter is never evaluated, so a key
 * dragged past the edge would be a key that does nothing -- and a clamp is also what keeps a drag
 * held against that edge from producing a refusal, and an error banner, on every pointer move.
 */
function applyKeyframe(
  config: GestureConfig,
  active: KeyframeDrag,
  dx: number,
  options: SnapOptions,
): SnapCandidate | undefined {
  const found = findClip(config.project, active.keyframe.clip);
  if (found === undefined) return undefined;
  const span = keyframeSpan(found.clip);
  const wanted = active.keyframe.time + xToTime(dx, config.flicksPerPixel);
  const snapped = snapTime(wanted, candidatesFor(config, []), options);
  const to = Math.min(Math.max(snapped.time, span.from), span.to);
  if (to === active.at) return snapped.candidate;
  // Landing on a neighbour needs no guard of its own. `attempt` swallows the refusal and
  // `active.at` only advances on success, so the next step -- measured from where the gesture
  // began rather than from where the key now is -- clears the neighbour and lands past it. A guard
  // stood here first and survived its counter-check without changing one outcome.
  const command = cmd.keyframeMove(
    on.clip(active.keyframe.clip),
    active.keyframe.effectType,
    active.keyframe.key,
    active.at,
    to,
  );
  attempt(() => {
    config.dispatch(command, active.key);
    active.at = to;
    config.onSelectKeyframe({ ...active.keyframe, time: to });
  });
  return snapped.candidate;
}

// A ripple trim of the head leaves the clip's start where it is, so the edge on screen never moves
// and a step measured against it would be dispatched again on every pointer move. What does move is
// the length, and that is what the step is measured against instead.
function edgeStep(mode: EdgeMode, active: TrimDrag, clip: Clip, wanted: Time): Time {
  if (mode === "ripple" && active.edge === "start") {
    return clip.duration - (active.duration - (wanted - active.edgeTime));
  }
  return wanted - edgeTime(clip, active.edge);
}

function edgeCommand(mode: EdgeMode, clip: ClipId, edge: TrimEdge, step: Time): Command {
  if (mode === "ripple") return cmd.clipRippleTrim(clip, edge, step);
  if (mode === "roll") return cmd.clipRoll(clip, edge, step);
  return cmd.clipTrim(clip, edge, step);
}

// The core's slip takes a delta in timeline time and multiplies it by the clip's rate, so the step
// is measured against where the material actually sits and converted back the same way. A reversed
// clip reads backwards, which flips the direction the in point has to travel.
function slipStep(clip: Clip, active: MoveDrag, delta: Time): Time {
  const held = active.held.find((entry) => entry.clip === active.clip);
  if (held === undefined) return 0;
  const rate = clip.speed.rate > 0 ? clip.speed.rate : 1;
  const direction = clip.speed.reverse ? -1 : 1;
  const wanted = held.inPoint + direction * Math.round(delta * rate);
  return Math.round(((wanted - clip.inPoint) * direction) / rate);
}

// Putting a drag back is the same computation as moving it, with a delta of zero: every apply
// derives its target from where the gesture began, so nothing has to be inverted by hand.
//
// ponytail: the restore rides the gesture's own coalesce key, so the whole drag collapses into
// one history entry with an empty patch -- an undo step that does nothing. Dropping the entry
// outright needs a history.drop(key) in the core, which does not exist.
function revertDrag(config: GestureConfig, active: Drag): void {
  if (active.mode === "move" && active.live) applyMove(config, active, 0, 0, NO_SNAP);
  if (active.mode === "trim" && active.live) applyTrim(config, active, 0, NO_SNAP);
  if (active.mode === "keyframe" && active.live) applyKeyframe(config, active, 0, NO_SNAP);
}

const NO_SNAP: SnapOptions = { radiusPx: 0, flicksPerPixel: 1 };

function candidatesFor(config: GestureConfig, held: readonly { clip: ClipId }[]): SnapCandidate[] {
  return snapCandidates(config.project, {
    range: config.range,
    playhead: config.playhead,
    exclude: new Set(held.map((entry) => entry.clip)),
  });
}

function heldClips(project: Project, selection: ReadonlySet<ClipId>): Held[] {
  const held: Held[] = [];
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (selection.has(clip.id)) {
        held.push({ clip: clip.id, track: track.id, start: clip.start, inPoint: clip.inPoint });
      }
    }
  }
  return held;
}

// The one rule for what a click does to the selection, shared by the pointer path and the state the
// timeline keeps -- a second copy of it would let the drag act on a selection the screen never showed.
// Clips of one group are picked and dropped together; that is what grouping is for.
export function selectionAfter(
  project: Project,
  current: ReadonlySet<ClipId>,
  clip: ClipId | undefined,
  how: SelectHow = {},
): Set<ClipId> {
  if (clip === undefined) return new Set();
  const family = groupMates(project, clip);
  if (how.additive === true) {
    const next = new Set(current);
    const remove = family.every((id) => current.has(id));
    for (const id of family) {
      if (remove) next.delete(id);
      else next.add(id);
    }
    return next;
  }
  // An unmodified press inside the selection keeps it, or dragging several clips would be
  // impossible: the press that starts the drag would have thrown the rest away. Narrowing to the
  // one clip is the release's job, and only when the press did not turn into a drag.
  return current.has(clip) && how.collapse !== true ? new Set(current) : new Set(family);
}

export function groupMates(project: Project, clip: ClipId): ClipId[] {
  const clips = project.timeline.tracks.flatMap((track) => track.clips);
  const group = clips.find((candidate) => candidate.id === clip)?.groupId;
  if (group == null) return [clip];
  return clips.filter((candidate) => candidate.groupId === group).map((candidate) => candidate.id);
}

function isAdditive(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
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
// left the clip. This is why TimelineProps.dispatch has to throw rather than report: a caller
// that catches first turns every limit into an error banner, one per pointer movement.
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

type Hit =
  | { kind: "ruler" }
  | { kind: "marker"; marker: MarkerId }
  | { kind: "keyframe"; keyframe: KeyframeHit }
  | { kind: "clip"; clip: ClipId; edge?: TrimEdge };

/** Everything a keyframe command needs, read off the element the pointer landed on. */
export interface KeyframeHit {
  row: string;
  clip: ClipId;
  /** `null` addresses the clip's own transform, which is what the commands mean by no effect. */
  effectType: string | null;
  key: string;
  time: Time;
}

// The DOM already knows what was hit; re-deriving it from coordinates would be a second,
// competing geometry. The trim zones are real elements, so their width is the hit area.
function hitTest(target: EventTarget | null): Hit | undefined {
  if (!(target instanceof Element)) return undefined;
  const marker = target.closest<HTMLElement>("[data-marker-id]")?.dataset.markerId;
  if (marker !== undefined) return { kind: "marker", marker };
  const keyframe = keyframeHit(target);
  if (keyframe !== undefined) return { kind: "keyframe", keyframe };
  if (target.closest("[data-timeline-ruler]") !== null) return { kind: "ruler" };
  const clip = target.closest<HTMLElement>("[data-clip-id]");
  const id = clip?.dataset.clipId;
  if (id === undefined) return undefined;
  const edge = target.closest<HTMLElement>("[data-edge]")?.dataset.edge;
  return { kind: "clip", clip: id, edge: edge === "start" || edge === "end" ? edge : undefined };
}

// The dataset carries the whole address rather than a row id the hook would have to look up: a
// second table mapping rows back to clips and parameters is a second place for the two to disagree.
// `data-keyframe-time` is written as an integer number of flicks and parsed back as one -- anything
// that is not is a hand-edited DOM, and no command may be built from it.
function keyframeHit(target: Element): KeyframeHit | undefined {
  const element = target.closest<HTMLElement>("[data-keyframe-time]");
  const data = element?.dataset;
  if (data === undefined) return undefined;
  const { keyframeRow: row, keyframeClip: clip, keyframeEffect: effect, keyframeKey: key } = data;
  const time = Number(data.keyframeTime);
  if (row === undefined || clip === undefined || key === undefined) return undefined;
  if (!Number.isSafeInteger(time)) return undefined;
  return { row, clip, effectType: effect === undefined || effect === "" ? null : effect, key, time };
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
