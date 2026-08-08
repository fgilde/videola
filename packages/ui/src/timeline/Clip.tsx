import type { ReactElement } from "react";

import type { Clip as ClipModel, MediaAsset } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { timeToX, trimZoneWidth } from "./geometry";

export interface ClipProps {
  clip: ClipModel;
  flicksPerPixel: number;
  mediaNames: ReadonlyMap<string, string>;
  selected: boolean;
  trimZonePx: number;
  onSelect: (clip: string) => void;
}

export function Clip({
  clip,
  flicksPerPixel,
  mediaNames,
  selected,
  trimZonePx,
  onSelect,
}: ClipProps): ReactElement {
  const { t } = useI18n();
  const width = timeToX(clip.duration, flicksPerPixel);
  const zone = `${trimZoneWidth(width, trimZonePx)}px`;
  return (
    // A real button so focus, the accessible name and keyboard activation come from the
    // platform; the pointer gestures read the same element through the event target.
    <button
      type="button"
      className="v-clip"
      data-clip-id={clip.id}
      data-selected={selected}
      aria-pressed={selected}
      style={{ left: `${timeToX(clip.start, flicksPerPixel)}px`, width: `${width}px` }}
      onClick={() => onSelect(clip.id)}
    >
      <span className="v-clip__label">{clipLabel(clip, mediaNames, t)}</span>
      <span className="v-clip__trim" data-edge="start" style={{ width: zone }} />
      <span className="v-clip__trim" data-edge="end" style={{ width: zone }} />
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
