import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { Connect, type ConnectWidget } from "./Connect";
import { widgetAttributes } from "./connectWidgets";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  for (const tag of document.querySelectorAll("script[data-gilde-widgets]")) tag.remove();
});

function show(widget: ConnectWidget = "contact", onClose = (): void => undefined): void {
  render(
    <I18nProvider>
      <Connect widget={widget} onClose={onClose} />
    </I18nProvider>,
  );
}

describe("the contact and support dialogue", () => {
  it("names this project rather than whichever one the markup was copied from", () => {
    show();

    expect(screen.getByTestId("connect-contact").getAttribute("project")).toBe("fgilde/videola");
  });

  // Two errands, two dialogues. A panel offering both at once makes each look like half of
  // something else, and the about dialogue is where they are chosen between.
  it("shows the one it was asked for and not the other", () => {
    show("support");

    expect(screen.getByTestId("connect-support")).toBeTruthy();
    expect(screen.queryByTestId("connect-contact")).toBeNull();
  });

  // Drawn in place, because the dialogue around it is already the dialogue a button would open.
  it("draws the widget in place", () => {
    show();

    expect(screen.getByTestId("connect-contact").hasAttribute("inline")).toBe(true);
  });

  it("is in the language the editor is being used in", () => {
    show();

    expect(screen.getByTestId("connect-contact").getAttribute("language")).toBe("de");
  });

  // The accent belongs to the theme. A colour written into this file is the copy that stays behind
  // when the theme changes.
  it("wears the accent the editor is wearing", () => {
    document.documentElement.style.setProperty("--v-accent", "#abcdef");
    show("support");

    expect(screen.getByTestId("connect-support").getAttribute("accent")).toBe("#abcdef");
    document.documentElement.style.removeProperty("--v-accent");
  });

  // The one thing in this editor that would reach another machine, and only when asked.
  it("fetches the widget script when it opens, once", () => {
    expect(document.querySelectorAll("script[data-gilde-widgets]").length).toBe(0);

    show();
    show();

    const tags = [...document.querySelectorAll<HTMLScriptElement>("script[data-gilde-widgets]")];
    expect(tags.length).toBe(1);
    expect(tags[0]?.type).toBe("module");
    expect(tags[0]?.src).toBe("https://connect.gilde.org/widgets/v1.js");
  });

  it("says so, where somebody would wonder", () => {
    show();

    expect(document.body.textContent).toContain("connect.gilde.org");
  });

  it("tells its host when it has closed, so the host can forget it", () => {
    const onClose = vi.fn();
    show("contact", onClose);

    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("what a widget is told", () => {
  const shared = { language: "en", accent: "#5b8cff", title: "Contact" } as const;

  // A widget drawn into a panel stands under a heading that says what it is; one behind a button
  // opens a dialogue with nothing else in it. Hence the same two switches, the other way round.
  it("leaves the description and the footer to the button variant", () => {
    const drawn = widgetAttributes({ ...shared, widget: "contact", inline: true });
    const behindAButton = widgetAttributes({ ...shared, widget: "contact", inline: false });

    expect([drawn["show-footer"], drawn["show-description"]]).toEqual(["false", "false"]);
    expect([behindAButton["show-footer"], behindAButton["show-description"]]).toEqual([
      "true",
      "true",
    ]);
    expect("inline" in drawn).toBe(true);
    expect("inline" in behindAButton).toBe(false);
  });

  it("gives the support widget the settings only it has", () => {
    const support = widgetAttributes({ ...shared, widget: "support", inline: true });
    const contact = widgetAttributes({ ...shared, widget: "contact", inline: true });

    expect(support["support-layout"]).toBe("rows");
    expect(support["show-support-qr"]).toBe("true");
    expect("support-layout" in contact).toBe(false);
  });
});
