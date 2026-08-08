import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import type { Command } from "@videola/core";

import { Api, ApiError, mimeFor } from "./api";
import { apiConfigFromEnv } from "./config";
import { COMMAND_CATALOG } from "./generated/commandCatalog";
import { writeAtomic } from "./paths";

export const USAGE = `videola — batch editing without a browser

  videola apply [--in <file>] [--media <file>]... [--commands <file>] --out <file>
  videola describe <file>
  videola validate <file>
  videola schema [<command>]

  --in        a .videola project to start from; without it the project is new
  --media     a media file to put in the library; repeatable, prints the id it got
  --commands  a JSON file holding one command object or an array of them
  --out       where to write the resulting .videola archive

Media ids are \`med_\` followed by the SHA-256 of the file, so a commands file can name a
medium the same run imports. Times are in flicks: 705600000 flicks are one second.

There is no export subcommand. Encoding video needs the browser's encoders, which a
command line process does not have; a .videola archive is the only thing this writes.
`;

// Paths here come from the caller's own shell, not from a request, so they are used as given —
// the storage root exists to fence in an interface that strangers reach, and there is no stranger
// on this side of a terminal.
export async function run(
  argv: readonly string[],
  write: (line: string) => void,
  // Kept apart from `write` so that `videola schema | jq` never sees a message meant for a person.
  warn: (line: string) => void,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        in: { type: "string" },
        out: { type: "string" },
        media: { type: "string", multiple: true },
        commands: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    return fail(warn, messageOf(error));
  }

  const { values, positionals } = parsed;
  const [subcommand, argument] = positionals;
  if (values.help === true || subcommand === undefined) {
    (values.help === true ? write : warn)(USAGE);
    return values.help === true ? 0 : 1;
  }

  try {
    switch (subcommand) {
      case "apply":
        return await apply(values, write, warn);
      case "describe":
        return await report(argument, write, warn, (api, id) => api.describe(id));
      case "validate":
        return await report(argument, write, warn, (api, id) =>
          JSON.stringify(api.validate(id), null, 2),
        );
      case "schema":
        return schema(argument, write, warn);
      default:
        return fail(warn, `no such subcommand: ${subcommand}`);
    }
  } catch (error) {
    return fail(warn, messageOf(error));
  }
}

async function apply(
  values: { in?: string; out?: string; media?: string[]; commands?: string },
  write: (line: string) => void,
  warn: (line: string) => void,
): Promise<number> {
  if (values.out === undefined) {
    return fail(warn, "apply needs --out: a project nobody writes is lost when the process ends");
  }

  const api = new Api(apiConfigFromEnv());
  const { id } = values.in === undefined ? await api.create() : await api.openArchive(await readFile(values.in));

  for (const path of values.media ?? []) {
    const bytes = await readFile(path);
    write(`${api.importBytes(id, basename(path), mimeFor(path), bytes)}  ${path}\n`);
  }

  const commands = values.commands === undefined ? [] : await readCommands(values.commands);
  if (commands.length > 0) {
    const { view } = api.apply(id, commands);
    write(`applied ${commands.length} command(s), revision ${view.revision}\n`);
  }

  await writeAtomic(resolve(values.out), api.archive(id));
  write(`wrote ${values.out}\n`);
  return 0;
}

async function report(
  path: string | undefined,
  write: (line: string) => void,
  warn: (line: string) => void,
  produce: (api: Api, id: string) => string,
): Promise<number> {
  if (path === undefined) return fail(warn, "expected a path to a .videola file");
  const api = new Api(apiConfigFromEnv());
  const { id } = await api.openArchive(await readFile(path));
  write(`${produce(api, id)}\n`);
  return 0;
}

function schema(
  command: string | undefined,
  write: (line: string) => void,
  warn: (line: string) => void,
): number {
  if (command === undefined) {
    for (const entry of COMMAND_CATALOG) write(`${entry.command}\t${entry.description.split("\n")[0]}\n`);
    return 0;
  }
  const entry = COMMAND_CATALOG.find((candidate) => candidate.command === command);
  if (entry === undefined) return fail(warn, `no such command: ${command}`);
  write(`${JSON.stringify(entry.schema, null, 2)}\n`);
  return 0;
}

// A file holding a single command is the common case for a one-off change, and an array is the
// batch. Both land as one atomic batch, because `Api.apply` knows no other way.
async function readCommands(path: string): Promise<readonly Command[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const commands = Array.isArray(parsed) ? parsed : [parsed];
  if (commands.some((entry) => typeof entry !== "object" || entry === null)) {
    throw new Error(`${path} must hold a command object or an array of them`);
  }
  return commands as readonly Command[];
}

function fail(write: (line: string) => void, message: string): number {
  write(`videola: ${message}\n`);
  return 1;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
