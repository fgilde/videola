export interface StagePoint {
  x: number;
  y: number;
}

export interface StageFrame {
  width: number;
  height: number;
}

/**
 * A pointer on screen, as a point in the project's own coordinates: pixels from the centre of the
 * frame, y running down the picture — the units `draw-list.ts` defines and the transform is stored
 * in.
 *
 * One function for every overlay drawn over the picture, because the conversion is the one thing
 * they all have to agree about: a box drawn from one arithmetic and a path from another would sit
 * a few pixels apart on the same frame and there would be no telling which was right.
 */
export function stagePoint(
  box: { left: number; top: number; width: number; height: number },
  frame: StageFrame,
  clientX: number,
  clientY: number,
): StagePoint {
  if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
  return {
    x: ((clientX - box.left) / box.width) * frame.width - frame.width / 2,
    y: ((clientY - box.top) / box.height) * frame.height - frame.height / 2,
  };
}

/** The viewBox that puts the frame's centre at the origin, which is where the model's is. */
export function stageViewBox(frame: StageFrame): string {
  return `${-frame.width / 2} ${-frame.height / 2} ${frame.width} ${frame.height}`;
}

/**
 * How many project pixels one screen pixel is worth right now.
 *
 * Handles are drawn inside the viewBox, in project units, so their size has to be divided by this
 * or they grow with the project's resolution: a 7 px handle on a 4K timeline would be 21 px on
 * screen, and on a 480p one it would be three.
 */
export function stageScale(clientWidth: number, frame: StageFrame): number {
  return clientWidth > 0 ? frame.width / clientWidth : 1;
}
