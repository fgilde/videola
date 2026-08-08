import type { ReactElement } from "react";

import type { Clip as ClipModel, MediaAsset } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import {
  MIN_CLIP_LABEL_PX,
  MIN_TRIM_ZONE_PX,
  timeToX,
  trimZoneWidth,
  type ClipBox,
} from "./geometry";

export interface ClipProps {
  box: ClipBox;
  flicksPerPixel: number;
  mediaNames: ReadonlyMap<string, string>;
  selected: boolean;
  trimZonePx: number;
  onSelect: (clip: string) => void;
}

export function Clip({
  box,
  flicksPerPixel,
  mediaNames,
  selected,
  trimZonePx,
  onSelect,
}: ClipProps): ReactElement {
  const { t } = useI18n();
  const width = timeToX(box.end - box.start, flicksPerPixel);
  const zone = trimZoneWidth(width, trimZonePx);
  // A run stands for several clips, so there is no single edge to trim; and below a handful of
  // pixels neither a handle nor a name is reachable or readable. Not drawing what cannot be used
  // is what keeps the node count bounded when the whole project is on screen at once.
  const trimmable = box.count === 1 && zone >= MIN_TRIM_ZONE_PX;

  return (
    // A real button so focus, the accessible name and keyboard activation come from the
    // platform; the pointer gestures read the same element through the event target.
    <button
      type="button"
      className="v-clip"
      data-clip-id={box.clip.id}
      data-clip-run={box.count > 1 ? box.count : undefined}
      data-selected={selected}
      data-clip-group={box.clip.groupId ?? undefined}
      aria-pressed={selected}
      aria-label={box.count > 1 ? t("timeline.clipRun", { count: box.count }) : undefined}
      style={{ left: `${timeToX(box.start, flicksPerPixel)}px`, width: `${width}px` }}
      // Only keyboard activation selects from here (`detail` is 0 then). A pointer has already
      // been through the gesture path, which is the one that knows about modifier keys, and a
      // second call would undo the toggle it just made.
      onClick={(event) => {
        if (event.detail === 0) onSelect(box.clip.id);
      }}
    >
      {width >= MIN_CLIP_LABEL_PX && box.count === 1 && (
        <span className="v-clip__label">{clipLabel(box.clip, mediaNames, t)}</span>
      )}
      {trimmable && <span className="v-clip__trim" data-edge="start" style={{ width: `${zone}px` }} />}
      {trimmable && <span className="v-clip__trim" data-edge="end" style={{ width: `${zone}px` }} />}
    </button>
  );
}

export function mediaNameIndex(library: readonly MediaAsset[]): Map<string, string> {
  return new Map(library.map((asset) => [asset.id, asset.originalName]));
}

function clipLabel(
  clip: ClipModel,
  mediaNames: ReadonlyMap<string, string>,
  t: (key: string) => string,
): string {
  if (clip.label) return clip.label;
  const fromMedia = clip.source.kind === "media" ? mediaNames.get(clip.source.media) : undefined;
  return fromMedia ?? t("timeline.clipUnnamed");
}
