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
  selected: ReadonlySet<ClipId>;
  trimZonePx: number;
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
  onSelect,
}: TrackProps): ReactElement {
  return (
    <div
      className="v-track"
      data-track-id={track.id}
      data-track-index={index}
      style={{ height: `${trackHeight(track)}px` }}
    >
      {clipBoxes(track.clips, range, flicksPerPixel).map((box) => (
        <Clip
          key={box.clip.id}
          box={box}
          flicksPerPixel={flicksPerPixel}
          mediaNames={mediaNames}
          selected={box.count === 1 && selected.has(box.clip.id)}
          trimZonePx={trimZonePx}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
