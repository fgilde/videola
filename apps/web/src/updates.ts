type Translate = (key: string, vars?: Record<string, string | number>) => string;

// Dynamically, so the browser build never loads a module whose every call ends in the Tauri IPC
// that is not there. The guard is what keeps that chunk out of a browser session at all.
function insideTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// A release built without a signing key carries no updater configuration, and a machine that is
// offline gets no answer from the endpoint. Neither is worth interrupting an editing session for,
// so a failed check is silence — the only thing this may ever do is offer a version that exists.
export async function offerUpdate(t: Translate): Promise<void> {
  if (!insideTauri()) return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update === null) return;
    if (!window.confirm(t("update.available", { version: update.version }))) return;
    await update.downloadAndInstall();
    window.alert(t("update.installed"));
  } catch {
    // Deliberately nothing: see above.
  }
}
