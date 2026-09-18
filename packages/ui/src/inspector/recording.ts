import { createContext, useContext } from "react";

/**
 * Keyframe record mode.
 *
 * Off, a slider on a field nobody has animated writes the value the clip rests at, and animating
 * something means arming each field by hand first. On, every change writes a key at the playhead
 * instead -- which is how every editor records a move: put the playhead somewhere, change what you
 * want changed, move on.
 *
 * It is a context rather than a prop because the fields that have to know sit four levels down and
 * the panels between them have no business carrying it.
 */
export const RecordingContext = createContext(false);

export function useRecording(): boolean {
  return useContext(RecordingContext);
}
