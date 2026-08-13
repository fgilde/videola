import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { configFromEnv } from "./config";

/**
 * The three ways somebody installs this on their own machine, checked against the server they install.
 *
 * A Proxmox script, an Unraid template and an Umbrel app are four files of numbers and paths that have
 * to agree with what the server actually does — and nothing in a YAML file fails a build when it drifts.
 * The port, the storage root, the image name and the token are each written down in several places, and
 * every one of them is read here from the *code* rather than typed in again.
 *
 * These are targeted checks rather than a schema validation: nothing in this repository parses Unraid's
 * XML or Umbrel's manifest, and adding a parser for each would be two dependencies to keep a promise
 * neither platform makes about its own format. What can be checked without one is exactly what goes
 * wrong in practice — a port that moved, a volume that does not exist, a token nobody required.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const read = (path: string): string => readFileSync(join(root, path), "utf8");

const DOCKERFILE = read("docker/Dockerfile");
const COMPOSE = read("deploy/umbrel/videola/docker-compose.yml");
const MANIFEST = read("deploy/umbrel/videola/umbrel-app.yml");
const UNRAID = read("deploy/unraid/videola.xml");
const PVE = read("deploy/proxmox/videola.sh");
const INSTALL = read("deploy/proxmox/install.sh");
const TAURI = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as { version: string };

// The server's own default, from the server's own code. Every number below is compared against this
// rather than against 7331 written out a fifth time.
const DEFAULT_PORT = configFromEnv({}).port;
// The image's, which the Dockerfile states and the two Docker platforms have to match.
const IMAGE_STORAGE = /VIDEOLA_STORAGE_ROOT=(\S+)/.exec(DOCKERFILE)?.[1];

describe("what every deployment agrees on", () => {
  it("uses the port the server itself defaults to", () => {
    expect(DEFAULT_PORT).toBe(7331);
    for (const [name, text] of [
      ["the Dockerfile", DOCKERFILE],
      ["the Umbrel compose file", COMPOSE],
      ["the Umbrel manifest", MANIFEST],
      ["the Unraid template", UNRAID],
      ["the Proxmox script", PVE],
      ["the Proxmox installer", INSTALL],
    ] as const) {
      expect(text, name).toContain(String(DEFAULT_PORT));
    }
  });

  it("mounts the storage root the image actually writes to", () => {
    expect(IMAGE_STORAGE).toBe("/data");
    expect(COMPOSE).toContain(`:${IMAGE_STORAGE}`);
    expect(UNRAID).toContain(`Target="${IMAGE_STORAGE}"`);
  });

  // A published port reaches a process bound to 0.0.0.0, and the server refuses that address without a
  // token. Every platform that binds one therefore has to set it, or the container starts and stops.
  it("requires a token wherever the address is reachable", () => {
    expect(() => configFromEnv({ VIDEOLA_HOST: "0.0.0.0" })).toThrow(/token/);
    expect(configFromEnv({ VIDEOLA_HOST: "0.0.0.0", VIDEOLA_TOKEN: "x" }).host).toBe("0.0.0.0");

    expect(COMPOSE).toMatch(/VIDEOLA_TOKEN:/);
    expect(INSTALL).toMatch(/VIDEOLA_TOKEN=\$\(openssl rand -hex 24\)/);
    // Unraid has no way to generate one, so the template asks for it and says it is required rather
    // than offering it as an option somebody would skip.
    expect(UNRAID).toMatch(/Target="VIDEOLA_TOKEN"[\s\S]*?Required="true"/);
  });

  it("points at the image the release publishes", () => {
    const image = "ghcr.io/fgilde/videola";
    expect(read(".github/workflows/release.yml")).toContain(image);
    expect(UNRAID).toContain(`${image}:latest`);
    // Pinned rather than latest, because an app store installs a version and says which: Umbrel shows
    // the manifest's version to the user, and `latest` would make that number a guess.
    expect(COMPOSE).toContain(`${image}:${TAURI.version}`);
    expect(MANIFEST).toContain(`version: "${TAURI.version}"`);
  });

  it("names the web root and the wasm the bundle carries", () => {
    // The two paths a bundle install has to set and a Docker install already has: without them the
    // server serves no editor and cannot load its own core.
    expect(INSTALL).toMatch(/VIDEOLA_WEB_ROOT=.*\/web/);
    expect(INSTALL).toMatch(/VIDEOLA_WASM=.*videola_core_bg\.wasm/);
    const bundle = read("deploy/bundle.mjs");
    expect(bundle).toContain("videola_core_bg.wasm");
    expect(bundle).toContain('["apps/web/dist", "web"]');
  });

  // Both scripts stop at the first failure and treat an unset variable as one. A helper script that
  // carried on after a failed download would leave a container that looks installed.
  it("keeps both shell scripts strict", () => {
    for (const [name, text] of [
      ["the Proxmox script", PVE],
      ["the Proxmox installer", INSTALL],
    ] as const) {
      expect(text, name).toContain("set -euo pipefail");
      expect(text.startsWith("#!/usr/bin/env bash"), name).toBe(true);
    }
  });

  // Health through the API and with the token, so what is checked is that the core loaded and the
  // storage root answers -- not that a socket is open.
  it("checks health through the API rather than against the port", () => {
    expect(COMPOSE).toContain("/api/health");
    expect(COMPOSE).toMatch(/authorization/i);
    expect(INSTALL).toContain("/api/health");
    expect(INSTALL).toMatch(/Authorization: Bearer/);
  });

  // The unit is the only part of a bundle install that outlives the script, so what it forbids matters
  // more than what it starts. One writable path, and nothing else the machine offers.
  it("runs the service as a user that can write one directory", () => {
    expect(INSTALL).toContain("User=videola");
    expect(INSTALL).toContain("ProtectSystem=strict");
    expect(INSTALL).toContain("NoNewPrivileges=yes");
    expect(INSTALL).toMatch(/ReadWritePaths=\$\{DATA_DIR\}/);
  });
});
