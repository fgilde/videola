import { createServer } from "node:http";

import { Api } from "../api";
import { configFromEnv } from "../config";
import { createRequestListener } from "../http";

const config = configFromEnv();
const api = new Api({
  storageRoot: config.storageRoot,
  maxProjects: config.maxProjects,
  locale: config.locale,
});

const server = createServer(
  createRequestListener({ api, token: config.token, maxBodyBytes: config.maxBodyBytes }),
);

server.listen(config.port, config.host, () => {
  const guard = config.token === undefined ? "no token" : "bearer token required";
  process.stdout.write(
    `videola api on http://${config.host}:${config.port} (${guard}), storage root ${config.storageRoot}\n`,
  );
});
