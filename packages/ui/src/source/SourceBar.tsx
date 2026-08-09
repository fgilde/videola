import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import { timeToSeconds, type MediaAsset, type Rate, type Time } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { IconButton } from "../primitives/Icon";
import "./SourceBar.css";

/** What a three-point edit needs of the source: where to start reading and how much to take. */
export interface SourceRange {
  inPoint: Time;
  duration: Time;
}

export type EditMode = "insert" | "overwrite";

export interface SourceBarProps {
  /** The medium a range is being marked in. Nothing armed, nothing to mark. */
  asset?: MediaAsset;
  /** The project's timebase, for media that carry no frame rate of their own. */
  fps: Rate;
  /** The marked range, at the timeline place the caller chooses. One command, one undo step. */
  onEdit: (mode: EditMode, range: SourceRange) => void;
  onClose?: () => void;
}

// How many steps the slider divides a medium into. Fine enough to land on a shot, coarse enough
// that dragging it is not a search for one particular flick -- the marks are moved by whole frames
// with the buttons, and this is the coarse approach.
const SCRUB_STEPS = 1000;

/**
 * Where in and out points are marked. The half of a three-point edit that belongs to the material:
 * pick a medium, mark the range in it, and hand that range to the timeline as an insert or an
 * overwrite. Without this, in and out would have nowhere to be marked and the two commands nothing
 * to place.
 *
 * ponytail: no picture. Scrubbing a source needs a decoder per position and a second compositor
 * beside the one drawing the timeline, which is a monitor rather than a control; what is here is
 * the timecode, and the poster the library already shows says which medium it belongs to. A real
 * source monitor reuses `VideoSource` and a second `Playback`, and this bar becomes its scrub bar.
 */
export function SourceBar({ asset, fps, onEdit, onClose }: SourceBarProps): ReactElement | null {
  const { t, formatTimecode } = useI18n();
  const duration = asset?.duration ?? 0;
  const [position, setPosition] = useState<Time>(0);
  const [marks, setMarks] = useState<{ in: Time; out?: Time }>({ in: 0 });
  const media = asset?.id;

  // A range belongs to the medium it was marked in. Swapping the armed medium starts over rather
  // than carrying an out point that may be past the end of the new one.
  useEffect(() => {
    setPosition(0);
    setMarks({ in: 0 });
  }, [media]);

  const range = useMemo<SourceRange | undefined>(() => {
    const out = marks.out ?? duration;
    if (out <= marks.in) return undefined;
    return { inPoint: marks.in, duration: out - marks.in };
  }, [marks, duration]);

  const markIn = useCallback(
    () => setMarks((current) => ({ ...current, in: position })),
    [position],
  );
  const markOut = useCallback(() => setMarks((current) => ({ ...current, out: position })), [
    position,
  ]);
  const edit = useCallback(
    (mode: EditMode) => {
      if (range !== undefined) onEdit(mode, range);
    },
    [onEdit, range],
  );

  useSourceKeys(asset !== undefined, markIn, markOut, edit);

  if (asset === undefined) return null;
  const clock = (at: Time): string => formatTimecode(timeToSeconds(at), asset.fps ?? fps);

  return (
    <section className="v-source" aria-label={t("source.label")} data-testid="source-bar">
      <div className="v-source__head">
        <span className="v-source__name" title={asset.originalName}>
          {asset.originalName}
        </span>
        {onClose !== undefined && (
          <button type="button" className="v-button v-button--quiet" onClick={onClose}>
            {t("source.close")}
          </button>
        )}
      </div>

      {/* A native range input rather than a scrub surface of our own: it is draggable with a
          finger, arrow-steppable from the keyboard and labelled without any work. */}
      <input
        className="v-source__scrub"
        type="range"
        min={0}
        max={SCRUB_STEPS}
        step={1}
        value={duration <= 0 ? 0 : Math.round((position / duration) * SCRUB_STEPS)}
        aria-label={t("source.position")}
        aria-valuetext={clock(position)}
        onChange={(event) =>
          setPosition(Math.round((Number(event.target.value) / SCRUB_STEPS) * duration))
        }
      />

      <div className="v-source__controls">
        <IconButton icon="markIn" label={t("source.markIn")} onClick={markIn} />
        <IconButton icon="markOut" label={t("source.markOut")} onClick={markOut} />
        <span className="v-source__marks">
          <span>{clock(position)}</span>
          <span className="v-source__range">
            {t("source.range", {
              in: clock(marks.in),
              out: clock(marks.out ?? duration),
              length: clock(range?.duration ?? 0),
            })}
          </span>
        </span>
      </div>

      {/* Words, not symbols: these two are the operation, and an editor picking between "push
          everything along" and "replace what is there" needs to read which is which. */}
      <div className="v-source__actions">
        <button
          type="button"
          className="v-button"
          disabled={range === undefined}
          onClick={() => edit("insert")}
        >
          {t("source.insert")}
        </button>
        <button
          type="button"
          className="v-button"
          disabled={range === undefined}
          onClick={() => edit("overwrite")}
        >
          {t("source.overwrite")}
        </button>
      </div>
    </section>
  );
}

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// I, O, comma and full stop, on the window like the transport keys: the hands are on the timeline
// while the range is marked, and these four are the same four in every editor there is.
function useSourceKeys(
  armed: boolean,
  markIn: () => void,
  markOut: () => void,
  edit: (mode: EditMode) => void,
): void {
  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable === true || TYPING.has(target?.tagName ?? "")) return;
      const action = sourceKey(event.key);
      if (action === undefined) return;
      event.preventDefault();
      if (action === "in") return markIn();
      if (action === "out") return markOut();
      edit(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armed, markIn, markOut, edit]);
}

function sourceKey(key: string): "in" | "out" | EditMode | undefined {
  switch (key.toLowerCase()) {
    case "i":
      return "in";
    case "o":
      return "out";
    case ",":
      return "insert";
    case ".":
      return "overwrite";
    default:
      return undefined;
  }
}
