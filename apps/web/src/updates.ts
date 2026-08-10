type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Whether this is the desktop build.
 *
 * Exported, because two things ask it and they must not disagree: the updater, which has nothing to
 * check in a browser, and the offer to fetch a desktop build, which would be an offer to install
 * what is already running. The dynamic import below is what keeps the Tauri chunk out of a browser
 * session at all.
 */
export function insideTauri(): boolean {
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

/**
 * Hand the window over: show the editor, take the splash screen away.
 *
 * The desktop build opens with its main window hidden and a small always-on-top window carrying a
 * mark and a moving bar, because the first thing that happens on a cold start is a WASM module being
 * compiled and a window showing an empty grey editor while that runs looks like a program that has
 * crashed. Which moment counts as ready is a question only the editor can answer -- the page has
 * finished loading long before the core is up -- so this is called from there and not from Rust.
 *
 * Silence on failure, twice over: in a browser there is nothing to do, and in a desktop build a
 * window that cannot be shown is not something an editing session can be interrupted for. The shell
 * carries a timer that shows the window anyway, so a frontend that never reaches this leaves a
 * usable application rather than a process with no window.
 */
export async function revealWindow(): Promise<void> {
  if (!insideTauri()) return;
  try {
    const { getCurrentWindow, Window } = await import("@tauri-apps/api/window");
    await getCurrentWindow().show();
    await (await Window.getByLabel("splashscreen"))?.close();
  } catch {
    // See above: the shell's own timer is the answer to this.
  }
}
