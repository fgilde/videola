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
  createRequestListener({
    api,
    token: config.token,
    maxBodyBytes: config.maxBodyBytes,
    webRoot: config.webRoot,
  }),
);

// As PID 1 in a container a process gets no default disposition for SIGTERM, so without this
// `docker stop` waits out its ten seconds and then kills the process.
process.on("SIGTERM", () => {
  server.close();
  server.closeAllConnections();
});

server.listen(config.port, config.host, () => {
  const guard = config.token === undefined ? "no token" : "bearer token required";
  const app = config.webRoot === undefined ? "api only" : `app from ${config.webRoot}`;
  process.stdout.write(
    `videola on http://${config.host}:${config.port} (${guard}, ${app}), storage root ${config.storageRoot}\n`,
  );
});
