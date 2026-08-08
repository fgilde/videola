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
| `pnpm --filter @videola/engine test:gpu` | 89 pixel checks against ANGLE/SwiftShader: both shaders compile, premultiplied alpha in all nine blend modes, the transform matrix with rotation and an off-centre anchor, context loss and recovery, a closed `VideoFrame` |
| `pnpm --filter @videola/engine test:export` | 27 checks: a real export, then `ffprobe` and `ffmpeg` read the file back — codec, resolution, frame rate, frame count, duration, and a Goertzel filter confirming the tone in the file is the tone that went in |
| `pnpm --filter @videola/ui test:browser` | 29 checks against real layout: 44-px targets as geometry, hit areas, the virtualisation budget across zoom levels, the scroll width a browser actually honours |
| `pnpm --filter videola-web test:browser` | 56 checks driving the **built** application: a file dropped on it, decoded into the preview, played back, and the phone viewport through the devtools protocol |

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
| Web | Vite build, served as static files; the Docker image is the packaged form |
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

`gate` decides `macos` from `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`, `android` from
`ANDROID_KEYSTORE`, and `ios` from `IOS_CERTIFICATE` and `IOS_MOBILE_PROVISION`. Note that the iOS
keychain import reuses `APPLE_CERTIFICATE_PASSWORD` as the password for `IOS_CERTIFICATE`, so `ios`
can gate open while that password is still empty.

Two things the workflow has to add itself because the Tauri templates do not:

- **Android signing.** `tauri android init` generates no `signingConfig`, so every release APK would be
  unsigned. The workflow appends a Kotlin DSL block that reads the keystore path and passwords
  straight from the environment.
- **iOS export method.** The export uses `--export-method app-store-connect`, which is what matches a
  distribution certificate. `release-testing` or `debugging` would need a different certificate and
  would fail with an unhelpful Xcode message.

The installers package the same shell the web app is, and the release notes say so. The expected
result of a release without mobile signing keys is four assets, not six.

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
