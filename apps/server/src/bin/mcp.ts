import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Api } from "../api";
import { apiConfigFromEnv } from "../config";
import { createMcpServer } from "../mcp";

const config = apiConfigFromEnv();
const api = new Api(config);

// stdout carries the protocol, so anything the server wants to say goes to stderr.
process.stderr.write(`videola mcp, storage root ${config.storageRoot}\n`);

await createMcpServer(api).connect(new StdioServerTransport());
