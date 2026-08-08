import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import {
  cmd,
  createWasmBackend,
  VideolaDocument,
  type Command,
  type LoadWarning,
  type Project,
  type Time,
} from "@videola/core";
import { mediaForProject } from "@videola/media";
import { AppShell, Timeline, useI18n } from "@videola/ui";

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
