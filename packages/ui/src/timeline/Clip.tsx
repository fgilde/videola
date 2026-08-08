import { useMemo, type ReactElement } from "react";

import type { Clip as ClipModel, MediaAsset } from "@videola/core";
import type { Peaks } from "@videola/media";

import { useI18n } from "../i18n/useI18n";
import {
  MIN_CLIP_LABEL_PX,
  MIN_TRIM_ZONE_PX,
  timeToX,
  trimZoneWidth,
  type ClipBox,
} from "./geometry";
import { WAVEFORM_HEIGHT, waveformPath } from "./waveform";

export interface ClipProps {
  box: ClipBox;
  flicksPerPixel: number;
  mediaNames: ReadonlyMap<string, string>;
  peaks?: Peaks;
  selected: boolean;
  trimZonePx: number;
  onSelect: (clip: string) => void;
}

export function Clip({
  box,
  flicksPerPixel,
  mediaNames,
  peaks,
  selected,
  trimZonePx,
  onSelect,
}: ClipProps): ReactElement {
  const { t } = useI18n();
  const width = timeToX(box.end - box.start, flicksPerPixel);
  const zone = trimZoneWidth(width, trimZonePx);
  // Stretched to the clip by the viewBox, so zooming and resizing cost no rebuild. A run stands for
  // several clips and has no single signal to show.
  const wave = useMemo(
    () => (peaks === undefined || box.count > 1 ? "" : waveformPath(peaks)),
    [peaks, box.count],
  );
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
      aria-pressed={selected}
      aria-label={box.count > 1 ? t("timeline.clipRun", { count: box.count }) : undefined}
      style={{ left: `${timeToX(box.start, flicksPerPixel)}px`, width: `${width}px` }}
      onClick={() => onSelect(box.clip.id)}
    >
      {wave !== "" && (
        <svg
          className="v-clip__wave"
          data-testid="clip-waveform"
          viewBox={`0 0 ${peaks?.max.length ?? 0} ${WAVEFORM_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={wave} />
        </svg>
      )}
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
