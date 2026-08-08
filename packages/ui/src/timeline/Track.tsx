import type { ReactElement } from "react";

import type { ClipId, Track as TrackModel } from "@videola/core";

import { Clip } from "./Clip";
import { clipsInRange, trackHeight, type TimeRange } from "./geometry";

export interface TrackProps {
  track: TrackModel;
  index: number;
  flicksPerPixel: number;
  range: TimeRange;
  mediaNames: ReadonlyMap<string, string>;
  selected: ClipId | undefined;
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
      style={{ height: `${trackHeight(track)}px`, borderColor: track.colorHex }}
    >
      {clipsInRange(track.clips, range).map((clip) => (
        <Clip
          key={clip.id}
          clip={clip}
          flicksPerPixel={flicksPerPixel}
          mediaNames={mediaNames}
          selected={clip.id === selected}
          trimZonePx={trimZonePx}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
