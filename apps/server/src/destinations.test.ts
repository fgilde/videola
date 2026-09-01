import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { Destinations } from "./destinations";
import { Storage } from "./paths";

let root = "";
let destinations: Destinations;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "videola-destinations-"));
  destinations = new Destinations(new Storage(root));
});

describe("destinations", () => {
  it("keeps what it was given and hands out a name to publish to", async () => {
    const added = await destinations.add({
      kind: "youtube",
      name: "Mein Kanal",
      note: "wöchentlich",
      secrets: { clientId: "id", clientSecret: "shh", refreshToken: "r" },
      settings: { privacyStatus: "unlisted" },
    });

    expect(added.name).toBe("Mein Kanal");
    expect(added.settings.privacyStatus).toBe("unlisted");
    expect(await destinations.list()).toHaveLength(1);
  });

  // The rule this whole file exists to keep: a token that can be read back over the API is a token
  // that leaks through a screen share, a log or a browser history. That it exists is readable; what
  // it is, is not.
  it("never hands a secret back, only the fact that it holds one", async () => {
    await destinations.add({
      kind: "youtube",
      name: "Kanal",
      secrets: { clientId: "id", clientSecret: "shh", refreshToken: "r" },
    });

    const [listed] = await destinations.list();

    expect(listed?.holds).toEqual(["clientId", "clientSecret", "refreshToken"]);
    expect(JSON.stringify(listed)).not.toContain("shh");
    // And the publisher, which is the one thing that may see them, still can.
    const full = await destinations.find(listed!.id);
    expect(full?.secrets.clientSecret).toBe("shh");
  });

  // A destination that cannot publish is worse than no destination: it fails at the moment somebody
  // is waiting for a video to be online, rather than at the moment they set it up.
  it("refuses a destination that could not publish anything", async () => {
    await expect(
      destinations.add({ kind: "youtube", name: "Halb", secrets: { clientId: "id" } }),
    ).rejects.toThrow(/clientSecret, refreshToken/);
    await expect(destinations.add({ kind: "webhook", name: "", secrets: { url: "u" } })).rejects.toThrow(
      /needs a name/,
    );
    await expect(
      destinations.add({ kind: "sftp" as "webhook", name: "X", secrets: {} }),
    ).rejects.toThrow(/no such destination kind/);
  });

  it("survives a restart, because a channel set up once is set up", async () => {
    const added = await destinations.add({
      kind: "webhook",
      name: "Meine Seite",
      secrets: { url: "https://mine.example/upload" },
    });

    const reopened = new Destinations(new Storage(root));

    expect((await reopened.list()).map((entry) => entry.id)).toEqual([added.id]);
    expect((await reopened.find(added.id))?.secrets.url).toBe("https://mine.example/upload");
  });

  it("forgets one when it is removed, and says whether there was one", async () => {
    const added = await destinations.add({
      kind: "webhook",
      name: "Weg damit",
      secrets: { url: "u" },
    });

    expect(await destinations.remove(added.id)).toBe(true);
    expect(await destinations.remove(added.id)).toBe(false);
    expect(await destinations.list()).toEqual([]);
  });

  // The file is on somebody's disk and somebody will edit it. Losing the destinations is a loss;
  // taking the editor down with them would be a fault.
  it("starts empty rather than refusing to start when the file is nonsense", async () => {
    await writeFile(join(root, "destinations.json"), "{ this is not json", "utf8");

    expect(await destinations.list()).toEqual([]);
  });

  it("writes them where a backup would find them", async () => {
    await destinations.add({ kind: "webhook", name: "X", secrets: { url: "u" } });

    const raw = await readFile(join(root, "destinations.json"), "utf8");

    expect(JSON.parse(raw)).toHaveLength(1);
  });
});
