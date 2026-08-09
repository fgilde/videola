import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { cmd, on, secondsToTime } from "@videola/core";
import { NTSC_FIXTURE, tinyMp4 } from "@videola/engine/src/decode/fixture-mp4";
import { beforeEach, describe, expect, it } from "vitest";

import { Api } from "./api";
import { COMMAND_CATALOG } from "./generated/commandCatalog";
import { createMcpServer, toolNameFor } from "./mcp";

let root = "";
let api: Api;
let client: Client;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "videola-mcp-"));
  api = new Api({ storageRoot: root, maxProjects: 64 });
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([createMcpServer(api).connect(serverEnd), client.connect(clientEnd)]);
});

async function tools(): Promise<Tool[]> {
  return (await client.listTools()).tools;
}

interface Call {
  isError: boolean;
  text: string;
}

// Arguments go through JSON on the way in, because the transport an agent actually uses does. The
// in-memory pair hands objects over by reference, which would let a payload pass here that the
// stdio transport could not even serialise.
async function call(name: string, args: Record<string, unknown> = {}): Promise<Call> {
  const result = await client.callTool({
    name,
    arguments: JSON.parse(JSON.stringify(args)) as Record<string, unknown>,
  });
  const first = (result.content as { type: string; text?: string }[])[0];
  return { isError: result.isError === true, text: first?.text ?? "" };
}

function parse(text: string): any {
  return JSON.parse(text);
}

function referencesIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(referencesIn);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    key === "$ref" && typeof nested === "string"
      ? [nested.replace("#/$defs/", "")]
      : referencesIn(nested),
  );
}

// Two real, probeable files that differ: the import describes what it reads, so bytes no
// demuxer can read never reach the library.
const MEDIA_BYTES = Buffer.from(await tinyMp4().arrayBuffer());
const MEDIA_ID = `med_${createHash("sha256").update(MEDIA_BYTES).digest("hex")}`;
const OTHER_BYTES = Buffer.from(
  await tinyMp4({ ...NTSC_FIXTURE, sampleCount: 20 }).arrayBuffer(),
);
const OTHER_MEDIA_ID = `med_${createHash("sha256").update(OTHER_BYTES).digest("hex")}`;

interface Fixture {
  project: string;
  track: string;
  otherTrack: string;
  clip: string;
  neighbour: string;
  clipJson: Record<string, unknown>;
  marker: string;
  media: string;
}

// One project carrying everything the commands need to address: two tracks so a reorder has
// somewhere to go, two clips butted together so a roll has a cut and a slide has a neighbour, a
// group to dissolve, a marker to rename, an effect with a keyframe on it. Built with the same
// commands under test, so the fixture cannot describe a project the core would not accept.
async function fixture(): Promise<Fixture> {
  const { id } = await api.create();
  api.apply(id, [
    cmd.trackAdd("video", "V1"),
    cmd.trackAdd("audio", "A1"),
    cmd.mediaImport({
      id: MEDIA_ID,
      originalName: "clip.mp4",
      mime: "video/mp4",
      kind: "video",
      sizeBytes: BigInt(MEDIA_BYTES.byteLength),
    }),
  ]);
  const tracks = api.state(id).timeline.tracks;
  const track = tracks[0]?.id ?? "";
  api.apply(id, [
    cmd.clipAdd(track, { kind: "media", media: MEDIA_ID }, 0, secondsToTime(2)),
    cmd.clipAdd(track, { kind: "media", media: MEDIA_ID }, secondsToTime(2), secondsToTime(2)),
  ]);
  const placed = api.state(id).timeline.tracks[0]?.clips ?? [];
  const clip = placed[0]?.id ?? "";
  const neighbour = placed[1]?.id ?? "";
  api.apply(id, [
    cmd.effectAdd(on.clip(clip), "brightness"),
    cmd.keyframeAdd(on.clip(clip), "brightness", "amount", 0, { kind: "float", value: 1 }),
    cmd.clipGroup([clip, neighbour]),
    cmd.markerAdd(secondsToTime(1), "chapter"),
  ]);
  const state = api.state(id);
  return {
    project: id,
    track,
    otherTrack: tracks[1]?.id ?? "",
    clip,
    neighbour,
    // The payload for `clip.paste` is a whole clip, and the honest source for one is a clip the
    // core itself produced.
    clipJson: JSON.parse(
      JSON.stringify(state.timeline.tracks[0]?.clips[0] ?? {}),
    ) as Record<string, unknown>,
    marker: state.markers[0]?.id ?? "",
    media: MEDIA_ID,
  };
}

