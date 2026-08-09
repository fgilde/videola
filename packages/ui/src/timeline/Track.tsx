import type { ReactElement } from "react";

import type { ClipId, Track as TrackModel } from "@videola/core";
import type { Peaks } from "@videola/media";

import { Clip } from "./Clip";
import { clipBoxes, trackHeight, type TimeRange } from "./geometry";

export interface TrackProps {
  track: TrackModel;
  index: number;
  flicksPerPixel: number;
  range: TimeRange;
  mediaNames: ReadonlyMap<string, string>;
  waveforms?: ReadonlyMap<string, Peaks>;
  selected: ReadonlySet<ClipId>;
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
  waveforms,
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
      // What a clip is made of decides what it looks like, and the row is where the kind is
      // known -- the clip itself only knows its own box.
      data-kind={track.kind}
      data-locked={track.locked || undefined}
      data-drop-target={dropTarget || undefined}
      style={{ height: `${trackHeight(track)}px` }}
    >
      {clipBoxes(track.clips, range, flicksPerPixel).map((box) => (
        <Clip
          key={box.clip.id}
          box={box}
          flicksPerPixel={flicksPerPixel}
          mediaNames={mediaNames}
          peaks={waveforms?.get(box.clip.id)}
          selected={box.count === 1 && selected.has(box.clip.id)}
          trimZonePx={trimZonePx}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
