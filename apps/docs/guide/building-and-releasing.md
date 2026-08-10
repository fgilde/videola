# Building and releasing

Three workflows live in `.github/workflows`: `ci.yml` on every push to `main` and every pull request,
`release.yml` on a `v*` tag, and `pages.yml` for this documentation site.

## CI

Five jobs, three of them independent.

| Job | Runner | What it does |
|---|---|---|
| `rust` | `ubuntu-latest` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` |
| `types` | `ubuntu-latest` | regenerates the ts-rs output and fails if the committed files no longer match |
| `wasm` | `ubuntu-latest` | `wasm-pack build crates/videola-core-wasm --target web`, uploads the result as the `wasm` artifact |
| `web` | `ubuntu-latest` | needs `wasm`; downloads the artifact, then `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build` |
| `browser` | `ubuntu-latest` | needs `wasm`; runs the four browser harnesses in real Chrome |

The `types` job stages its output with `git add -A` before comparing, because `git diff` ignores
untracked files and a newly generated type would otherwise slip through unnoticed.

`web` depends on `wasm` because `packages/core/src/wasm` is generated and not committed. Before
installing, the job asserts that `packages/core/src/wasm/videola_core.js` exists, so a broken WASM
build fails with that message instead of a confusing module-resolution error several steps later.

Clippy runs with `unwrap_used` and `expect_used` denied and `unsafe_code` forbidden, configured at the
Cargo workspace level.

## What the browser job proves

WebGL2, WebCodecs, OPFS and layout do not exist in jsdom, so the unit tests stop at the last line a
fake can honestly stand in for. Four harnesses run the same code in real Chrome. None of them uses
Playwright or any other browser-automation dependency: Chrome renders the page and reports back,
either through `--dump-dom` or by posting its results to the small server that started it.

| Command | What it checks |
|---|---|
| `pnpm --filter @videola/engine test:gpu` | 351 pixel checks against ANGLE/SwiftShader: both shaders compile, premultiplied alpha in all nine blend modes, every effect and transition at named pixel values, the tone curves and the colour wheels, what a scope reads back off a shrunken frame, the transform matrix with rotation and an off-centre anchor, context loss and recovery, a closed `VideoFrame` |
| `pnpm --filter @videola/engine test:export` | 27 checks: a real export, then `ffprobe` and `ffmpeg` read the file back — codec, resolution, frame rate, frame count, duration, and a Goertzel filter confirming the tone in the file is the tone that went in |
| `pnpm --filter @videola/ui test:browser` | 200 checks against real layout: 44-px targets as geometry, hit areas, the virtualisation budget across zoom levels, the scroll width a browser actually honours, and the three scopes and the curve field drawn onto a canvas the browser really rasterises |
| `pnpm --filter videola-web test:browser` | 228 checks driving the **built** application: a file dropped on it, decoded into the preview, graded with a curve and a colour wheel while the scopes follow, played back, and the phone and tablet viewports through the devtools protocol |

They are one job, not four. Together they take well under a minute; a second job would spend more on
checkout, install and build than the checks themselves cost. Nothing here is deferred to a nightly
run — every one of these harnesses has caught a defect no unit test could see, and a check that only
runs at night is a check nobody waits for.

Two things the job has to arrange, both because of the runner rather than the tests:

- **Chrome.** The job fails with a clear message if the image has no `google-chrome`; it does not
  guess an install path it cannot verify. It then writes a one-line wrapper that appends
  `--no-sandbox` and points `CHROME_PATH` at it. Chrome's sandbox needs unprivileged user
  namespaces, which Ubuntu 24.04 can lock down through AppArmor, and a throwaway CI VM running our
  own fixtures gains nothing from it. `CHROME_PATH` is the switch all four runners already have —
  and it is authoritative: a path that points at nothing fails loudly instead of falling back to
  some other Chrome without the wrapper's flags.
- **ffmpeg.** `test:export` needs `ffmpeg` and `ffprobe` on the path; the job installs them if the
  image does not carry them. They are the independent reader — without them the export harness would
  only be checking our own muxer against our own demuxer.

The three screenshots the application harness takes (`preview.png`, `phone.png`,
`phone-library.png`) are uploaded as the `browser-screenshots` artifact with `if: always()`, because
a layout result is not something a number can carry.

## Release

A `v*` tag triggers `release.yml`. Concurrency is grouped per ref with `cancel-in-progress: false` —
unlike CI, a half-cancelled release would leave a published image with no matching installers.

The release is created as a **draft**, so the assets can be checked before anyone sees them.

| Job | Runner | Produces |
|---|---|---|
| `gate` | `ubuntu-latest` | three outputs saying whether the macOS, Android and iOS signing secrets are present |
| `docker` | `ubuntu-latest` | `ghcr.io/fgilde/videola:<tag>` and `:latest` |
| `wasm` | `ubuntu-latest` | the `wasm` artifact the three app jobs consume |
| `desktop` | matrix over `ubuntu-latest`, `windows-latest`, `macos-latest` | Linux `.deb` and AppImage, Windows NSIS installer, macOS `.dmg` |
| `android` | `ubuntu-latest` | `.apk` and `.aab`, only when a keystore is configured |
| `ios` | `macos-latest` | `.ipa` exported for App Store Connect, only when a certificate and profile are configured |
| `summary` | `ubuntu-latest` | a step-summary table of every job's result, with `if: always()` |

### Six targets

| Target | How |
|---|---|
| Web | Vite build, served as static files; the Docker image is the packaged form (see below) |
| Windows | Tauri 2, NSIS installer |
| Linux | Tauri 2, `.deb` and AppImage |
| macOS | Tauri 2, `.dmg` |
| Android | Tauri 2 Mobile, `.apk` and `.aab` |
| iOS | Tauri 2 Mobile, `.ipa` |

`tauri.conf.json` lists all four desktop bundlers, but the matrix passes `--bundles` per platform
anyway. The `nsis` bundler is not restricted to Windows, so taking the target list from the
configuration would have Linux and macOS each build a Windows installer.

The `desktop` matrix runs with `fail-fast: false`: a failed macOS build must not take the finished
Windows and Linux installers with it.

`android` and `ios` need `desktop` as well as `gate` and `wasm`. That ordering is not a build
dependency — it keeps the expensive mobile jobs from running before installers exist, and it keeps two
jobs from racing to create the same draft release.

### Why there is a `gate` job

The `secrets` context is not available in a job-level `if:` — only `github`, `needs`, `vars` and
`inputs` are. A job cannot ask "do I have a certificate?" directly.

`gate` therefore reads the secrets as environment variables in a normal step and emits `yes` or `no`
as job outputs. `android` and `ios` gate on those outputs, so GitHub marks them **skipped** rather
than failing. A missing signing key produces a visibly absent target, not a red release.

macOS is handled a step lower down: the DMG is always built, and only the signing step is conditional.
The Apple environment variables are created *only* when a certificate really exists, because Tauri
checks for their existence rather than their content — an empty `APPLE_CERTIFICATE` would sail through
twenty minutes of compilation and then fail while importing an empty certificate.

### Signing secrets

| Target | Secrets | Without them |
|---|---|---|
| Docker image, Windows NSIS, Linux `.deb` and AppImage | none | built and usable, unsigned |
| macOS DMG | `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` | the DMG is still built, but unsigned, and Gatekeeper blocks it on the user's machine |
| Android APK and AAB | `ANDROID_KEYSTORE` (base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | the job is skipped; an unsigned APK cannot be installed or shipped to Play |
| iOS IPA | `IOS_CERTIFICATE` (base64 distribution `.p12`), `IOS_MOBILE_PROVISION` (base64), plus `APPLE_CERTIFICATE_PASSWORD` and `APPLE_TEAM_ID` | the job is skipped; no distributable IPA exists without a certificate and a provisioning profile |
| Desktop auto-update | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_UPDATER_PUBKEY`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is protected | the installers are built as usual and carry no updater at all |

