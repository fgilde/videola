import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./ThemeProvider";
import { useTheme } from "./useTheme";

interface SystemThemeMock {
  setDark(dark: boolean): void;
}

function mockSystemPrefersDark(initialDark: boolean): SystemThemeMock {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query.includes("dark") ? dark : false;
      },
      media: query,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return {
    setDark(next) {
      dark = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function Probe(): ReactElement {
  const { theme, preference, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="preference">{preference}</span>
      <button onClick={() => setPreference("light")}>light</button>
      <button onClick={() => setPreference("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("follows the system preference when nothing is stored", () => {
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("preference").textContent).toBe("system");
  });

  it("mirrors a light system preference when nothing is stored", () => {
    mockSystemPrefersDark(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("stamps the resolved theme on the root element", () => {
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists an explicit choice and wins over the system", () => {
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole("button", { name: "light" }).click());
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(localStorage.getItem("videola.theme")).toBe("light");
  });

  it("restores a stored choice on mount", () => {
    localStorage.setItem("videola.theme", "light");
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("re-evaluates when the system theme changes while mounted", () => {
    const system = mockSystemPrefersDark(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
    act(() => system.setDark(true));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("returns to following the system and clears the stored choice", () => {
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole("button", { name: "light" }).click());
    expect(localStorage.getItem("videola.theme")).toBe("light");

    act(() => screen.getByRole("button", { name: "system" }).click());
    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(localStorage.getItem("videola.theme")).toBeNull();
  });

  it("falls back to the system theme when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("keeps an explicit choice in memory even when persisting it throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(() =>
      act(() => screen.getByRole("button", { name: "light" }).click()),
    ).not.toThrow();
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });
});
