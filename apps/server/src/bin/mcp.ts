import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Api } from "../api";
import { configFromEnv } from "../config";
import { createMcpServer } from "../mcp";

const config = configFromEnv();
const api = new Api({
  storageRoot: config.storageRoot,
  maxProjects: config.maxProjects,
  locale: config.locale,
});

// stdout carries the protocol, so anything the server wants to say goes to stderr.
process.stderr.write(`videola mcp, storage root ${config.storageRoot}\n`);

await createMcpServer(api).connect(new StdioServerTransport());
