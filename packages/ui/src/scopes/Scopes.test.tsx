import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/I18nProvider";
import { Scopes, type ScopeReadingLike, type VectorTarget } from "./Scopes";

const TARGETS: readonly VectorTarget[] = [
  { name: "R", x: 0.42, y: 0.13 },
  { name: "B", x: 0.87, y: 0.54 },
];

function reading(over: Partial<ScopeReadingLike> = {}): ScopeReadingLike {
  return {
    histogram: {
      red: new Uint32Array(256),
      green: new Uint32Array(256),
      blue: new Uint32Array(256),
      luma: new Uint32Array(256),
    },
    waveform: new Uint32Array(4 * 256),
    columns: 4,
    vectorscope: new Uint32Array(16 * 16),
    measured: 0,
    range: undefined,
    ...over,
  };
}

function lit(): ScopeReadingLike {
  const shot = reading({ measured: 64, range: [40, 210] });
  (shot.histogram.red as Uint32Array)[40] = 32;
  (shot.histogram.luma as Uint32Array)[210] = 32;
  (shot.waveform as Uint32Array)[2 * 256 + 210] = 32;
  (shot.vectorscope as Uint32Array)[5 * 16 + 6] = 64;
  return shot;
}

function show(shot: ScopeReadingLike | undefined): void {
  render(
    <I18nProvider>
      <Scopes reading={shot} targets={TARGETS} />
    </I18nProvider>,
  );
}

describe("the scopes panel", () => {
  it("shows all three instruments", () => {
    show(lit());

    for (const name of ["Wellenform", "Vektorskop", "Histogramm"]) {
      expect(screen.getByRole("img", { name })).toBeTruthy();
    }
  });

  // The number a colourist reads off a waveform first, in words -- so the panel says something to
  // a person who is not going to squint at three grey pictures.
  it("says in words how far the picture reaches", () => {
    show(lit());

    expect(screen.getByRole("status").textContent).toBe("Helligkeit 40 bis 210 von 255");
  });

  // Scope and empty picture, crossed on the surface. Nothing measured is a state and not a fault,
  // and the three canvases have to say so rather than standing there as black boxes that could
  // equally mean a broken renderer.
  it("says so when there is nothing to measure", () => {
    show(reading());

    expect(screen.getByRole("status").textContent).toBe("Nichts zu messen");
    expect(screen.getByRole("img", { name: "Wellenform: nichts gemessen" })).toBeTruthy();
  });

  it("says the same before any measurement has arrived at all", () => {
    show(undefined);

    expect(screen.getByRole("status").textContent).toBe("Nichts zu messen");
  });

  // jsdom gives a canvas no 2D context, so every drawing call is a no-op that must not throw --
  // and the same is true of a real browser with the panel laid out to zero height.
  it("draws nothing rather than throwing when the canvases have no surface", () => {
    expect(() => show(lit())).not.toThrow();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });
});
