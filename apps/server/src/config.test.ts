import { describe, expect, it } from "vitest";

import { ConfigError, configFromEnv } from "./config";

describe("configFromEnv", () => {
  it("binds loopback without a token", () => {
    const config = configFromEnv({});

    expect(config.host).toBe("127.0.0.1");
    expect(config.token).toBeUndefined();
    expect(config.port).toBe(7331);
  });

  it("refuses a public bind without a token", () => {
    expect(() => configFromEnv({ VIDEOLA_HOST: "0.0.0.0" })).toThrow(ConfigError);
  });

  it("allows a public bind once a token is set", () => {
    const config = configFromEnv({ VIDEOLA_HOST: "0.0.0.0", VIDEOLA_TOKEN: "s3cret" });

    expect(config.host).toBe("0.0.0.0");
    expect(config.token).toBe("s3cret");
  });

  // An empty variable is how a shell hands over "unset"; treating it as a token would let a public
  // bind through guarded by a password of zero length.
  it("treats an empty token as no token", () => {
    expect(() => configFromEnv({ VIDEOLA_HOST: "10.0.0.5", VIDEOLA_TOKEN: "" })).toThrow(
      ConfigError,
    );
  });

  it("rejects a port that is not a positive integer", () => {
    expect(() => configFromEnv({ VIDEOLA_PORT: "0" })).toThrow(ConfigError);
    expect(() => configFromEnv({ VIDEOLA_PORT: "eighty" })).toThrow(ConfigError);
    expect(() => configFromEnv({ VIDEOLA_PORT: "8.5" })).toThrow(ConfigError);
  });

  it("takes the numeric limits from the environment", () => {
    const config = configFromEnv({
      VIDEOLA_PORT: "9000",
      VIDEOLA_MAX_PROJECTS: "2",
      VIDEOLA_MAX_BODY_BYTES: "1024",
      VIDEOLA_STORAGE_ROOT: "/srv/projects",
      VIDEOLA_LOCALE: "de",
    });

    expect(config).toMatchObject({
      port: 9000,
      maxProjects: 2,
      maxBodyBytes: 1024,
      storageRoot: "/srv/projects",
      locale: "de",
    });
  });
});
