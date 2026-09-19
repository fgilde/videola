export interface ApiConfig {
  readonly storageRoot: string;
  readonly maxProjects: number;
  readonly locale: string;
  /**
   * The OAuth client a YouTube sign-in runs through, where the operator registered one.
   *
   * Not shipped and not optional-by-halves: an OAuth client secret in a public repository is a
   * published secret, and one bucket of quota for every installation in the world. Registered once
   * per server, and every destination after that is a button rather than three pasted values.
   */
  readonly youtubeClient: { clientId: string; clientSecret: string } | undefined;
  /**
   * The key transcription runs through, where the operator set one.
   *
   * Here and not in the browser for the same reason the OAuth client is here: a key handed to a
   * page is a key handed to everybody who opens it. Without one the editor offers the other three
   * ways to lyrics and says why the fourth is missing.
   */
  readonly elevenLabsKey: string | undefined;
  /**
   * A transcriber that runs on this machine, where the operator installed one.
   *
   * The other way to the words of a song, and the one that sends nothing anywhere: a command that
   * takes an audio file and writes a JSON transcript beside it. Whisper is what everybody runs,
   * through whisper.cpp or faster-whisper, and neither of them is Videola's business to ship --
   * so the contract is a command line, not a dependency.
   */
  readonly whisper: { command: string; model: string | undefined } | undefined;
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
    youtubeClient: oauthClient(
      env.VIDEOLA_YOUTUBE_CLIENT_ID,
      env.VIDEOLA_YOUTUBE_CLIENT_SECRET,
    ),
    elevenLabsKey: env.VIDEOLA_ELEVENLABS_KEY === "" ? undefined : env.VIDEOLA_ELEVENLABS_KEY,
    whisper: localTranscriber(env.VIDEOLA_WHISPER, env.VIDEOLA_WHISPER_MODEL),
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

// The model is optional: a wrapper script that knows which model it loads needs no second setting,
// and whisper.cpp needs one. The command is what decides whether there is a local transcriber.
function localTranscriber(
  command: string | undefined,
  model: string | undefined,
): { command: string; model: string | undefined } | undefined {
  if (command === undefined || command.trim() === "") return undefined;
  return { command: command.trim(), model: model === "" ? undefined : model };
}

// Both or neither. Half a client is a sign-in that gets as far as Google's page and fails on the
// way back, which is the worst moment to find out.
function oauthClient(
  id: string | undefined,
  secret: string | undefined,
): { clientId: string; clientSecret: string } | undefined {
  if (id === undefined || id === "" || secret === undefined || secret === "") return undefined;
  return { clientId: id, clientSecret: secret };
}

function integer(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got ${raw}`);
  }
  return value;
}
