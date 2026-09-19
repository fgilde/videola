import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { Mcp } from "./Mcp";

// jsdom implements <dialog> without the modal behaviour, the same way the about dialogue's check
// does: what is checked here is what the dialogue says, not the browser's focus trap.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

function show(onClose = (): void => undefined): void {
  render(
    <I18nProvider>
      <Mcp onClose={onClose} />
    </I18nProvider>,
  );
}

function config(): string {
  return screen.getByTestId("mcp-config").textContent ?? "";
}

describe("the MCP dialogue", () => {
  it("shows a configuration an MCP client can take as it stands", () => {
    show();
    const written: unknown = JSON.parse(config());
    expect(written).toMatchObject({
      mcpServers: { videola: { command: "node" } },
    });
  });

  // The path to the built server and the directory it may touch are the two things nobody can
  // guess, so both have to be in the block rather than in prose above it.
  it("names the server bundle and the storage root, the two things that have to be filled in", () => {
    show();
    expect(config()).toContain("apps/server/dist/mcp.mjs");
    expect(config()).toContain("VIDEOLA_STORAGE_ROOT");
  });

  it("puts that configuration on the clipboard, because nobody should retype it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    show();

    fireEvent.click(screen.getByTestId("mcp-copy"));

    expect(writeText).toHaveBeenCalledWith(config());
    await waitFor(() => expect(screen.getByTestId("mcp-copy").textContent).toBe("Kopiert"));
  });

  it("says where the configuration goes for the clients people actually use", () => {
    show();
    const text = document.querySelector(".v-mcp")?.textContent ?? "";
    expect(text).toContain("claude_desktop_config.json");
    expect(text).toContain("claude mcp add videola");
  });

  it("links the page that lists every tool", () => {
    show();
    const link = document.querySelector<HTMLAnchorElement>(".v-mcp__foot a");
    expect(link?.href).toContain("guide/api-and-mcp");
    expect(link?.rel).toContain("noreferrer");
  });

  it("tells its host when it has closed, so the host can forget it", () => {
    const onClose = vi.fn();
    show(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
