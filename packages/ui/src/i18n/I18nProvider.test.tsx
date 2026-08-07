import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "./I18nProvider";
import { useI18n } from "./useI18n";

function Probe(): ReactElement {
  const { t, locale, setLocale, formatNumber } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="label">{t("action.save")}</span>
      <span data-testid="number">{formatNumber(1234.5)}</span>
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

  it("formats numbers per locale", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("number").textContent).toBe("1.234,5");
    act(() => screen.getByRole("button").click());
    expect(screen.getByTestId("number").textContent).toBe("1,234.5");
  });

  it("falls back to the default locale when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("de");
  });

  it("keeps an explicit locale in memory even when persisting it throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(() => act(() => screen.getByRole("button").click())).not.toThrow();
    expect(screen.getByTestId("locale").textContent).toBe("en");
  });
});
