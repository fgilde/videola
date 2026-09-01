# Running it on your own machine

::: info Summary
One Node process serves the editor, the HTTP API and the MCP server. There are four ways to install it
— Docker, an Unraid template, an Umbrel app, and a Proxmox script that makes an LXC container — and all
four set the same handful of variables. Every /api call needs a token, and the server refuses to listen
on a reachable address without one.
:::

## What is being installed

`videola-server` is one process. It serves the built editor as static files, answers `/api` for the HTTP
interface, and carries the same Rust core as WebAssembly that the browser build does — so a project
opened over the API and a project opened in the editor are opened by the same code.

| Variable | Default | What it is |
|---|---|---|
| `VIDEOLA_TOKEN` | none | The bearer token every `/api` call carries. **Required** on any address but loopback |
| `VIDEOLA_HOST` | `127.0.0.1` | The bind address. `0.0.0.0` inside a container, so the published port reaches it |
| `VIDEOLA_PORT` | `7331` | |
| `VIDEOLA_STORAGE_ROOT` | the working directory | Projects and imported media. **This is the directory to back up** |
| `VIDEOLA_WEB_ROOT` | none | Where the built editor is. Without it the server answers the API and serves no editor |
| `VIDEOLA_WASM` | none | The core. Without it the server cannot open a project at all |
| `VIDEOLA_LOCALE` | `en` | `en` or `de`: what the *server* writes into generated names. The editor follows the browser |
| `VIDEOLA_MAX_PROJECTS` | `8` | How many projects stay open in memory, each with its own core instance |

**The token is not a hardening option.** The server checks the bind address at startup and refuses to
listen on anything but loopback without one, because an open Videola hands every machine that can reach
it read and write access to the storage root. That check is in `configFromEnv`, and the deployment test
in `apps/server/src/deploy.test.ts` asserts it against every file below — so a template that offered the
token as optional would fail the build rather than ship.

The storage root has to **exist**; the server does not create it. Every installer below makes it, and a
server that made it itself would silently write a projects directory into whatever `cwd` happened to be.

## Docker

```sh
docker run -d --name videola \
  -p 7331:7331 \
  -e VIDEOLA_TOKEN="$(openssl rand -hex 24)" \
  -v videola-data:/data \
  ghcr.io/fgilde/videola:latest
```

The image sets `VIDEOLA_HOST`, `VIDEOLA_PORT`, `VIDEOLA_STORAGE_ROOT`, `VIDEOLA_WEB_ROOT` and
`VIDEOLA_WASM` itself; the token is the one thing it cannot invent for you. It runs as the `node` user
and declares `/data` as a volume.

## Unraid

`deploy/unraid/videola.xml` is a Community Applications template. Copy it into
`/boot/config/plugins/dockerMan/templates-user/` and it appears under **Add Container**, or point CA at
this repository.

It offers the port, the `/data` path (`/mnt/user/appdata/videola` by default) and the token, which is
marked required and masked. The two advanced variables are the locale and how many projects stay open.
The template pins `:latest` deliberately: an Unraid box updates a container by pulling it, and a pinned
version would make **Check for Updates** a permanent no.

## Umbrel

`deploy/umbrel/videola/` holds `umbrel-app.yml` and `docker-compose.yml` in the shape the app store
expects. The compose file pins the exact version, because an app store shows a version number to the
person installing it and `latest` would make that number a guess — the deployment test checks that the
pin, the manifest's `version:` and the release tag are the same string.

Two things worth knowing about the compose file:

- **`APP_HOST` is `videola_server_1`, not `localhost`.** Umbrel puts every app behind its own proxy
  container, and that proxy is what publishes a port. The server binds `0.0.0.0` *inside its own
  container* so the proxy can reach it; `127.0.0.1` would be reachable only from the server's own
  network namespace.
- **The health check goes through `/api/health` with the token.** A check against the open port would
  say the process started; this one says the core loaded and the storage root answers. It carries the
  token because the endpoint is behind the same gate as everything else — an unauthenticated health
  endpoint would be a hole in exactly one place.