`gate` decides `macos` from `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`, `android` from
`ANDROID_KEYSTORE`, `ios` from `IOS_CERTIFICATE` and `IOS_MOBILE_PROVISION`, and `updater` from both
halves of the update key. Note that the iOS keychain import reuses `APPLE_CERTIFICATE_PASSWORD` as
the password for `IOS_CERTIFICATE`, so `ios` can gate open while that password is still empty.

### Auto-update

`tauri signer generate -w ~/.tauri/videola.key` writes a private key and prints its public half. The
private key goes into the `TAURI_SIGNING_PRIVATE_KEY` secret and the public one into
`TAURI_UPDATER_PUBKEY`; nothing else has to be set up. The endpoint is
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`, which the workflow fills in
from `github.repository`, and `uploadUpdaterJson` has `tauri-action` publish that manifest beside the
installers.

Neither the endpoint nor the public key sits in `tauri.conf.json`. The workflow merges
`plugins.updater` and `bundle.createUpdaterArtifacts` into the configuration with `jq`, and only when
`gate` says both halves of the key exist. Two reasons, both the difference between a working release
and a broken one:

- A placeholder `pubkey` committed to the repository would be a promise with nothing behind it: an
  app offering an update it can never verify.
- `createUpdaterArtifacts: true` **without** a signing key does not quietly skip signing — the
  bundler stops. Left in the file it would break every release built by anyone without a key.

Without the secrets the plugin is still compiled in, finds no configuration, and its check fails —
which the app treats exactly as it treats being offline, so nobody sees an error.

The plugin is a dependency of the three desktop target triples rather than of the crate, and its
permission lives in a separate capability restricted to `["linux", "macOS", "windows"]`.
`tauri-plugin-updater` has no Android or iOS build, so an unconditional dependency, or the permission
in the default capability, would stop the two mobile jobs instead of the desktop one — a failure a
long way from its cause.

An installed app that finds a newer version asks once, on start, and installs it if the user says so.
There is no silent update and no background poll.

Two things the workflow has to add itself because the Tauri templates do not:

- **Android signing.** `tauri android init` generates no `signingConfig`, so every release APK would be
  unsigned. The workflow appends a Kotlin DSL block that reads the keystore path and passwords
  straight from the environment.
- **iOS export method.** The export uses `--export-method app-store-connect`, which is what matches a
  distribution certificate. `release-testing` or `debugging` would need a different certificate and
  would fail with an unhelpful Xcode message.

The installers package the same shell the web app is, and the release notes say so. The expected
result of a release without mobile signing keys is four assets, not six.

## How each build updates

**The desktop builds** check the endpoint on startup and offer what they find in the editor's own
dialogue: which version, a button, and a bar that reports how far the download has got — or goes
indeterminate where the host reports bytes with no total, because a bar that invented a number would
be a bar lying about how long this takes. It cannot be dismissed mid-download: closing would leave
the download running with nothing on screen to say so, and the next check would start it over. A
failed update says the version in hand keeps working, which is true.

None of that happens without a signing key. A release built without one carries no `plugins.updater`
block at all, and a build with no block finds nothing to check — see the table above.

**The browser build** has a service worker, which is where an editor left open in a tab for a week
gets its update from. A new build installs a new worker beside the running one, and that waiting
worker *is* the new version: the editor is told, it offers a reload, and the swap happens on the
reload. Nothing is exchanged under a running session — a worker taking over on its own would change
the bundle under unsaved work, which is why `clients.claim()` is deliberately absent from it.

The same worker is what makes the browser build work offline. Two rules, and both follow from how
Vite names what it builds: a file whose name carries a content hash can never change, so it is served
from the cache; everything else, the document above all, goes to the network first, because that is
the request which tells the browser a new build exists.

It caches **files and nothing else**. An earlier version cached every same-origin GET and swept up
the test harness's own control requests — under a virtual clock each of those is a pause, and a cache
write hung on every one meant the editor never got a turn to draw. The narrow rule is the correct one
anyway: an API answer served from an offline cache is a wrong answer served confidently.

One header decides whether any of this works: **`sw.js` must not be cached long.** A service worker
served as immutable pins the application to whatever it shipped that day, and there is no way back —
the worker that would fetch a newer one is the stale one. The server sends `no-cache` for everything
outside `/assets`, and a test holds it there.

## The Docker image

Three stages. A `rust:1-bookworm` stage builds the WASM core, a `node:22-bookworm-slim` stage
installs the workspace and builds both the web app and the server bundles, and a `node:22-alpine`
stage keeps the result. That last stage carries no `node_modules`: esbuild bundles `serve.mjs`,
`mcp.mjs` and `cli.mjs` down to plain ESM with nothing left to resolve, so what ships is three
JavaScript files, one `.wasm`, and the built web app.

| | |
|---|---|
| Runs as | `node`, uid 1000, never root |
| Port | 7331, one process |
| Storage | `/data`, declared as a volume and owned by `node` |
| Health check | `node -e "fetch('…/api/health')"`, using the token from the environment |
| Size | around 170 MB, of which Node itself is most |

### One process, not nginx and Node

The image before this one served static files with nginx and nothing else. Adding the API meant
either a second process under a supervisor, or letting the one process that already speaks HTTP
serve the files too. It serves them: `VIDEOLA_WEB_ROOT` points the server at the built app, unknown
paths answer with `index.html` because the editor is a single-page application, and `.wasm` gets
`application/wasm` — the type a browser refuses to guess and without which the editor never starts.
The path a request names is resolved through the same containment check the storage root gets, so
`..` and a symlink out of the web root are both refused.

Static files are served **without** the token. The editor holds its projects in the visitor's own
browser and reads nothing from the server; everything under `/api`, which is where the storage root
is, stays behind the bearer token.

### Why the container refuses to start without a token

A published port only reaches a process bound to `0.0.0.0`, and `configFromEnv` refuses that address
unless `VIDEOLA_TOKEN` is set. The image therefore sets `VIDEOLA_HOST=0.0.0.0` and no token, and a
`docker run` without one stops immediately with the reason. That is the intended answer rather than
an oversight: a container that binds a reachable address and hopes hands its storage root to every
machine that can see it.

The MCP server listens on nothing, so it reads no bind address at all — `apiConfigFromEnv` gives it
only the storage root, the project limit and the locale. Otherwise the image's `VIDEOLA_HOST` would
have stopped a stdio server from starting for a socket it never opens.

`serve.mjs` closes its listener on `SIGTERM`. As PID 1 a process gets no default disposition for that
signal, so without the handler `docker stop` would wait out its ten seconds and then kill it.

## The command line

`dist/cli.mjs` — `videola` when the package is linked — is a third skin over the same `Api` class the
HTTP routes and the MCP tools use, so it can do nothing they cannot and skips no check they perform.

```sh
videola apply [--in <file>] [--media <file>]... [--commands <file>] --out <file>
videola describe <file>
videola validate <file>
videola schema [<command>]
```

The commands file holds one command object or an array of them, and the array lands as a single
history entry: a command the core refuses rolls the whole batch back and writes nothing. Media ids
are `med_` followed by the SHA-256 of the file's bytes, which is what lets a commands file name a
medium the same run imports without looking anything up first.

Paths are used as given, without the storage root's containment check. That check exists to fence in
an interface strangers reach; there is no stranger on the other side of a terminal, and a CLI that
refused `../footage/intro.mp4` would be wrong rather than safe. The interfaces that do face strangers
are unchanged.

There is no `export` subcommand. Encoding video needs the browser's own encoders, which a command
line process does not have, so a `.videola` archive is the only thing it writes.

## The documentation site

`pages.yml` builds `apps/docs` with VitePress and deploys it with `actions/configure-pages`,
`actions/upload-pages-artifact` and `actions/deploy-pages`. It triggers on pushes to `main` that touch
`apps/docs`, the workflow itself, or the two workspace files without which
`pnpm install --frozen-lockfile` would fail, and can be run manually with `workflow_dispatch`.

The site build does not need the WASM artifact. It is a documentation site, not the application, and
nothing under `apps/docs` imports `@videola/core` — so `pnpm install --frozen-lockfile` followed by
`pnpm --filter videola-docs build` is the whole build.

VitePress is configured with `base: "/videola/"`, which is required for a project Pages site served
from that path. Without it every asset URL resolves against the user-page root and 404s.
