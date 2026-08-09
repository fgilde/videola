import { SPEED_TRACK, timeToSeconds } from "@videola/core";
import type { Clip, Project, Time, Track } from "@videola/core";

export interface Finding {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
}

// The textual summary an agent reads instead of a few hundred kilobytes of JSON. It answers the
// questions an editor actually asks — what is on which track, how long, which effects — and
// nothing else; the full project is one call away for anything past that.
export function describeProject(project: Project): string {
  const { width, height, fps, sampleRate } = project.settings;
  const lines = [
    `Project "${project.meta.title || "(untitled)"}" (${project.meta.id})`,
    `Format: ${width}x${height} at ${fps.numerator}/${fps.denominator} fps, ${sampleRate} Hz audio`,
    `Duration: ${seconds(timelineEnd(project))} s across ${project.timeline.tracks.length} track(s)`,
    library(project),
  ];
  for (const [index, track] of project.timeline.tracks.entries()) {
    lines.push("", `Track ${index} — ${describeTrack(track)}`);
    if (track.clips.length === 0) lines.push("  (empty)");
    for (const clip of track.clips) lines.push(`  ${describeClip(clip)}`);
  }
  if (project.markers.length > 0) {
    lines.push("", "Markers:");
    for (const marker of project.markers) {
      lines.push(`  ${seconds(marker.time)} s ${marker.label} (${marker.id})`);
    }
  }
  return lines.join("\n");
}

function library(project: Project): string {
  if (project.library.length === 0) return "Library: empty";
  const entries = project.library.map(
    (asset) => `${asset.originalName} [${asset.kind}, ${asset.sizeBytes} B] ${asset.id}`,
  );
  return `Library (${project.library.length}): ${entries.join("; ")}`;
}

function describeTrack(track: Track): string {
  const flags = (["locked", "hidden", "muted", "solo"] as const).filter((flag) => track[flag]);
  const suffix = flags.length === 0 ? "" : `, ${flags.join("/")}`;
  return `${track.kind} "${track.name}" (${track.id}), ${track.clips.length} clip(s), volume ${track.volume}, pan ${track.pan}${suffix}`;
}

function describeClip(clip: Clip): string {
  const parts = [
    `${seconds(clip.start)}–${seconds(clipEnd(clip))} s`,
    `${sourceOf(clip)} (${clip.id})`,
    `in ${seconds(clip.inPoint)} s`,
  ];
  // A ramped clip has no one rate to report, and printing its static one would tell an agent the
  // clip runs at a speed it does not run at. The keys are what it actually follows.
  const ramp = clip.keyframes?.[SPEED_TRACK];
  if (ramp !== undefined && ramp.length > 0) {
    const rates = ramp
      .map((key) => (key.value.kind === "float" ? `${seconds(key.time)}s:${key.value.value}` : "?"))
      .join(" ");
    parts.push(`speed ramp ${rates}${clip.speed.reverse ? " reversed" : ""}`);
  } else if (clip.speed.rate !== 1 || clip.speed.reverse) {
    parts.push(`speed ${clip.speed.rate}${clip.speed.reverse ? " reversed" : ""}`);
  }
  if (clip.volume !== 1) parts.push(`volume ${clip.volume}`);
  if (clip.transitionIn) {
    parts.push(`transition in ${clip.transitionIn.transitionType} ${seconds(clip.transitionIn.duration)} s`);
  }
  for (const effect of clip.effects) {
    const keys = Object.keys(effect.keyframes);
    const animated = keys.length === 0 ? "" : ` keyframed:${keys.join(",")}`;
    parts.push(`effect ${effect.effectType}${effect.enabled ? "" : " (off)"}${animated}`);
  }
  return parts.join(", ");
}

function sourceOf(clip: Clip): string {
  switch (clip.source.kind) {
    case "media":
      return `media ${clip.source.media}`;
    case "generator":
      return `generator ${clip.source.generator.type}`;
    case "compound":
      return `compound of ${clip.source.timeline.tracks.length} track(s)`;
  }
}

// What the core cannot refuse on its own. Every command checks the clip it is given, but nothing
// stops two accepted clips from overlapping, and nothing stops a `.videola` from referencing a
// medium its library never declared.
export function validateProject(project: Project): Finding[] {
  const declared = new Set(project.library.map((asset) => asset.id));
  const findings: Finding[] = [];

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      findings.push(...clipFindings(clip, track, declared));
    }
    findings.push(...overlapFindings(track));
  }
  return findings;
}

function clipFindings(clip: Clip, track: Track, declared: Set<string>): Finding[] {
  const findings: Finding[] = [];
  if (clip.source.kind === "media" && !declared.has(clip.source.media)) {
    findings.push({
      severity: "error",
      code: "clip.unknownMedia",
      message: `clip ${clip.id} on track ${track.id} references ${clip.source.media}, which is not in the library`,
    });
  }
  if (clip.duration <= 0) {
    findings.push({
      severity: "error",
      code: "clip.emptyDuration",
      message: `clip ${clip.id} on track ${track.id} has a duration of ${clip.duration} flicks`,
    });
  }
  const fades = clip.fades.inDuration + clip.fades.outDuration;
  if (fades > clip.duration) {
    findings.push({
      severity: "warning",
      code: "clip.fadesLongerThanClip",
      message: `clip ${clip.id} fades (${seconds(fades)} s) are longer than the clip (${seconds(clip.duration)} s)`,
    });
  }
  return findings;
}

// Sorted by start, and compared against the furthest end seen so far rather than against the
// previous clip: a long clip with two short ones inside it overlaps both, and neighbour-to-neighbour
// comparison sees only the first of them.
function overlapFindings(track: Track): Finding[] {
  const findings: Finding[] = [];
  let covering: Clip | undefined;
  for (const clip of [...track.clips].sort((a, b) => a.start - b.start)) {
    if (covering !== undefined && clip.start < clipEnd(covering)) {
      findings.push({
        severity: "warning",
        code: "track.overlappingClips",
        message: `clips ${covering.id} and ${clip.id} overlap on track ${track.id} from ${seconds(clip.start)} s to ${seconds(Math.min(clipEnd(covering), clipEnd(clip)))} s`,
      });
    }
    if (covering === undefined || clipEnd(clip) > clipEnd(covering)) covering = clip;
  }
  return findings;
}

function clipEnd(clip: Clip): Time {
  return clip.start + clip.duration;
}

function timelineEnd(project: Project): Time {
  return project.timeline.tracks
    .flatMap((track) => track.clips)
    .reduce((latest, clip) => Math.max(latest, clipEnd(clip)), 0);
}

function seconds(time: Time): string {
  return timeToSeconds(time).toFixed(3);
}
