import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { DestinationsDialog, type DestinationsDialogProps } from "./DestinationsDialog";

function show(over: Partial<DestinationsDialogProps> = {}): {
  connected: [string, string][];
  added: unknown[];
  removed: string[];
} {
  const connected: [string, string][] = [];
  const added: unknown[] = [];
  const removed: string[] = [];
  render(
    <I18nProvider>
      <DestinationsDialog
        url=""
        token=""
        destinations={[]}
        onConnect={(url, token) => connected.push([url, token])}
        onAdd={(draft) => added.push(draft)}
        onRemove={(id) => removed.push(id)}
        onClose={vi.fn()}
        {...over}
      />
    </I18nProvider>,
  );
  return { connected, added, removed };
}

const field = (key: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-field="${key}"]`)!;

describe("the destinations dialogue", () => {
  it("asks for a server first, because that is what holds them", () => {
    const { connected } = show();

    fireEvent.change(screen.getByTestId("destination-url"), {
      target: { value: "https://videola.local" },
    });
    fireEvent.change(screen.getByTestId("destination-token"), { target: { value: "t0k" } });
    fireEvent.click(screen.getByTestId("destination-connect"));

    expect(connected).toEqual([["https://videola.local", "t0k"]]);
  });

  // The fields follow the kind, because what YouTube needs and what a webhook needs have one thing in
  // common: neither works with the other's.
  it("asks for what the chosen kind cannot work without", () => {
    show();

    expect(field("clientId")).toBeTruthy();
    expect(field("refreshToken")).toBeTruthy();

    fireEvent.change(screen.getByTestId("destination-kind"), { target: { value: "webhook" } });

    expect(document.querySelector('[data-field="clientId"]')).toBeNull();
    expect(field("url")).toBeTruthy();
  });

  it("will not offer to save one that could not publish", () => {
    show();

    const save = screen.getByTestId("destination-add") as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("destination-name"), { target: { value: "Mein Kanal" } });
    fireEvent.change(field("clientId"), { target: { value: "id" } });
    fireEvent.change(field("clientSecret"), { target: { value: "shh" } });
    expect(save.disabled).toBe(true);

    fireEvent.change(field("refreshToken"), { target: { value: "r" } });
    expect(save.disabled).toBe(false);
  });

  // Secrets and settings are two piles on purpose: one is written and never read back, the other is
  // shown beside the destination for the rest of its life.
  it("hands secrets and settings over as the two different things they are", () => {
    const { added } = show();

    fireEvent.change(screen.getByTestId("destination-name"), { target: { value: "Kanal" } });
    fireEvent.change(field("clientId"), { target: { value: "id" } });
    fireEvent.change(field("clientSecret"), { target: { value: "shh" } });
    fireEvent.change(field("refreshToken"), { target: { value: "r" } });
    fireEvent.change(field("privacyStatus"), { target: { value: "unlisted" } });
    fireEvent.click(screen.getByTestId("destination-add"));

    expect(added).toEqual([
      {
        kind: "youtube",
        name: "Kanal",
        secrets: { clientId: "id", clientSecret: "shh", refreshToken: "r" },
        settings: { privacyStatus: "unlisted" },
      },
    ]);
  });

  // What a destination holds, never what it is. The server does not say and neither does this: a token
  // that can be read off a screen is a token that leaks through a screen share.
  it("says which secrets a destination holds and never what they are", () => {
    show({
      destinations: [
        {
          id: "dst_1",
          kind: "youtube",
          name: "Mein Kanal",
          holds: ["clientId", "clientSecret", "refreshToken"],
        },
      ],
    });

    const row = document.querySelector('[data-destination="dst_1"]');

    expect(row?.textContent).toContain("Mein Kanal");
    expect(row?.textContent).toContain("clientSecret");
    // The list of names is the whole of what is shown; no input anywhere carries a value.
    for (const input of document.querySelectorAll("input")) {
      expect(input.value === "shh").toBe(false);
    }
  });

  it("hands a removal up by id", () => {
    const { removed } = show({
      destinations: [{ id: "dst_9", kind: "webhook", name: "Meine Seite", holds: ["url"] }],
    });

    fireEvent.click(document.querySelector('[data-remove="dst_9"]')!);

    expect(removed).toEqual(["dst_9"]);
  });

  it("says what the server said when something went wrong", () => {
    show({ error: "401 a bearer token is required" });

    expect(screen.getByTestId("destination-error").textContent).toContain("bearer token");
  });
});
