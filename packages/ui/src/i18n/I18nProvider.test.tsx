import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "./I18nProvider";
import { useI18n } from "./useI18n";
import type { ReactElement } from "react";

function Probe(): ReactElement {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="label">{t("action.save")}</span>
      <button onClick={() => setLocale(locale === "de" ? "en" : "de")}>toggle</button>
    </div>
  );
}

describe("I18nProvider", () => {
  beforeEach(() => localStorage.clear());

  it("starts in German by default", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("de");
    expect(screen.getByTestId("label").textContent).toBe("Speichern");
  });

  it("switches language without remounting and persists the choice", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => screen.getByRole("button").click());
    expect(screen.getByTestId("label").textContent).toBe("Save");
    expect(localStorage.getItem("videola.locale")).toBe("en");
  });

  it("restores a stored locale on mount", () => {
    localStorage.setItem("videola.locale", "en");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
  });

  it("sets the document language so screen readers pick it up", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe("de");
  });
});
