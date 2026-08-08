export interface GlCall {
  name: string;
  args: readonly unknown[];
}

export interface Recording {
  gl: WebGL2RenderingContext;
  calls: GlCall[];
  named(name: string): GlCall[];
}

// Test scaffolding: a recorder, not a simulator. It answers every query with a stable token and
// remembers every call, so a test can assert which calls a renderer makes and in which order. It
// draws nothing and validates nothing -- whether the driver accepts this sequence is only visible
// in the browser tests of Task 24. Anything asserted against this double is a claim about our
// code, never about WebGL.
export function recordingGl(overrides: Record<string, unknown> = {}): Recording {
  const calls: GlCall[] = [];
  const tokens = new Map<string, object>();
  const answers: Record<string, unknown> = {
    isContextLost: () => false,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    // A location that carries its own name keeps the recorded uniform calls readable.
    getUniformLocation: (_program: unknown, name: string) => name,
    getParameter: () => 4096,
    canvas: { width: 0, height: 0 },
    drawingBufferWidth: 640,
    drawingBufferHeight: 360,
  };
  const gl = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, key) {
      if (typeof key !== "string") return undefined;
      // Read through on every access rather than from a merged copy, so a test can hand in a
      // getter for a value that changes while the subject is running.
      if (key in overrides) return overrides[key];
      if (key in answers) return answers[key];
      if (/^[A-Z][A-Z0-9_]*$/.test(key)) return token(tokens, key);
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        // A fresh object per call, so two createTexture handles are as distinguishable here as
        // they are in a driver.
        return { token: `${key}()`, call: calls.length };
      };
    },
  });
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    calls,
    named: (name) => calls.filter((call) => call.name === name),
  };
}

function token(tokens: Map<string, object>, key: string): object {
  const existing = tokens.get(key);
  if (existing !== undefined) return existing;
  const fresh = { token: key };
  tokens.set(key, fresh);
  return fresh;
}
