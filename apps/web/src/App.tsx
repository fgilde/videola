import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import {
  cmd,
  createWasmBackend,
  FLICKS_PER_SECOND,
  VideolaDocument,
  type Command,
  type LoadWarning,
  type MediaId,
  type Project,
  type Time,
  type Track,
  type TrackKind,
} from "@videola/core";
import { AudioGraph, AudioSource, Playback, probe } from "@videola/engine";
import { importFile, mediaForProject } from "@videola/media";
import {
  AppShell,
  DropZone,
  pickFiles,
  Preview,
  projectEnd,
  Timeline,
  Transport,
  useI18n,
} from "@videola/ui";

type ErrorKey = "error.openFailed" | "error.saveFailed" | "error.actionFailed" | "error.importFailed";

interface ShellError {
  key: ErrorKey;
  reason: string;
  id: number;
}

const MEDIA_ACCEPT = "video/*,audio/*";
const STILL_DURATION = 5 * FLICKS_PER_SECOND;

export function App(): ReactElement {
  const [doc, setDoc] = useState<VideolaDocument>();
  const [project, setProject] = useState<Project>();
  const [warnings, setWarnings] = useState<LoadWarning[]>([]);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const [error, setError] = useState<ShellError>();
  const [playback, setPlayback] = useState<Playback>();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [playhead, setPlayhead] = useState<Time>(0);
  const [playing, setPlaying] = useState(false);
  const nextErrorId = useRef(0);

  // A stable identity per report, so an identical repeat error still replaces the DOM node
  // and gets re-announced by assistive tech instead of sitting there as unchanged content.
  const reportError = useCallback((key: ErrorKey, cause: unknown) => {
    setError({ key, reason: reasonOf(cause), id: ++nextErrorId.current });
  }, []);

  useEffect(() => {
    let cancelled = false;
    createWasmBackend()
      .then((backend) => {
        if (cancelled) return;
        const next = new VideolaDocument(backend);
        setDoc(next);
        setProject(next.state);
        setWarnings(next.warnings);
        setFlags({ canUndo: next.canUndo, canRedo: next.canRedo });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportError("error.openFailed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [reportError]);

  useEffect(() => {
    if (doc === undefined) return;
    return doc.subscribe((next) => {
      setProject(next);
      // doc.warnings only ever narrows (media.remove is the one command that can clear a
      // "missing" entry) or stays put after load - but it does change, and #notify() in
      // document.ts already refreshes it before listeners run, so read it fresh here too instead
      // of leaving the banner stuck on whatever was true at load time.
      setWarnings(doc.warnings);
      setFlags({ canUndo: doc.canUndo, canRedo: doc.canRedo });
    });
  }, [doc]);

  // One transport per document: sourceTimesAt is bound to the document it came from, and opening
  // another project has to leave the old audio context behind rather than steer two.
  useEffect(() => {
    if (doc === undefined) return;
    const audio = new AudioContext();
    const next = new Playback({
      audio,
      graph: new AudioGraph(audio, new AudioSource()),
      sourceTimes: doc.sourceTimesAt,
    });
    setPlayback(next);
    return () => {
      next.dispose();
      void audio.close();
      setPlayback(undefined);
    };
  }, [doc]);

  // The playhead comes from the clock and from nowhere else. Reading isPlaying in the same
  // callback is what makes the play button follow a context that only woke up a turn later.
  useEffect(() => {
    if (playback === undefined) return;
    return playback.onTime((at) => {
      setPlayhead(at);
      setPlaying(playback.isPlaying);
    });
  }, [playback]);

  useEffect(() => {
    if (playback === undefined || canvas === null) return;
    try {
      playback.attach(canvas);
      playback.refresh();
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [playback, canvas, reportError]);

  // load() takes the project synchronously and only the audio decoding is awaited, so the
  // refresh right after it already draws the edit that caused this.
  useEffect(() => {
    if (playback === undefined || project === undefined) return;
    void playback.load(project);
    playback.refresh();
  }, [playback, project]);

  // Deliberately not wrapped in try/catch: the timeline decides which refusals are ordinary,
  // and it can only do that if they reach it. Catching here turned a trim held against its
  // limit into nine error banners in a single drag.
  const edit = useCallback(
    (command: Command, coalesceKey?: string) => {
      doc?.dispatch(command, coalesceKey);
    },
    [doc],
  );

  const addTrack = useCallback(() => {
    if (doc === undefined) return;
    try {
      doc.dispatch(cmd.trackAdd("video", `V${doc.state.timeline.tracks.length + 1}`));
      setError(undefined);
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [doc, reportError]);

  const undo = useCallback(() => {
    if (doc === undefined) return;
    try {
      doc.undo();
      setError(undefined);
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [doc, reportError]);

  const redo = useCallback(() => {
    if (doc === undefined) return;
    try {
      doc.redo();
      setError(undefined);
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [doc, reportError]);

  const save = useCallback(async () => {
    if (doc === undefined || project === undefined) return;
    try {
      const now = new Date().toISOString();
      // The bytes live in OPFS since M1, so they have to be gathered before the write - the core
      // only holds media a .videola brought with it, and falls back to those on its own.
      const media = await mediaForProject(project);
      const bytes = doc.save(
        {
          appVersion: "0.1.0",
          created: now,
          modified: now,
          locale: navigator.language,
        },
        media,
      );
      downloadBlob(bytes, `${project.meta.title || project.meta.id}.videola`);
      setError(undefined);
    } catch (err) {
      reportError("error.saveFailed", err);
    }
  }, [doc, project, reportError]);

  const open = useCallback(async () => {
    const file = (await pickFiles(".videola"))[0];
    if (file === undefined) return;
    try {
      const backend = await createWasmBackend(new Uint8Array(await file.arrayBuffer()));
      const next = new VideolaDocument(backend);
      setDoc(next);
      setProject(next.state);
      setWarnings(next.warnings);
      setFlags({ canUndo: next.canUndo, canRedo: next.canRedo });
      setError(undefined);
    } catch (err) {
      reportError("error.openFailed", err);
    }
  }, [reportError]);

  // One file at a time and in order, because each one decides where it lands from the state the
  // one before it left behind. A rejected file costs itself and not the rest of the drop.
  const importMedia = useCallback(
    async (files: File[]) => {
      if (doc === undefined) return;
      for (const file of files) {
        try {
          appendClip(doc, await importFile(file, doc, probe));
          setError(undefined);
        } catch (err) {
          reportError("error.importFailed", err);
        }
      }
    },
    [doc, reportError],
  );

  const playPause = useCallback(() => {
    if (playback === undefined) return;
    if (playback.isPlaying) playback.pause();
    else playback.play();
  }, [playback]);

  const seek = useCallback((time: Time) => playback?.seek(time), [playback]);
  const step = useCallback((direction: 1 | -1) => playback?.stepFrame(direction), [playback]);
  const repaint = useCallback(() => playback?.refresh(), [playback]);

  return (
    <AppShell
      onNew={() => window.location.reload()}
      onOpen={() => void open()}
      onImportMedia={
        doc === undefined ? undefined : () => void pickFiles(MEDIA_ACCEPT).then(importMedia)
      }
      onAddTrack={doc === undefined ? undefined : addTrack}
      onSave={doc === undefined ? undefined : save}
      onUndo={undo}
      onRedo={redo}
      canUndo={flags.canUndo}
      canRedo={flags.canRedo}
    >
      <DropZone onFiles={(files) => void importMedia(files)}>
        <div className="v-editor">
          <div>
            <ErrorBanner error={error} />
            <WarningBanner warnings={warnings} />
          </div>
          {project === undefined ? (
            <p style={{ padding: "var(--v-space-6)" }}>…</p>
          ) : (
            <>
              <Preview
                width={project.settings.width}
                height={project.settings.height}
                onCanvas={setCanvas}
                onResize={repaint}
              />
              <Transport
                playing={playing}
                time={playhead}
                duration={projectEnd(project)}
                fps={project.settings.fps}
                onPlayPause={playPause}
                onSeek={seek}
                onStep={step}
              />
              <Timeline project={project} playhead={playhead} dispatch={edit} onSeek={seek} />
            </>
          )}
        </div>
      </DropZone>
    </AppShell>
  );
}

// An imported medium that is not on the timeline is an entry in a list nobody built yet, so it
// goes straight behind whatever is already on the first track of its kind.
function appendClip(doc: VideolaDocument, media: MediaId): void {
  const asset = doc.state.library.find((entry) => entry.id === media);
  if (asset === undefined) return;
  const kind: TrackKind = asset.kind === "audio" ? "audio" : "video";
  const track =
    doc.state.timeline.tracks.find((candidate) => candidate.kind === kind) ??
    added(doc, kind, `${kind === "audio" ? "A" : "V"}${doc.state.timeline.tracks.length + 1}`);
  if (track === undefined) return;
  const start = track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
  // A medium the core could not time - a still, or a container without a duration - still has to
  // occupy something on the timeline, and five seconds is the length every editor gives a still.
  const duration = asset.duration ?? STILL_DURATION;
  doc.dispatch(cmd.clipAdd(track.id, { kind: "media", media }, start, duration));
}

function added(doc: VideolaDocument, kind: TrackKind, name: string): Track | undefined {
  doc.dispatch(cmd.trackAdd(kind, name));
  return doc.state.timeline.tracks.find((candidate) => candidate.kind === kind);
}

function ErrorBanner({ error }: { error?: ShellError }): ReactElement | null {
  const { t } = useI18n();
  if (error === undefined) return null;
  return (
    <p
      key={error.id}
      role="alert"
      style={{ padding: "var(--v-space-2) var(--v-space-6)", color: "var(--v-danger)" }}
    >
      {/* The reason is a catalogue key wherever the core or the importer raised it, and a
          browser's own words otherwise; translate() hands an unknown key straight back. */}
      {t(error.key, { reason: t(error.reason) })}
    </p>
  );
}

function WarningBanner({ warnings }: { warnings: LoadWarning[] }): ReactElement | null {
  const { t } = useI18n();
  const missingMedia = warnings.filter((warning) => warning.kind === "missingMedia").length;
  if (missingMedia === 0) return null;
  // Same severity tier as ErrorBanner (role="alert" + --v-danger): the theme has no separate
  // "warning" token, and a missing medium is exactly as actionable as the errors above it, not
  // a passive status update - role="status" is announced politely and easy to miss, which
  // contradicted the danger colour right next to it.
  return (
    <p
      role="alert"
      style={{ padding: "var(--v-space-2) var(--v-space-6)", color: "var(--v-danger)" }}
    >
      {t("warning.missingMedia", { count: missingMedia })}
    </p>
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadBlob(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can abort the download in Safari/Firefox before it has
  // actually started reading the blob; give the browser a tick to pick it up first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
