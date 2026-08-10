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

/** What a found desktop update offers: which version, and a way to take it with progress reported. */
export interface DesktopUpdate {
  version: string;
  install: (onProgress: (fraction: number | undefined) => void) => Promise<void>;
}

/**
 * Look for a desktop update and hand it over if there is one.
 *
 * A release built without a signing key carries no updater configuration, and a machine that is
 * offline gets no answer from the endpoint. Neither is worth interrupting an editing session for, so
 * a failed check is silence — the only thing this may ever do is report a version that exists.
 *
 * The offer is made in the editor's own dialogue rather than in `window.confirm`. That is not only
 * looks: a confirm box blocks the whole page while it is up, cannot say how far a download has got,
 * and is the one thing on screen that is neither translated by the catalogue nor themed.
 */
export async function findDesktopUpdate(): Promise<DesktopUpdate | undefined> {
  if (!insideTauri()) return undefined;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update === null) return undefined;
    return {
      version: update.version,
      install: async (onProgress) => {
        // The updater reports bytes and, on some hosts, no total at all. `undefined` is passed
        // through rather than faked as a number, so a bar that cannot know its length can say so.
        let total: number | undefined;
        let taken = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength;
            onProgress(total === undefined ? undefined : 0);
            return;
          }
          if (event.event === "Progress") {
            taken += event.data.chunkLength;
            onProgress(total === undefined || total === 0 ? undefined : taken / total);
            return;
          }
          onProgress(1);
        });
      },
    };
  } catch {
    // Deliberately nothing: see above.
    return undefined;
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

/**
 * Watch for a new build of the browser version, and say when one is waiting.
 *
 * The desktop build has an updater; a browser tab left open for a week has nothing at all, and it
 * goes on running whatever was current when it was opened. The service worker is what notices: a new
 * one installs beside the running one and waits, and that waiting worker *is* the new version.
 *
 * Nothing is swapped underneath a session. The editor is told, the editor tells whoever is using it,
 * and the swap happens on a reload they asked for — a worker that took over on its own would change
 * the bundle under unsaved work.
 *
 * Returns a function that takes the new version, or `undefined` where there is nothing to take.
 * Registration failing is silence: a browser with workers switched off is a browser that still edits.
 */
export function watchForWebUpdate(onWaiting: (take: () => void) => void): void {
  if (insideTauri() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void (async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const offer = (worker: ServiceWorker | null): void => {
        // Only where one is already running: on the very first visit the freshly installed worker is
        // not a new version of anything, and offering a reload for it would be a reload for nothing.
        if (worker === null || navigator.serviceWorker.controller === null) return;
        onWaiting(() => {
          worker.postMessage("take-over");
          // The reload waits for the new worker to be in charge, or a page reloaded a moment too
          // early would be served by the old one and ask again.
          navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {
            once: true,
          });
        });
      };

      offer(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") offer(registration.waiting);
        });
      });
    } catch {
      // See above.
    }
  })();
}
