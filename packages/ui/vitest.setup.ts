import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Without vitest's `globals` option, @testing-library/react's own afterEach-based
// auto-cleanup never registers, so unmounted trees pile up across tests.
afterEach(cleanup);

// The shell tests assert German labels, which the app now only picks for a German browser.
// Pinning the host locale keeps them from depending on whatever jsdom hard-codes; the tests
// that cover the English fallback override this property themselves.
Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
