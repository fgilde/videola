import { afterEach, describe, expect, it, vi } from "vitest";

import {
  askWhereToSave,
  canWriteFiles,
  openProjectFile,
  projectFileName,
  writeProjectFile,
} from "./project-file";

// Two browsers, one module. Chromium hands out a handle and this saves back into the file somebody
// opened; Firefox and Safari hand out none and it is the download it always was. Both are stubbed
// here because jsdom has neither picker and no file system to write to.
interface Picked {
  written: Uint8Array[];
  closed: number;
  name: string;
}

function handleOf(name = "cut.videola"): { handle: FileSystemFileHandle; state: Picked } {
  const state: Picked = { written: [], closed: 0, name };
  const handle = {
    name,
    getFile: async () => new File([new Uint8Array([1, 2, 3])], name),
    createWritable: async () => ({
      write: async (bytes: Uint8Array) => {
        state.written.push(bytes);
      },
      close: async () => {
        state.closed += 1;
      },
    }),
  };
  return { handle: handle as unknown as FileSystemFileHandle, state };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("projectFileName", () => {
  it("names the file after the project", () => {
    expect(projectFileName("Sommer 2026", "prj_1")).toBe("Sommer 2026.videola");
  });

  it("falls back to the id where nobody has typed a title", () => {
    expect(projectFileName("   ", "prj_1")).toBe("prj_1.videola");
  });

  it("does not put the extension on twice", () => {
    expect(projectFileName("cut.videola", "prj_1")).toBe("cut.videola");
  });
});

describe("canWriteFiles", () => {
  it("is false in a browser with no save picker", () => {
    expect(canWriteFiles()).toBe(false);
  });

  it("is true where there is one", () => {
    vi.stubGlobal("showSaveFilePicker", () => undefined);
    expect(canWriteFiles()).toBe(true);
  });
});

describe("writeProjectFile", () => {
  it("writes the bytes and closes the file, which is when disk really changes", async () => {
    const { handle, state } = handleOf();

    await writeProjectFile(handle, new Uint8Array([7, 7, 7]));

    expect([...(state.written[0] ?? [])]).toEqual([7, 7, 7]);
    expect(state.closed).toBe(1);
  });

  it("closes the file even when the write fails, or the next save finds it locked", async () => {
    let closed = 0;
    const handle = {
      name: "cut.videola",
      createWritable: async () => ({
        write: async () => {
          throw new Error("disk is full");
        },
        close: async () => {
          closed += 1;
        },
      }),
    } as unknown as FileSystemFileHandle;

    await expect(writeProjectFile(handle, new Uint8Array([1]))).rejects.toThrow("disk is full");

    expect(closed).toBe(1);
  });
});

describe("askWhereToSave", () => {
  it("hands back the file somebody chose", async () => {
    const { handle } = handleOf("neu.videola");
    vi.stubGlobal("showSaveFilePicker", async () => handle);

    expect(await askWhereToSave("neu.videola")).toBe(handle);
  });

  // A dismissed dialogue is an answer, not a fault: reported as one it would put an error banner in
  // front of somebody who simply changed their mind.
  it("says nothing was chosen when the dialogue is dismissed", async () => {
    vi.stubGlobal("showSaveFilePicker", async () => {
      throw new DOMException("cancelled", "AbortError");
    });

    expect(await askWhereToSave("neu.videola")).toBeUndefined();
  });

  it("lets a real failure through", async () => {
    vi.stubGlobal("showSaveFilePicker", async () => {
      throw new DOMException("not allowed", "SecurityError");
    });

    await expect(askWhereToSave("neu.videola")).rejects.toThrow("not allowed");
  });

  it("has nowhere to ask in a browser without the picker", async () => {
    expect(await askWhereToSave("neu.videola")).toBeUndefined();
  });
});

describe("openProjectFile", () => {
  it("brings the handle along, which is what makes the next save a save", async () => {
    const { handle } = handleOf("alt.videola");
    vi.stubGlobal("showOpenFilePicker", async () => [handle]);
    vi.stubGlobal("showSaveFilePicker", () => undefined);

    const opened = await openProjectFile();

    expect(opened?.name).toBe("alt.videola");
    expect(opened?.handle).toBe(handle);
    expect([...(opened?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it("is undefined when the picker is dismissed", async () => {
    vi.stubGlobal("showOpenFilePicker", async () => {
      throw new DOMException("cancelled", "AbortError");
    });

    expect(await openProjectFile()).toBeUndefined();
  });
});
