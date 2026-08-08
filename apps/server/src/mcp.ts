import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { effectManifests } from "@videola/engine/src/effects/registry";

import { Api, APP_VERSION, DEFAULT_FRAME_WIDTH, DEFAULT_PEAK_BUCKETS } from "./api";
import { COMMAND_CATALOG } from "./generated/commandCatalog";

type Arguments = Record<string, unknown>;
type Handler = (args: Arguments) => Promise<unknown> | unknown;

interface Entry {
  readonly tool: Tool;
  readonly run: Handler;
}

// One tool per command, built from the generated catalogue rather than written out here. A command
// added to the Rust enum reaches an agent through this without anyone editing this file, which is
// the property the design document asks for — and the reason there is no hand-kept list to forget.
export function toolNameFor(command: string): string {
  return command.replace(".", "_");
}

export function createMcpServer(api: Api): Server {
  const entries = new Map<string, Entry>();
  for (const entry of [...commandEntries(api), ...extraEntries(api)]) {
    if (entries.has(entry.tool.name)) {
      throw new Error(`two tools claim the name ${entry.tool.name}`);
    }
    entries.set(entry.tool.name, entry);
  }

  const server = new Server(
    { name: "videola", version: APP_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Videola edits video projects through the same command catalogue its own editor uses. " +
        "Open or create a project first (project_create / project_open); every other tool takes " +
        "the returned `project` handle. Times are in flicks: 705600000 flicks are one second. " +
        "Read project_describe after a change instead of guessing what landed, project_getFrame " +
        "to see what a moment actually looks like, and project_save to write a .videola archive.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...entries.values()].map((entry) => entry.tool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const entry = entries.get(request.params.name);
    if (entry === undefined) return failure(`no such tool: ${request.params.name}`);
    try {
      return success(await entry.run(request.params.arguments ?? {}));
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  });

  return server;
}

function commandEntries(api: Api): Entry[] {
  return COMMAND_CATALOG.map(({ command, description, schema }) => ({
    tool: {
      name: toolNameFor(command),
      description: `${description} Dispatches the \`${command}\` command.`,
      inputSchema: commandInputSchema(schema),
    },
    run: (args) => {
      const { project, ifRevision, ...fields } = args;
      return api.apply(
        handle(project),
        [{ type: command, ...fields } as never],
        optionalRevision(ifRevision),
      );
    },
  }));
}

// The command's own schema with the discriminant taken out — the tool name already fixes it — plus
// the project handle every tool needs. Leaving `type` in would invite an agent to send a value that
// contradicts the tool it called.
function commandInputSchema(schema: Record<string, unknown>): Tool["inputSchema"] {
  const properties = { ...(schema["properties"] as Arguments) };
  delete properties["type"];
  const required = (schema["required"] as string[]).filter((name) => name !== "type");
  return {
    ...schema,
    type: "object",
    properties: {
      project: { type: "string", description: "Handle from project_create or project_open." },
      ifRevision: {
        type: "integer",
        description: "Refuse the change unless the project is still at this revision.",
      },
      ...properties,
    },
    required: ["project", ...required],
  } as Tool["inputSchema"];
}

function extraEntries(api: Api): Entry[] {
  return [
    {
      tool: {
        name: "project_create",
        description: "Create an empty project and return its handle.",
        inputSchema: object({}, []),
      },
      run: () => api.create(),
    },
    {
      tool: {
        name: "project_open",
        description: "Open a .videola file from the storage root and return its handle.",
        inputSchema: object(
          { path: { type: "string", description: "Path relative to the storage root." } },
          ["path"],
        ),
      },
      run: (args) => api.openPath(stringArg(args, "path")),
    },
    {
      tool: {
        name: "project_list",
        description: "List the projects this server currently holds open.",
        inputSchema: object({}, []),
      },
      run: () => api.list(),
    },
    {
      tool: {
        name: "project_get",
        description:
          "The full project model as JSON. Large; prefer project_describe unless you need a field.",
        inputSchema: object({ project: handleField() }, ["project"]),
      },
      run: (args) => api.state(handle(args["project"])),
    },
    {
      tool: {
        name: "project_describe",
        description:
          "A compact text summary: tracks, clips with their times, effects, library, markers.",
        inputSchema: object({ project: handleField() }, ["project"]),
      },
      run: (args) => api.describe(handle(args["project"])),
    },
    {
      tool: {
        name: "project_getFrame",
        description:
          "Render the project at up to eight instants and hand back the pictures as PNG. " +
          "project_describe says what is on the timeline; this says what it looks like. It goes " +
          "through the compositor the editor draws with, in a headless browser on the server — " +
          "where there is none, this fails and says so rather than returning an empty picture.",
        inputSchema: object(
          {
            project: handleField(),
            at: {
              type: "array",
              items: { type: "integer" },
              minItems: 1,
              maxItems: 8,
              description: "Instants in flicks. 705600000 flicks are one second.",
            },
            width: {
              type: "integer",
              description: `Picture width in pixels, default ${DEFAULT_FRAME_WIDTH}; the project's aspect ratio decides the height.`,
            },
          },
          ["project", "at"],
        ),
      },
      run: async (args) => {
        const pictures = await api.frames(
          handle(args["project"]),
          instantsArg(args["at"]),
          optionalInteger(args["width"]),
        );
        return media(
          pictures.map((png) => ({
            type: "image" as const,
            data: Buffer.from(png).toString("base64"),
            mimeType: "image/png",
          })),
        );
      },
    },
    {
      tool: {
        name: "project_getAudioPeaks",
        description:
          "The shape of the sound over a range: two extremes per bucket, from -1 to 1, of the " +
          "whole timeline mixed and levelled the way the export renders it. Use it to see that a " +
          "voice-over sits where it was put, that a gap is silent, or that nothing is clipping.",
        inputSchema: object(
          {
            project: handleField(),
            from: { type: "integer", description: "Start of the range in flicks." },
            to: { type: "integer", description: "End of the range in flicks." },
            buckets: {
              type: "integer",
              description: `How many values to reduce the range to, default ${DEFAULT_PEAK_BUCKETS}.`,
            },
          },
          ["project", "from", "to"],
        ),
      },
      run: (args) =>
        api.audioPeaks(
          handle(args["project"]),
          requiredInteger(args, "from"),
          requiredInteger(args, "to"),
          optionalInteger(args["buckets"], "buckets"),
        ),
    },
    {
      tool: {
        name: "project_validate",
        description:
          "Consistency findings the command layer cannot refuse on its own: overlapping clips, " +
          "clips referencing media the library does not declare, empty durations.",
        inputSchema: object({ project: handleField() }, ["project"]),
      },
      run: (args) => api.validate(handle(args["project"])),
    },
    {
      tool: {
        name: "project_save",
        description: "Write the project as a .videola archive into the storage root.",
        inputSchema: object(
          {
            project: handleField(),
            path: { type: "string", description: "Target path relative to the storage root." },
          },
          ["project", "path"],
        ),
      },
      run: (args) => api.savePath(handle(args["project"]), stringArg(args, "path")),
    },
    {
      tool: {
        name: "project_close",
        description: "Drop a project from the server. Unsaved changes are lost.",
        inputSchema: object({ project: handleField() }, ["project"]),
      },
      run: (args) => {
        api.close(handle(args["project"]));
        return { closed: true };
      },
    },
    {
      tool: {
        name: "media_importFile",
        description:
          "Read a media file from the storage root into the project's library and return its id. " +
          "The id is the SHA-256 of the file, so importing the same file twice is idempotent.",
        inputSchema: object(
          {
            project: handleField(),
            path: { type: "string", description: "Path relative to the storage root." },
            mime: { type: "string", description: "Override the type guessed from the extension." },
          },
          ["project", "path"],
        ),
      },
      run: async (args) => ({
        mediaId: await api.importPath(
          handle(args["project"]),
          stringArg(args, "path"),
          optionalString(args["mime"]),
        ),
      }),
    },
    {
      tool: {
        name: "history_undo",
        description: "Undo the last change.",
        inputSchema: object({ project: handleField() }, ["project"]),
      },
      run: (args) => api.undo(handle(args["project"])),
    },
    {
      tool: {
        name: "history_redo",
        description: "Redo the change undone last.",
        inputSchema: object({ project: handleField() }, ["project"]),
      },
      run: (args) => api.redo(handle(args["project"])),
    },
    {
      tool: {
        name: "effects_list",
        description:
          "The effects and transitions this build can render, with the parameters each takes. " +
          "`effect.add` and `effect.setParam` only accept what is listed here.",
        inputSchema: object({}, []),
      },
      // Shader sources are left out: an agent needs the parameter names and ranges to drive
      // `effect.setParam`, and the GLSL would be several kilobytes of noise per effect.
      run: () =>
        effectManifests().map(({ id, name, category, inputs, params }) => ({
          id,
          name,
          category,
          inputs,
          params,
        })),
    },
  ];
}

function object(properties: Arguments, required: string[]): Tool["inputSchema"] {
  return { type: "object", properties, required } as Tool["inputSchema"];
}

function handleField(): Arguments {
  return { type: "string", description: "Handle from project_create or project_open." };
}

function handle(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new Error("project must be a project handle string");
  }
  return value;
}

