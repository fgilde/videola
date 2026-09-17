/**
 * Where the open project lives, when the browser is willing to say.
 *
 * A browser editor that can only ever hand you a download is a browser editor: every save is a new
 * file in the downloads folder, `project (3).videola` next to `project (2).videola`, and which one
 * is the work is a question for the person. With the File System Access API it is an editor that
 * happens to run in a tab -- open a file from where it lives, save back into it, and the title bar
 * says which file that is.
 *
 * Chromium has the API and Firefox and Safari do not, so both paths are real. Without it, opening
 * is a file input and saving is a download, exactly as before -- what changes is that nothing else
 * in the application has to know which of the two it is.
 */

// The TypeScript DOM library carries the handles -- OPFS uses them already -- but not the two
// pickers, which are Chromium's rather than every engine's. Declared with the code that calls them
// so the declaration travels with it, and optional so calling one without checking is a type error.
declare global {
  interface FilePickerType {
    description?: string;
    accept: Record<string, string[]>;
  }

  interface Window {
    showOpenFilePicker?: (options?: {
      types?: FilePickerType[];
      multiple?: boolean;
    }) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: FilePickerType[];
    }) => Promise<FileSystemFileHandle>;
  }
}

const PROJECT_TYPE = {
  description: "Videola project",
  accept: { "application/x-videola": [".videola"] },
};

/** Whether this browser can write back to a file somebody chose. */
export function canWriteFiles(): boolean {
  return typeof window.showSaveFilePicker === "function";
}

export interface OpenedProject {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  /** Absent where the browser cannot hand one out; saving then asks where to put it. */
  handle?: FileSystemFileHandle;
}

/**
 * A project to open, through the picker that can give a handle back where there is one.
 *
 * Undefined when the person changed their mind, which is not a failure and must not be reported as
 * one: a cancelled picker rejects with an `AbortError` and that is the only reason this catches.
 */
export async function openProjectFile(): Promise<OpenedProject | undefined> {
  const pick = window.showOpenFilePicker;
  if (pick !== undefined) {
    const picked = await cancellable(() => pick({ types: [PROJECT_TYPE], multiple: false }));
    const handle = picked?.[0];
    if (handle === undefined) return undefined;
    const file = await handle.getFile();
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, handle };
  }
  const file = await pickWithInput();
  if (file === undefined) return undefined;
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
}

/** Where to write from now on. Undefined when the person cancelled the dialogue. */
export async function askWhereToSave(suggested: string): Promise<FileSystemFileHandle | undefined> {
  const ask = window.showSaveFilePicker;
  if (ask === undefined) return undefined;
  return await cancellable(() => ask({ suggestedName: suggested, types: [PROJECT_TYPE] }));
}

/**
 * The bytes into the file that handle names.
 *
 * A writable is opened, written and closed: the file on disk only changes at the close, so an
 * interrupted save leaves what was there rather than half a project.
 */
export async function writeProjectFile(
  handle: FileSystemFileHandle,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

/** The download that was the only way before, and still is where there is no handle. */
export function downloadProject(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can abort the download in Safari and Firefox before the browser has
  // started reading the blob; a tick is enough for it to pick it up.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `.videola`, whatever the project is called and whatever the person typed into the title. */
export function projectFileName(title: string, id: string): string {
  const stem = title.trim() === "" ? id : title.trim();
  return stem.toLowerCase().endsWith(".videola") ? stem : `${stem}.videola`;
}

// A cancelled picker is a decision, not a fault. Everything else -- a permission denied, a file
// that vanished -- belongs to the caller, which reports it like any other failure.
async function cancellable<T>(ask: () => Promise<T>): Promise<T | undefined> {
  try {
    return await ask();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return undefined;
    throw error;
  }
}

function pickWithInput(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = ".videola";
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
