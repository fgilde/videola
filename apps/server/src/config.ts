export interface ApiConfig {
  readonly storageRoot: string;
  readonly maxProjects: number;
  readonly locale: string;
}

export interface Config extends ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string | undefined;
  readonly maxBodyBytes: number;
  readonly webRoot: string | undefined;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export class ConfigError extends Error {}

// What a host needs whether or not it listens on a socket. The MCP server speaks over stdio and
// takes only this: a bind address it never uses must not be able to stop it from starting.
export function apiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    storageRoot: env.VIDEOLA_STORAGE_ROOT ?? process.cwd(),
    maxProjects: integer(env.VIDEOLA_MAX_PROJECTS, 8, "VIDEOLA_MAX_PROJECTS"),
    locale: env.VIDEOLA_LOCALE ?? "en",
  };
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.VIDEOLA_HOST ?? "127.0.0.1";
  const token = env.VIDEOLA_TOKEN === "" ? undefined : env.VIDEOLA_TOKEN;

  // Refusing to bind rather than binding and hoping: an unauthenticated Videola on a LAN address
  // hands every reachable machine read and write access to the storage root.
  if (!LOOPBACK.has(host) && token === undefined) {
    throw new ConfigError(
      `refusing to bind ${host} without a token: set VIDEOLA_TOKEN, or leave VIDEOLA_HOST at 127.0.0.1`,
    );
  }

  return {
    ...apiConfigFromEnv(env),
    host,
    port: integer(env.VIDEOLA_PORT, 7331, "VIDEOLA_PORT"),
    token,
    maxBodyBytes: integer(env.VIDEOLA_MAX_BODY_BYTES, 512 * 1024 * 1024, "VIDEOLA_MAX_BODY_BYTES"),
    webRoot: env.VIDEOLA_WEB_ROOT === "" ? undefined : env.VIDEOLA_WEB_ROOT,
  };
}

function integer(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}
