import type { ReactElement } from "react";

import type { ClipId, Track as TrackModel } from "@videola/core";

import { Clip } from "./Clip";
import { clipBoxes, trackHeight, type TimeRange } from "./geometry";

export interface TrackProps {
  track: TrackModel;
  index: number;
  flicksPerPixel: number;
  range: TimeRange;
  mediaNames: ReadonlyMap<string, string>;
  selected: ClipId | undefined;
  trimZonePx: number;
  /** A medium is being carried over this track and would land here. */
  dropTarget?: boolean;
  onSelect: (clip: ClipId) => void;
}

export function Track({
  track,
  index,
  flicksPerPixel,
  range,
  mediaNames,
  selected,
  trimZonePx,
  dropTarget = false,
  onSelect,
}: TrackProps): ReactElement {
  return (
    <div
      className="v-track"
      data-track-id={track.id}
      data-track-index={index}
      data-drop-target={dropTarget || undefined}
      style={{ height: `${trackHeight(track)}px` }}
    >
      {clipBoxes(track.clips, range, flicksPerPixel).map((box) => (
        <Clip
          key={box.clip.id}
          box={box}
          flicksPerPixel={flicksPerPixel}
          mediaNames={mediaNames}
          selected={box.count === 1 && box.clip.id === selected}
          trimZonePx={trimZonePx}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
