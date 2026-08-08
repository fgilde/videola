# The image carries the editor, the HTTP interface and the MCP server. One Node
# process serves all three: nginx in front of Node would need a process
# supervisor for a job Node's own http server already does.

FROM rust:1-bookworm AS wasm
WORKDIR /src
RUN cargo install wasm-pack --locked
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN wasm-pack build crates/videola-core-wasm --target web \
      --out-dir ../../packages/core/src/wasm --out-name videola_core

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# apps/desktop and apps/docs are workspace members but stay out of the context:
# pnpm 11 accepts a lockfile listing an importer that is absent from disk, and
# neither the Tauri shell nor the documentation site contributes anything here.
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/server ./apps/server
COPY --from=wasm /src/packages/core/src/wasm ./packages/core/src/wasm
RUN pnpm install --frozen-lockfile
RUN pnpm --filter videola-web build && pnpm --filter videola-server build

FROM node:22-alpine
# esbuild bundles both entry points down to plain ESM with nothing left to
# resolve, so the runtime layer needs no node_modules -- only the .wasm, which
# is data and stays a file.
COPY --from=build /src/apps/server/dist/serve.mjs /src/apps/server/dist/mcp.mjs /app/
COPY --from=build /src/packages/core/src/wasm/videola_core_bg.wasm /app/
COPY --from=build /src/apps/web/dist /app/web

ENV NODE_ENV=production \
    VIDEOLA_HOST=0.0.0.0 \
    VIDEOLA_PORT=7331 \
    VIDEOLA_STORAGE_ROOT=/data \
    VIDEOLA_WEB_ROOT=/app/web \
    VIDEOLA_WASM=/app/videola_core_bg.wasm

# A published port only reaches a process bound to 0.0.0.0, and the server
# refuses that address without a token. The container therefore does not start
# until VIDEOLA_TOKEN is set, which is the intended answer: an unauthenticated
# Videola on a reachable address hands out its storage root.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 7331

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.VIDEOLA_PORT+'/api/health',{headers:{authorization:'Bearer '+(process.env.VIDEOLA_TOKEN||'')}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "/app/serve.mjs"]
