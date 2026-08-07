// localStorage throws in Safari private mode, in a sandboxed iframe, with site
// data blocked, or on quota exhaustion. None of that should take the app down;
// falling back to an in-memory-only preference is an acceptable degradation.
export function readStored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable - the choice just does not survive a reload
  }
}

export function clearStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable - nothing to clear
  }
}
