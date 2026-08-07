// jsdom hard-codes navigator.language to "en-US"; the app defaults to German,
// so tests need a host locale that actually exercises that default.
Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
