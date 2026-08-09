import type { Project } from "@videola/core";

/** The three targets anyone actually asks for, and what they are for. */
export const LOUDNESS_TARGETS = [
  { lufs: -14, key: "streaming" },
  { lufs: -16, key: "podcast" },
  { lufs: -23, key: "broadcast" },
] as const;

export interface Normalized {
  /** What the master fader should be set to. */
  volume: number;
  /** What the programme measured *after* that was applied -- not what the arithmetic predicted. */
  loudness: number;
  /** How many renders it took. One means the first correction landed. */
  passes: number;
}

// The core's own ceiling on a fader, from `project.setMasterVolume`.
const MAX_VOLUME = 4;

// A tenth of a loudness unit is well under what anyone hears and well under what the standards
// argue about, so a correction that lands inside it is finished.
const TOLERANCE_LU = 0.1;

// Three renders of the whole timeline is already a slow button. A chain that has not converged by
// then is one whose gain is not constant -- a limiter, a compressor -- and the honest answer there
// is the number it did reach rather than another guess at it.
const MAX_PASSES = 3;

/**
 * Brings a project to a target loudness by moving the master fader, and reports what it then
 * actually measured.
 *
 * Measuring again after correcting is the whole of this, and it is not a formality. A mastering
 * chain is not a gain: `DynamicsCompressorNode` -- which both the compressor and the limiter are --
 * changes what it does when its input level changes, and adds its own makeup gain on top. So the
 * arithmetic "measured -14, wanted -16, therefore multiply by 0.79" is right for a project with no
 * inserts and wrong for one with a limiter on the master, by however much the limiter stopped
 * doing. Repeating the measurement is what turns that from a lie into a number, and it is why what
 * comes back is `loudness` and not `target`.
 *
 * `measure` is the caller's: measuring means rendering the whole timeline offline, and how long a
 * context to build for it is the caller's business as it already was.
 */
export async function normalizeToTarget(
  project: Project,
  target: number,
  measure: (candidate: Project) => Promise<number>,
): Promise<Normalized> {
  let volume = project.master.volume;
  let loudness = await measure(project);
  let passes = 0;

  while (passes < MAX_PASSES) {
    // A silent programme has no loudness and nothing a fader can do about it. Multiplying silence
    // is the one case where the arithmetic would run away to the ceiling and report success.
    if (!Number.isFinite(loudness)) break;
    const error = target - loudness;
    if (Math.abs(error) < TOLERANCE_LU) break;
    const next = Math.min(MAX_VOLUME, Math.max(0, volume * Math.pow(10, error / 20)));
    // Held against the ceiling: the fader cannot go further, so another render would measure the
    // same thing and call it a pass. Material this quiet needs a gain the master does not have.
    if (next === volume) break;
    volume = next;
    loudness = await measure(withMasterVolume(project, volume));
    passes += 1;
  }

  return { volume, loudness, passes };
}

/**
 * The project as it would be with that fader, without touching the one that was handed in.
 *
 * The cast is the generated `Project`'s index signature: it declares its fields as JSON values, and
 * a `MediaAsset` carries a `bigint` that no JSON value is. The spread is the same object with one
 * number changed, so nothing here is being claimed that is not already true of what came in.
 */
export function withMasterVolume(project: Project, volume: number): Project {
  return { ...project, master: { ...project.master, volume } } as unknown as Project;
}
