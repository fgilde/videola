# Getting started

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Rust | stable, as pinned by `rust-toolchain.toml` | the core, the WASM build, the Tauri shell |
| `wasm-pack` | any recent release | compiling the core to WASM |
| Node.js | 22 or newer | the web app and the docs site |
| pnpm | 11 or newer | the workspace; the root `package.json` pins `pnpm@11.20.0` |

The Tauri shell additionally needs a platform WebView and toolchain. On Linux that means
`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev` and `patchelf`; Windows and macOS
use the WebView shipped with the system.

## Install

```sh
pnpm install
pnpm wasm
```

## Why `pnpm wasm` comes first

`pnpm wasm` runs `wasm-pack build crates/videola-core-wasm --target web` and writes the result to
`packages/core/src/wasm`. That directory is generated and not committed, and
`packages/core/src/index.ts` imports from it. Until it exists, `@videola/core` has an unresolvable
import, and `dev`, `typecheck`, `test` and `build` all fail — for the web app as well, because it
depends on the facade.

CI treats the artifact the same way: a separate `wasm` job builds it, uploads it, and every job that
needs it downloads it and checks that `packages/core/src/wasm/videola_core.js` is present before it
runs `pnpm install`.

If `wasm-opt` crashes on your machine, run the `wasm` script from `package.json` by hand with
`--no-opt` appended. That only changes the size of the output; CI builds without the flag.

## Run the web app

```sh
pnpm --filter videola-web dev
```

Vite serves on `http://localhost:5173`. The app loads the WASM core, then offers New, Open, Add
track, Save, Undo and Redo, plus the theme and language toggles.

The checks the repository runs:

```sh
pnpm typecheck
pnpm test
pnpm build
cargo test --workspace
```

## Run the desktop app

```sh
pnpm --filter videola-desktop dev
```

The Tauri configuration points `beforeDevCommand` at the web app's dev server and `devUrl` at
`http://localhost:5173`, so the shell wraps the same front end. To produce an installer instead:

```sh
pnpm --filter videola-desktop bundle
```

`beforeBuildCommand` builds the web app first and Tauri bundles `apps/web/dist`. The configured
bundle targets are `nsis`, `deb`, `appimage` and `dmg`; a local build only produces the ones your
platform can make, so pass `--bundles` if you want to be explicit. The shell it packages is the web
app, unchanged.

## Run the Docker image

```sh
docker build -f docker/Dockerfile -t videola:dev .
docker run --rm -p 8080:80 videola:dev
```

The image is built in three stages: a Rust stage compiles the core to WASM, a Node stage installs
the workspace and builds the web app, and the final stage copies `apps/web/dist` into `nginx:alpine`.
`docker/nginx.conf` serves `.wasm` with the correct MIME type, marks the content-hashed JavaScript
and CSS as immutable, keeps `index.html` uncached, and falls back to `index.html` for unknown paths.

The image serves static files only. An API, an MCP endpoint and a render worker would need
`videola-server`, which is not part of the workspace.