## Proxmox VE

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/fgilde/videola/main/deploy/proxmox/videola.sh)"
```

Run it on the PVE host. It makes an **unprivileged Debian 13 container** with nesting off — the server
is one Node process and needs neither root in the host's namespace nor a container runtime inside
itself — installs Node from Debian's own archive, fetches the server bundle from the latest release,
generates a token, writes a systemd unit and waits for `/api/health` to answer before it prints the URL
and the token.

`CTID`, `DISK_GB`, `CORES`, `RAM_MB`, `BRIDGE`, `STORAGE` and `PORT` are environment variables with
sensible defaults; without a `CTID` it takes the next free one.

**Self-contained on purpose.** The community helper scripts source a shared `build.func` from another
repository at run time. That is convenient, and it means the script breaks whenever that file moves.
This one needs `pct`, which every PVE host has.

`deploy/proxmox/install.sh` is the half that runs *inside* the container, and it runs on its own as
well — on a plain Debian VM, on a Raspberry Pi, in a container somebody made themselves:

```sh
curl -fsSL https://raw.githubusercontent.com/fgilde/videola/main/deploy/proxmox/install.sh | bash
```

It is idempotent: run it again and it fetches the current release, keeps the token and the storage root
it already wrote, and restarts the service. Regenerating the token on every run would lock out every
client that stored it.

### What the unit forbids

The service file is the part of a bundle install that outlives the script, so what it *cannot* do
matters more than what it starts:

```ini
User=videola
ProtectSystem=strict
ProtectHome=yes
PrivateDevices=yes
NoNewPrivileges=yes
RestrictNamespaces=yes
ReadWritePaths=/var/lib/videola
```

One writable path, and nothing else the machine offers. A video editor has no business with a device, a
kernel module or somebody else's home directory.

## Publishing destinations

A finished video's last step is usually not "a file in the downloads folder". A destination is a place
to send it — a YouTube channel, a Vimeo account, or any URL that takes a file — set up once and used
from then on.

| Kind | What it needs | What it does |
|---|---|---|
| `youtube` | `clientId`, `clientSecret`, `refreshToken` | a resumable upload through the Data API |
| `vimeo` | `accessToken` | a tus upload to the account |
| `webhook` | `url` | posts the file as a multipart form, with any headers you name |

```bash
curl -X POST localhost:7331/api/destinations \
  -H "authorization: Bearer $VIDEOLA_TOKEN" -H "content-type: application/json" \
  -d '{"kind":"youtube","name":"My channel",
       "secrets":{"clientId":"…","clientSecret":"…","refreshToken":"…"},
       "settings":{"privacyStatus":"unlisted"}}'

curl -X POST "localhost:7331/api/destinations/dst_…/publish?title=Summer" \
  -H "authorization: Bearer $VIDEOLA_TOKEN" -H "content-type: video/mp4" \
  --data-binary @summer.mp4
```

**Secrets go in and never come out.** `GET /api/destinations` says that a destination holds a refresh
token; nothing says what it is. A token that can be read back is a token that leaks through a screen
share, a log or a browser history — rotating one means writing it again, which is a click, and the
alternative is a class of accident this program will not make possible.

**Private unless you say otherwise.** A YouTube upload is `private` and a Vimeo one is visible to
nobody until the destination's settings say another word. A mistake that publishes a rough cut to the
world cannot be taken back by an undo.

**Where the tokens come from.** There is no browser dance here: this server has nowhere to put a
redirect, and it would be a second way to get the same string. Run Google's own installed-app flow
once — their `oauth2l`, a five-line script, or the flow any of their quickstarts prints — and paste
the three values it gives you. Vimeo issues a personal access token with an upload scope from the
account page, which is one field.

**Why the server and not the browser.** The upload needs a client secret, and a secret in a browser is
not a secret. The encoder stays where the material is: the editor exports in the tab, sends the bytes
here, and this end talks to the platform.

**What is not there yet.** An interrupted upload starts again rather than resuming: the session URL
would have to outlive the request, which is a job queue and a different feature. There is no schedule,
no thumbnail upload and no playlist. Adding a kind is one function in `publish.ts` and one row in the
table of what it requires.

## The server bundle

`videola-server-<version>.tar.gz` is attached to every release: the three entry points, the WASM the
core lives in, the built editor, and a README. It needs **Node 22 and nothing else** — esbuild has
already bundled every dependency into the entry points, so there is no `node_modules` to install and
nothing to resolve at run time.

It is built by `node deploy/bundle.mjs`, which is the same command the release workflow runs. A recipe
that exists only inside a workflow is the recipe that breaks on the day it is needed.

## Backing it up

The storage root. Everything else — the bundle, the image, the container — is reinstallable in a minute;
the projects and the imported media are not. A `.videola` file is a ZIP with the media inside it, so a
copy of that directory is a copy of the work with nothing to reconstruct.
