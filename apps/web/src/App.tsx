import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import {
  cmd,
  createWasmBackend,
  VideolaDocument,
  type ClipId,
  type Command,
  type LoadWarning,
  type Project,
  type Time,
} from "@videola/core";
import {
  EXPORT_FORMATS,
  formatSupport,
  startExport,
  type ExportHandle,
  type ExportRange,
} from "@videola/engine";
import { mediaForProject } from "@videola/media";
import {
  AppShell,
  ExportDialog,
  Timeline,
  timelineEnd,
  useI18n,
  type ExportFormatChoice,
  type ExportProgress,
  type ExportSelection,
} from "@videola/ui";

type ErrorKey = "error.openFailed" | "error.saveFailed" | "error.actionFailed";

interface ShellError {
  key: ErrorKey;
  reason: string;
  id: number;
}

export function App(): ReactElement {
  const [doc, setDoc] = useState<VideolaDocument>();
  const [project, setProject] = useState<Project>();
  const [warnings, setWarnings] = useState<LoadWarning[]>([]);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const [error, setError] = useState<ShellError>();
  const [playhead, setPlayhead] = useState<Time>(0);
  const [selectedClip, setSelectedClip] = useState<ClipId>();
  const [exporting, setExporting] = useState(false);
  const [formats, setFormats] = useState<ExportFormatChoice[]>([]);
  const [progress, setProgress] = useState<ExportProgress>();
  const [exportError, setExportError] = useState<string>();
  const runningExport = useRef<ExportHandle>(undefined);
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
      doc.dispatch(cmd.trackAdd("video", "V1"));
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

  // Asked once the dialog opens and once per project size, because the answer depends on both the
  // machine and the resolution -- a 4K H.264 encode can be refused where 1080p is fine.
  useEffect(() => {
    if (!exporting || project === undefined) return;
    let stale = false;
    void formatSupport({
      width: project.settings.width,
      height: project.settings.height,
      sampleRate: project.settings.sampleRate,
      channels: 2,
    }).then((support) => {
      if (stale) return;
      setFormats(support.map((entry) => ({ id: entry.format.id, ...entry })));
    });
    return () => {
      stale = true;
    };
  }, [exporting, project]);

  const beginExport = useCallback(
    (selection: ExportSelection) => {
      const format = EXPORT_FORMATS.find((entry) => entry.id === selection.formatId);
      if (doc === undefined || project === undefined || format === undefined) return;
      setExportError(undefined);
      setProgress({ done: 0, total: 1 });
      const handle = startExport({
        project,
        sourceTimes: doc.sourceTimesAt,
        options: {
          format,
          width: selection.width,
          height: selection.height,
          fps: selection.fps,
          videoBitrate: selection.videoBitrate,
          audioBitrate: selection.audioBitrate,
          range: rangeOf(project, selection.range === "selection" ? selectedClip : undefined),
        },
        onProgress: (done, total) => {
          if (runningExport.current === handle) setProgress({ done, total });
        },
      });
      runningExport.current = handle;
      const name = project.meta.title || project.meta.id;
      handle.result.then(
        (result) => {
          // A cancelled run's rejection and a finished run's file can both be in flight while the
          // next one is already going. Whichever handle is current owns the screen.
          if (runningExport.current !== handle) return;
          runningExport.current = undefined;
          downloadBlob(result.bytes, `${name}.${result.extension}`, result.mimeType);
          setProgress(undefined);
          setExporting(false);
        },
        (err: unknown) => {
          if (runningExport.current !== handle) return;
          runningExport.current = undefined;
          setProgress(undefined);
          setExportError(exportReason(err));
        },
      );
    },
    [doc, project, selectedClip],
  );

  const cancelExport = useCallback(() => {
    runningExport.current?.cancel();
  }, []);

  const open = useCallback(async () => {
    const file = await pickFile(".videola");
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

  return (
    <AppShell
      onNew={() => window.location.reload()}
      onOpen={() => void open()}
      onImport={doc === undefined ? undefined : addTrack}
      onExport={
        doc === undefined
          ? undefined
          : () => {
              // A failure from the last attempt would otherwise greet the next one.
              setExportError(undefined);
              setExporting(true);
            }
      }
      onSave={doc === undefined ? undefined : save}
      onUndo={undo}
      onRedo={redo}
      canUndo={flags.canUndo}
      canRedo={flags.canRedo}
    >
      <ErrorBanner error={error} />
      <WarningBanner warnings={warnings} />
      <Status project={project} />
      {project !== undefined && (
        <Timeline
          project={project}
          playhead={playhead}
          dispatch={edit}
          onSeek={setPlayhead}
          onSelectionChange={setSelectedClip}
        />
      )}
      {exporting && project !== undefined && (
        <ExportDialog
          formats={formats}
          settings={project.settings}
          hasSelection={selectedClip !== undefined}
          progress={progress}
          error={exportError}
          onExport={beginExport}
          onCancel={cancelExport}
          onClose={() => setExporting(false)}
        />
      )}
    </AppShell>
  );
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
      {t(error.key, { reason: error.reason })}
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

function Status({ project }: { project?: Project }): ReactElement {
  const { t } = useI18n();
  if (project === undefined) {
    return <p style={{ padding: "var(--v-space-6)" }}>…</p>;
  }
  const tracks = project.timeline.tracks.length;
  return (
    <div style={{ padding: "var(--v-space-6)", display: "grid", gap: "var(--v-space-2)" }}>
      <strong>{project.meta.title || t("project.untitled")}</strong>
      <span>{t("project.trackCount", { count: tracks })}</span>
      <span>
        {project.settings.width}×{project.settings.height}
      </span>
    </div>
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The whole project, or the one clip that is selected. A range is a pair of instants either way,
// so the export never learns that a selection was involved.
function rangeOf(project: Project, clip: ClipId | undefined): ExportRange {
  const selected = project.timeline.tracks
    .flatMap((track) => track.clips)
    .find((entry) => entry.id === clip);
  if (selected === undefined) return { from: 0, to: timelineEnd(project) };
  return { from: selected.start, to: selected.start + selected.duration };
}

// Everything the export throws is a catalogue key. Anything else came from the browser and is of
// no use on screen, so it keeps its place in the console and the user is told what is true.
function exportReason(error: unknown): string {
  if (!(error instanceof Error)) return "error.exportFailed";
  if (/^(error|export)\./.test(error.message)) return error.message;
  console.error(error);
  return "error.exportFailed";
}

function downloadBlob(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  type = "application/zip",
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can abort the download in Safari/Firefox before it has
  // actually started reading the blob; give the browser a tick to pick it up first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
