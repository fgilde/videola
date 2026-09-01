import { readFile } from "node:fs/promises";

import { writeAtomic, type Storage } from "./paths";

/**
 * Where a finished video can be sent, and what it takes to send it there.
 *
 * The whole point of this file is that a video editor's last step is not "a file in the downloads
 * folder". Somebody who makes a video every week wants it on the channel, and doing that by hand --
 * export, open a browser, find the upload page, retype the title -- is the part they were paying
 * another tool for.
 *
 * Three kinds, and the third is the interesting one:
 *
 * * `youtube` uploads through the Data API, resumably, with the account's own refresh token.
 * * `vimeo` does the same through Vimeo's tus endpoint with a personal access token.
 * * `webhook` posts the file to any URL with headers of your choosing, which is what makes this
 *   useful to anybody whose platform is not one of the two above -- a CMS, an S3 signer, a Discord
 *   channel, a script on a NAS.
 *
 * Secrets go in and never come out. `list` returns what a destination *is*, never what it holds: a
 * refresh token that can be read back over the API is a refresh token that leaks through a screen
 * share, a log, or a browser history. Rotating one means writing it again, which is a click, and the
 * alternative is a class of accident this program refuses to make possible.
 */
export type DestinationKind = "youtube" | "vimeo" | "webhook";

export interface Destination {
  id: string;
  kind: DestinationKind;
  name: string;
  /** What the destination does with a video, in the words of whoever set it up. */
  note?: string;
  /** Per kind, and never returned: tokens, secrets, URLs that carry a key in them. */
  secrets: Readonly<Record<string, string>>;
  /** Per kind, safe to show: a channel name, a privacy setting, a category. */
  settings: Readonly<Record<string, string>>;
  created: string;
}

/** A destination as the API hands it out: everything except what would be dangerous to read back. */
export interface PublicDestination {
  id: string;
  kind: DestinationKind;
  name: string;
  note?: string;
  settings: Readonly<Record<string, string>>;
  created: string;
  /** Which secrets it holds, by name. What they are is not readable, that they exist is. */
  holds: readonly string[];
}

export interface NewDestination {
  kind: DestinationKind;
  name: string;
  note?: string;
  secrets?: Readonly<Record<string, string>>;
  settings?: Readonly<Record<string, string>>;
}

const FILE = "destinations.json";

/** What each kind cannot work without. Checked on the way in, so a broken one fails at set-up. */
const REQUIRED: Record<DestinationKind, readonly string[]> = {
  // The three halves of an installed-app OAuth client, exactly as Google's own flow produces them.
  // No browser dance here: this server has no place to put a redirect, and a token somebody pasted
  // once is the same token the flow would have written.
  youtube: ["clientId", "clientSecret", "refreshToken"],
  // Vimeo issues a long-lived token with an upload scope from the account page, which is one field.
  vimeo: ["accessToken"],
  // A URL is a secret here rather than a setting: signed upload URLs carry their key in the query,
  // and the ones that do not lose nothing by being write-only.
  webhook: ["url"],
};

export class Destinations {
  #storage: Storage;
  #cache: Destination[] | undefined;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  async list(): Promise<PublicDestination[]> {
    return (await this.#all()).map(publicly);
  }

  /** The whole record, secrets included. For the publisher, and for nothing that answers a request. */
  async find(id: string): Promise<Destination | undefined> {
    return (await this.#all()).find((entry) => entry.id === id);
  }

  async add(given: NewDestination): Promise<PublicDestination> {
    const kind = given.kind;
    if (REQUIRED[kind] === undefined) throw new Error(`no such destination kind: ${String(kind)}`);
    const name = given.name.trim();
    if (name === "") throw new Error("a destination needs a name");
    const secrets = given.secrets ?? {};
    const missing = REQUIRED[kind].filter((key) => (secrets[key] ?? "").trim() === "");
    if (missing.length > 0) {
      throw new Error(`a ${kind} destination needs ${missing.join(", ")}`);
    }

    const destination: Destination = {
      id: `dst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      kind,
      name,
      ...(given.note === undefined ? {} : { note: given.note }),
      secrets,
      settings: given.settings ?? {},
      created: new Date().toISOString(),
    };
    const all = [...(await this.#all()), destination];
    await this.#write(all);
    return publicly(destination);
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.#all();
    const left = all.filter((entry) => entry.id !== id);
    if (left.length === all.length) return false;
    await this.#write(left);
    return true;
  }

  async #all(): Promise<Destination[]> {
    if (this.#cache !== undefined) return this.#cache;
    const path = await this.#storage.forWriting(FILE);
    const raw = await readFile(path, "utf8").catch(() => "");
    // A file that has been edited into nonsense by hand loses the destinations rather than the
    // server: this is a list of places to send things, and refusing to start over one would take
    // the editor down with it.
    const parsed: unknown = raw === "" ? [] : safely(raw);
    this.#cache = Array.isArray(parsed) ? (parsed as Destination[]) : [];
    return this.#cache;
  }

  async #write(all: Destination[]): Promise<void> {
    this.#cache = all;
    const path = await this.#storage.forWriting(FILE);
    await writeAtomic(path, new TextEncoder().encode(JSON.stringify(all, null, 2)));
  }
}

function publicly(destination: Destination): PublicDestination {
  return {
    id: destination.id,
    kind: destination.kind,
    name: destination.name,
    ...(destination.note === undefined ? {} : { note: destination.note }),
    settings: destination.settings,
    created: destination.created,
    holds: Object.keys(destination.secrets).sort(),
  };
}

function safely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