function stringArg(args: Arguments, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value === "") throw new Error(`${key} must be a string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalRevision(value: unknown): number | undefined {
  return optionalInteger(value, "ifRevision");
}

function optionalInteger(value: unknown, what = "width"): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${what} must be an integer`);
  }
  return value;
}

function requiredInteger(args: Arguments, key: string): number {
  const value = optionalInteger(args[key], key);
  if (value === undefined) throw new Error(`${key} is required`);
  return value;
}

function instantsArg(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error("at must be an array of times in flicks");
  return value.map((entry: unknown) => {
    if (typeof entry !== "number" || !Number.isInteger(entry)) {
      throw new Error("every time in `at` must be a whole number of flicks");
    }
    return entry;
  });
}

// A picture is not text, and stringifying one would hand an agent base64 to read rather than an
// image to look at. Everything else answers as JSON, so the exception is marked rather than
// guessed at from the shape of the value.
interface Media {
  readonly blocks: CallToolResult["content"];
}

function media(blocks: CallToolResult["content"]): Media {
  return { blocks };
}

function isMedia(value: unknown): value is Media {
  return typeof value === "object" && value !== null && Array.isArray((value as Media).blocks);
}

function success(payload: unknown): CallToolResult {
  if (isMedia(payload)) return { content: payload.blocks };
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text", text }] };
}

// A rejected command is information the agent has to act on, not a transport failure — an MCP error
// response would surface as "the tool broke" and hide the reason the core gave.
function failure(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