// A payload per command, written against the fixture. `effect.add` and `media.import` deliberately
// name something the fixture does not already carry: both are no-ops for a duplicate, and a no-op
// would leave an empty patch and make the check below pass without the tool doing anything.
const PAYLOADS: Record<string, (f: Fixture) => Record<string, unknown>> = {
  "project.setSettings": () => ({
    settings: {
      width: 1280,
      height: 720,
      fps: { numerator: 25, denominator: 1 },
      sampleRate: 48000,
      colorSpace: "srgb",
      background: "#000000",
    },
  }),
  "project.setTitle": () => ({ title: "Reel" }),
  "project.setMasterVolume": () => ({ volume: 0.6 }),
  "track.add": () => ({ kind: "text", name: "T1" }),
  "track.remove": (f) => ({ track: f.otherTrack }),
  "track.reorder": (f) => ({ track: f.track, toIndex: 1 }),
  "track.rename": (f) => ({ track: f.track, name: "Renamed" }),
  "track.setVolume": (f) => ({ track: f.track, volume: 0.5 }),
  "track.setPan": (f) => ({ track: f.track, pan: -0.25 }),
  "track.setFlags": (f) => ({ track: f.track, muted: true }),
  "clip.add": (f) => ({
    track: f.otherTrack,
    source: { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
    start: secondsToTime(5),
    duration: secondsToTime(1),
  }),
  "clip.insert": (f) => ({
    track: f.otherTrack,
    source: { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
    start: secondsToTime(1),
    duration: secondsToTime(1),
    inPoint: secondsToTime(0.5),
  }),
  "clip.overwrite": (f) => ({
    track: f.otherTrack,
    source: { kind: "generator", generator: { type: "solid", color: "#ff0000" } },
    start: secondsToTime(1),
    duration: secondsToTime(1),
    inPoint: secondsToTime(0.5),
  }),
  "clip.remove": (f) => ({ clip: f.clip }),
  "clip.move": (f) => ({ clip: f.clip, toTrack: f.otherTrack, start: secondsToTime(4) }),
  "clip.trim": (f) => ({ clip: f.clip, edge: "end", delta: -secondsToTime(0.5) }),
  "clip.split": (f) => ({ clip: f.clip, at: secondsToTime(1) }),
  "clip.setSpeed": (f) => ({ clip: f.clip, rate: 2, reverse: true, preservePitch: false }),
  "clip.setVolume": (f) => ({ clip: f.clip, volume: 0.25 }),
  "clip.setTransform": (f) => ({
    clip: f.clip,
    transform: {
      x: 10,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      opacity: 0.5,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
    },
  }),
  "clip.setTransition": (f) => ({
    clip: f.clip,
    transition: {
      transitionType: "crossfade",
      duration: secondsToTime(0.5),
      alignment: "center",
      params: {},
    },
  }),
  // Pointed at the project rather than at a clip, so the address itself is exercised: a target
  // the handler ignored would put this on a clip and the assertion on `master` would fail.
  "effect.add": () => ({ target: { kind: "project" }, effectType: "limiter" }),
  "effect.setParam": (f) => ({
    target: { kind: "clip", clip: f.clip },
    effectType: "brightness",
    key: "amount",
    value: { kind: "float", value: 1.5 },
  }),
  "keyframe.add": (f) => ({
    target: { kind: "clip", clip: f.clip },
    effectType: "brightness",
    key: "amount",
    time: secondsToTime(1),
    value: { kind: "float", value: 0.2 },
    interp: "linear",
  }),
  "keyframe.remove": (f) => ({
    target: { kind: "clip", clip: f.clip },
    effectType: "brightness",
    key: "amount",
    time: 0,
  }),
  "keyframe.move": (f) => ({
    target: { kind: "clip", clip: f.clip },
    effectType: "brightness",
    key: "amount",
    from: 0,
    to: secondsToTime(0.5),
  }),
  "keyframe.setInterp": (f) => ({
    target: { kind: "clip", clip: f.clip },
    effectType: "brightness",
    key: "amount",
    time: 0,
    interp: "hold",
  }),
  // A plain number, not a BigInt: this is what `JSON.parse` produces for `sizeBytes` on the wire,
  // whatever the generated TypeScript type says about a Rust `u64`.
  "media.import": () => ({
    asset: {
      id: OTHER_MEDIA_ID,
      originalName: "second.mp4",
      mime: "video/mp4",
      kind: "video",
      sizeBytes: OTHER_BYTES.byteLength,
    },
  }),
  "media.remove": (f) => ({ media: f.media }),
  "clip.rippleDelete": (f) => ({ clip: f.clip }),
  "clip.rippleTrim": (f) => ({ clip: f.clip, edge: "end", delta: -secondsToTime(0.5) }),
  // Rightwards: rolling this cut the other way would ask the second clip for material in front of
  // its in point, which it does not have.
  "clip.roll": (f) => ({ clip: f.clip, edge: "end", delta: secondsToTime(0.5) }),
  "clip.slip": (f) => ({ clip: f.clip, delta: secondsToTime(0.5) }),
  "clip.slide": (f) => ({ clip: f.neighbour, delta: secondsToTime(0.5) }),
  "clip.paste": (f) => ({ track: f.track, clip: f.clipJson, start: secondsToTime(8) }),
  "clip.group": (f) => ({ clips: [f.clip, f.neighbour] }),
  "clip.ungroup": (f) => ({ clip: f.clip }),
  "clip.nest": (f) => ({ clips: [f.clip, f.neighbour] }),
  "marker.add": () => ({ time: secondsToTime(3), label: "chapter two" }),
  "marker.remove": (f) => ({ marker: f.marker }),
  "marker.rename": (f) => ({ marker: f.marker, label: "renamed" }),
  "marker.setColor": (f) => ({ marker: f.marker, colorHex: "#2EA043" }),
  "marker.setNote": (f) => ({ marker: f.marker, note: "the take we kept" }),
};

describe("the tool catalogue", () => {
  it("offers one tool per command the core knows, plus the extras, with no name used twice", async () => {
    const offered = (await tools()).map((tool) => tool.name);

    for (const { command } of COMMAND_CATALOG) {
      expect(offered).toContain(toolNameFor(command));
    }
    expect(offered).toHaveLength(new Set(offered).size);
    expect(offered.length).toBeGreaterThan(COMMAND_CATALOG.length);
  });

  it("describes every tool it offers", async () => {
    for (const tool of await tools()) {
      expect(tool.description ?? "").not.toBe("");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  // A schema is only usable if it carries the definitions it points at. The generator prunes `$defs`
  // to what each command reaches, and pruning one reference too many leaves a tool describing itself
  // with a dangling pointer — which an agent cannot recover from and no property check would notice.
  it("carries every definition its schemas refer to", async () => {
    for (const tool of await tools()) {
      const defs = Object.keys((tool.inputSchema["$defs"] as Record<string, unknown>) ?? {});
      for (const reference of referencesIn(tool.inputSchema)) {
        expect(defs, `${tool.name} refers to ${reference}`).toContain(reference);
      }
    }
  });

  it("does not carry definitions no schema refers to", async () => {
    for (const tool of await tools()) {
      const defs = Object.keys((tool.inputSchema["$defs"] as Record<string, unknown>) ?? {});
      const used = new Set(referencesIn(tool.inputSchema));
      expect(defs.filter((name) => !used.has(name))).toEqual([]);
    }
  });

  // The discriminant is fixed by the tool name; offering it as an input would invite an agent to
  // send a value contradicting the tool it called.
  it("takes the project handle instead of the command's own type field", async () => {
    for (const { command } of COMMAND_CATALOG) {
      const tool = (await tools()).find((entry) => entry.name === toolNameFor(command));
      const properties = tool?.inputSchema.properties as Record<string, unknown>;
      expect(Object.keys(properties)).toContain("project");
      expect(Object.keys(properties)).not.toContain("type");
      expect(tool?.inputSchema.required).toContain("project");
      expect(tool?.inputSchema.required).not.toContain("type");
    }
  });
});

// The check that a name-only completeness test cannot make: every command tool is called with a
// real payload, against the real Rust core, and has to come back with the core's own label and a
// patch that is not empty. A tool wired to nothing produces an empty patch and fails here.
describe("every command tool reaches the core", () => {
  it.each(COMMAND_CATALOG.map((entry) => entry.command))("%s changes the project", async (command) => {
    const f = await fixture();
    const build = PAYLOADS[command];
    expect(build, `no payload written for ${command}`).toBeDefined();
    const payload = build?.(f) ?? {};

    const tool = (await tools()).find((entry) => entry.name === toolNameFor(command));
    const declared = Object.keys(tool?.inputSchema.properties as Record<string, unknown>);
    expect(Object.keys(payload).every((key) => declared.includes(key))).toBe(true);
    for (const required of (tool?.inputSchema.required as string[]).filter((k) => k !== "project")) {
      expect(Object.keys(payload)).toContain(required);
    }

    const result = await call(toolNameFor(command), { project: f.project, ...payload });

    expect(result.isError, result.text).toBe(false);
    const body = parse(result.text);
    expect(body.results[0].label).toBe(`cmd.${command}`);
    expect(body.results[0].patch.length).toBeGreaterThan(0);
    expect(body.view.revision).toBeGreaterThan(0);
  });
});

describe("the project tools", () => {
  it("creates, describes, validates, saves, reopens and closes", async () => {
    const created = parse((await call("project_create")).text);
    await call("track_add", { project: created.id, kind: "video", name: "V1" });

    expect((await call("project_describe", { project: created.id })).text).toContain('video "V1"');
    expect(parse((await call("project_validate", { project: created.id })).text)).toEqual([]);

    await call("project_save", { project: created.id, path: "reel.videola" });
    await call("project_close", { project: created.id });
    expect(parse((await call("project_list")).text)).toEqual([]);

    const reopened = parse((await call("project_open", { path: "reel.videola" })).text);
    const model = parse((await call("project_get", { project: reopened.id })).text);
    expect(model.timeline.tracks).toHaveLength(1);
  });

  it("imports a media file from the storage root", async () => {
    await writeFile(join(root, "clip.mp4"), MEDIA_BYTES);
    const created = parse((await call("project_create")).text);

    const imported = parse((await call("media_importFile", { project: created.id, path: "clip.mp4" })).text);

    expect(imported.mediaId).toBe(MEDIA_ID);
  });

  it("refuses a media file outside the storage root", async () => {
    const created = parse((await call("project_create")).text);

    const denied = await call("media_importFile", { project: created.id, path: "../escape.mp4" });

    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("storage root");
  });

  it("undoes and redoes", async () => {
    const created = parse((await call("project_create")).text);
    await call("track_add", { project: created.id, kind: "video", name: "V1" });

    await call("history_undo", { project: created.id });
    expect(parse((await call("project_get", { project: created.id })).text).timeline.tracks).toEqual([]);

    await call("history_redo", { project: created.id });
    expect(parse((await call("project_get", { project: created.id })).text).timeline.tracks).toHaveLength(1);
  });

  // An agent has no other way to learn which effect types `effect.add` will accept.
  it("lists the effects this build can render, with their parameters and without their shaders", async () => {
    const listed = parse((await call("effects_list")).text);

    // Named rather than counted: the point of this tool is that adding an effect to the registry makes
    // it an agent's capability with nobody editing the server, so a count goes stale on every effect
    // while a name that vanished is a capability an agent was promised and lost.
    const ids = listed.map((effect: { id: string }) => effect.id);
    expect(ids).toContain("brightness");
    expect(ids).toContain("chromaKey");
    expect(ids).toContain("wipe");
    expect(new Set(ids).size).toBe(ids.length);

    const byId = (id: string): { inputs: number; params: { key: string }[] } =>
      listed.find((effect: { id: string }) => effect.id === id);
    expect(byId("brightness").params.map((param) => param.key)).toEqual(["amount"]);
    expect(byId("chromaKey").params.map((param) => param.key)).toEqual([
      "hue",
      "tolerance",
      "softness",
    ]);
    // A transition takes the picture underneath as its second input, and an agent has to be able to
    // tell the two kinds apart before handing one to `effect.add`.
    expect(byId("wipe").inputs).toBe(2);
    expect(byId("brightness").inputs).toBe(1);

    expect(JSON.stringify(listed)).not.toContain("gl_FragColor");
    expect(JSON.stringify(listed)).not.toContain("precision highp");
  });
});

describe("failures an agent has to read", () => {
  it("reports a rejected command as tool output, not as a broken tool", async () => {
    const created = parse((await call("project_create")).text);

    const rejected = await call("track_rename", {
      project: created.id,
      track: "trk_nope",
      name: "x",
    });

    expect(rejected.isError).toBe(true);
    expect(rejected.text).toContain("trk_nope");
  });

  it("reports a time that is not a whole number of flicks instead of rounding it", async () => {
    const created = parse((await call("project_create")).text);

    const refused = await call("project_getFrame", { project: created.id, at: [0.5] });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("flicks");
  });

  it("refuses more instants than it renders rather than rendering some of them", async () => {
    const created = parse((await call("project_create")).text);

    const refused = await call("project_getFrame", {
      project: created.id,
      at: Array.from({ length: 9 }, () => 0),
    });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("8");
  });

  it("reports an unknown tool by name", async () => {
    const missing = await call("clip_teleport", {});

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("clip_teleport");
  });

  it("reports a missing project handle", async () => {
    const missing = await call("project_describe", {});

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("project handle");
  });

  it("passes ifRevision through to the same guard the HTTP route uses", async () => {
    const created = parse((await call("project_create")).text);
    await call("track_add", { project: created.id, kind: "video", name: "V1" });

    const stale = await call("project_setTitle", {
      project: created.id,
      title: "Reel",
      ifRevision: 0,
    });

    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("revision 1");
  });
});
