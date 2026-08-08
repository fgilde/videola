import type { ReactElement } from "react";

import type { Clip as ClipModel, MediaAsset } from "@videola/core";

import { useI18n } from "../i18n/useI18n";
import { timeToX } from "./geometry";

export interface ClipProps {
  clip: ClipModel;
  flicksPerPixel: number;
  mediaNames: ReadonlyMap<string, string>;
}

export function Clip({ clip, flicksPerPixel, mediaNames }: ClipProps): ReactElement {
  const { t } = useI18n();
  return (
    <div
      className="v-clip"
      data-clip-id={clip.id}
      style={{
        left: `${timeToX(clip.start, flicksPerPixel)}px`,
        width: `${timeToX(clip.duration, flicksPerPixel)}px`,
      }}
    >
      <span className="v-clip__label">{clipLabel(clip, mediaNames, t)}</span>
    </div>
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
