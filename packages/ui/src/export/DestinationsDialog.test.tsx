import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { DestinationsDialog, type DestinationsDialogProps } from "./DestinationsDialog";

function show(over: Partial<DestinationsDialogProps> = {}): {
  connected: [string, string][];
  added: unknown[];
  changed: [string, unknown][];
  removed: string[];
  signedIn: string[];
} {
  const connected: [string, string][] = [];
  const added: unknown[] = [];
  const changed: [string, unknown][] = [];
  const removed: string[] = [];
  const signedIn: string[] = [];
  render(
    <I18nProvider>
      <DestinationsDialog
        url=""
        token=""
        destinations={[]}
        onConnect={(url, token) => connected.push([url, token])}
        onAdd={(draft) => added.push(draft)}
        onChange={(id, draft) => changed.push([id, draft])}
        onRemove={(id) => removed.push(id)}
        onSignIn={(name) => signedIn.push(name)}
        onClose={vi.fn()}
        {...over}
      />
    </I18nProvider>,
  );
  return { connected, added, changed, removed, signedIn };
}

const field = (key: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-field="${key}"]`)!;

/** The form is its own dialogue now, so every check about fields opens it first. */
function adding(over: Partial<DestinationsDialogProps> = {}): ReturnType<typeof show> {
  const rig = show(over);
  fireEvent.click(screen.getByTestId("destination-new"));
  return rig;
}

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

  // The list is the point of this panel: a row per destination, under its own mark, with what it
  // publishes to beside its name.
  it("lists what is there, with the kind and where it goes", () => {
    show({
      destinations: [
        {
          id: "dst_1",
          kind: "mastodon",
          name: "Mein Konto",
          holds: ["accessToken"],
          settings: { instance: "chaos.social" },
        },
      ],
    });

    const row = document.querySelector('[data-destination="dst_1"]');

    expect(row?.textContent).toContain("Mein Konto");
    expect(row?.textContent).toContain("Mastodon");
    expect(row?.textContent).toContain("chaos.social");
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

describe("setting one up", () => {
  // The whole reason the sign-in exists: three values from two pages of a console is what stopped
  // people from ever setting a channel up.
  it("offers a sign-in where the server can do one, and names it after what was typed", () => {
    const { signedIn } = adding({ canSignIn: true });

    fireEvent.change(screen.getByTestId("destination-name"), { target: { value: "Mein Kanal" } });
    fireEvent.click(screen.getByTestId("destination-signin"));

    expect(signedIn).toEqual(["Mein Kanal"]);
  });

  it("says what an operator has to do where the server holds no client", () => {
    adding({ canSignIn: false });

    expect(screen.queryByTestId("destination-signin")).toBeNull();
    expect(screen.getByTestId("destination-no-client").textContent).toContain(
      "VIDEOLA_YOUTUBE_CLIENT_ID",
    );
  });

  it("keeps the fields there for whoever has the values", () => {
    adding({ canSignIn: true });

    expect(field("clientId")).toBeTruthy();
  });

  it("does not offer a sign-in while one is already open", () => {
    adding({ canSignIn: true, signingIn: true });

    expect((screen.getByTestId("destination-signin") as HTMLButtonElement).disabled).toBe(true);
  });

  // The fields follow the kind, because what YouTube needs and what a Bluesky account needs have
  // one thing in common: neither works with the other's.
  it("asks for what the chosen kind cannot work without", () => {
    adding();

    expect(field("clientId")).toBeTruthy();
    expect(field("refreshToken")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Bluesky" }));

    expect(document.querySelector('[data-field="clientId"]')).toBeNull();
    expect(field("handle")).toBeTruthy();
    expect(field("appPassword")).toBeTruthy();
  });

  it("will not offer to save one that could not publish", () => {
    adding();

    const save = screen.getByTestId("destination-save") as HTMLButtonElement;
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
    const { added } = adding();

    fireEvent.change(screen.getByTestId("destination-name"), { target: { value: "Kanal" } });
    fireEvent.change(field("clientId"), { target: { value: "id" } });
    fireEvent.change(field("clientSecret"), { target: { value: "shh" } });
    fireEvent.change(field("refreshToken"), { target: { value: "r" } });
    fireEvent.change(field("privacyStatus"), { target: { value: "unlisted" } });
    fireEvent.click(screen.getByTestId("destination-save"));

    expect(added).toEqual([
      {
        kind: "youtube",
        name: "Kanal",
        secrets: { clientId: "id", clientSecret: "shh", refreshToken: "r" },
        settings: { privacyStatus: "unlisted" },
      },
    ]);
  });

  // The other half of the list: a destination that is already there can be renamed and re-pointed
  // without being deleted and made again.
  it("edits one that exists, without asking for the secrets again", () => {
    const { changed } = show({
      destinations: [
        {
          id: "dst_1",
          kind: "mastodon",
          name: "Mein Konto",
          holds: ["accessToken"],
          settings: { instance: "chaos.social" },
        },
      ],
    });

    fireEvent.click(document.querySelector('[data-edit="dst_1"]')!);
    const save = screen.getByTestId("destination-save") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect((screen.getByTestId("destination-name") as HTMLInputElement).value).toBe("Mein Konto");
    expect(field("instance").value).toBe("chaos.social");
    expect(field("accessToken").value).toBe("");

    fireEvent.change(screen.getByTestId("destination-name"), { target: { value: "Zweitkonto" } });
    fireEvent.click(save);

    expect(changed).toEqual([
      [
        "dst_1",
        {
          kind: "mastodon",
          name: "Zweitkonto",
          secrets: {},
          settings: { instance: "chaos.social" },
        },
      ],
    ]);
  });

  // Every place a video can go, with its own mark: a list of destinations is scanned rather than
  // read, and a row is recognised by its logo before its name.
  it("offers every kind the server can publish to", () => {
    adding();

    expect([...document.querySelectorAll("[data-kind]")].map((node) => node.getAttribute("data-kind"))).toEqual([
      "youtube",
      "vimeo",
      "peertube",
      "mastodon",
      "bluesky",
      "telegram",
      "facebook",
      "webhook",
    ]);
  });
});
