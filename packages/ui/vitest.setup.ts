import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Without vitest's `globals` option, @testing-library/react's own afterEach-based
// auto-cleanup never registers, so unmounted trees pile up across tests.
afterEach(cleanup);

// jsdom hard-codes navigator.language to "en-US"; the app defaults to German,
// so tests need a host locale that actually exercises that default.
Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
