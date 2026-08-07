# This image serves the web app and nothing else. The API, MCP endpoint and
# render worker from spec section 11 need videola-server, which does not exist
# yet -- looking for them in here is wasted time.

FROM rust:1-bookworm AS wasm
WORKDIR /src
RUN cargo install wasm-pack --locked
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN wasm-pack build crates/videola-core-wasm --target web \
      --out-dir ../../packages/core/src/wasm --out-name videola_core

FROM node:22-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# apps/desktop is a workspace member but stays out of the context: pnpm 11
# accepts a lockfile listing an importer that is absent from disk, and the
# Tauri shell contributes nothing to the web bundle.
COPY packages ./packages
COPY apps/web ./apps/web
COPY --from=wasm /src/packages/core/src/wasm ./packages/core/src/wasm
RUN pnpm install --frozen-lockfile
RUN pnpm --filter videola-web build

FROM nginx:1-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /src/apps/web/dist /usr/share/nginx/html
EXPOSE 80
