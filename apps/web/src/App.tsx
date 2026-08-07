import { useCallback, useEffect, useState, type ReactElement } from "react";

import { cmd, createWasmBackend, VideolaDocument, type Project } from "@videola/core";
import { AppShell, useI18n } from "@videola/ui";

interface ShellError {
  key: "error.openFailed" | "error.saveFailed";
  reason: string;
}

export function App(): ReactElement {
  const [document, setDocument] = useState<VideolaDocument>();
  const [project, setProject] = useState<Project>();
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const [error, setError] = useState<ShellError>();

  useEffect(() => {
    let cancelled = false;
    void createWasmBackend().then((backend) => {
      if (cancelled) return;
      const next = new VideolaDocument(backend);
      setDocument(next);
      setProject(next.state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (document === undefined) return;
    return document.subscribe((next) => {
      setProject(next);
      setFlags({ canUndo: document.canUndo, canRedo: document.canRedo });
    });
  }, [document]);

  const addTrack = useCallback(() => {
    document?.dispatch(cmd.trackAdd("video", "V1"));
  }, [document]);

  const save = useCallback(() => {
    if (document === undefined || project === undefined) return;
    try {
      const now = new Date().toISOString();
      const bytes = document.save({
        appVersion: "0.1.0",
        created: now,
        modified: now,
        locale: navigator.language,
        slim: true,
      });
      downloadBlob(bytes, `${project.meta.title || project.meta.id}.videola`);
      setError(undefined);
    } catch (err) {
      setError({ key: "error.saveFailed", reason: reasonOf(err) });
    }
  }, [document, project]);

  const open = useCallback(async () => {
    const file = await pickFile(".videola");
    if (file === undefined) return;
    try {
      const backend = await createWasmBackend(new Uint8Array(await file.arrayBuffer()));
      const next = new VideolaDocument(backend);
      setDocument(next);
      setProject(next.state);
      setError(undefined);
    } catch (err) {
      setError({ key: "error.openFailed", reason: reasonOf(err) });
    }
  }, []);

  return (
    <AppShell
      onNew={() => window.location.reload()}
      onOpen={() => void open()}
      onImport={document === undefined ? undefined : addTrack}
      onSave={document === undefined ? undefined : save}
      onUndo={() => document?.undo()}
      onRedo={() => document?.redo()}
      canUndo={flags.canUndo}
      canRedo={flags.canRedo}
    >
      <ErrorBanner error={error} />
      <Status project={project} />
    </AppShell>
  );
}

function ErrorBanner({ error }: { error?: ShellError }): ReactElement | null {
  const { t } = useI18n();
  if (error === undefined) return null;
  return (
    <p role="alert" style={{ padding: "8px 24px", color: "var(--v-danger)" }}>
      {t(error.key, { reason: error.reason })}
    </p>
  );
}

function Status({ project }: { project?: Project }): ReactElement {
  const { t, formatTimecode } = useI18n();
  if (project === undefined) {
    return <p style={{ padding: 24 }}>…</p>;
  }
  const tracks = project.timeline.tracks.length;
  return (
    <div style={{ padding: 24, display: "grid", gap: 8 }}>
      <strong>{project.meta.title || t("project.untitled")}</strong>
      <span>{t("project.trackCount", { count: tracks })}</span>
      <span>
        {project.settings.width}×{project.settings.height} · {formatTimecode(0, project.settings.fps)}
      </span>
      {tracks === 0 && <em>{t("empty.noTracks")}</em>}
    </div>
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function downloadBlob(bytes: Uint8Array, filename: string): void {
  // Copies rather than wraps: bytes comes straight from WASM linear memory, which a Blob
  // must not reference directly - a later grow() could move or invalidate it.
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/zip" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}
