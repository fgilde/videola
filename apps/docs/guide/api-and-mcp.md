# The API and the MCP server

Videola exposes an HTTP interface and an MCP server for AI agents. Both send the same commands the
editor's own timeline sends, through the same Rust core. That is the whole design: an interface built
on the command catalogue can by construction do nothing the user interface cannot, and nothing less.

Both live in `apps/server`. The routes and the tools are thin skins over one class, `Api` in
`apps/server/src/api.ts`, which is the only thing in the package that holds a document. Neither
transport reaches the core on its own, so neither can offer a capability the other lacks, and neither
can skip a check the other performs.

## The core runs as WebAssembly, not as a native build

The Rust core compiles to `wasm32-unknown-unknown` for the browser and links natively into the Tauri
apps. A server could do either. This one loads the same `.wasm` artifact the browser loads.

The reason is the trust boundary. `crates/videola-core/src/format/reader.rs` sizes its entry and
aggregate caps against wasm32's 32-bit `usize` and a browser tab's linear memory; a native build
would apply the same numbers on a different address-space model. Running the identical artifact makes
"the server enforces what the browser enforces" a property of the build rather than a claim about two
builds. There is also nothing native to justify a second compilation target yet: `videola-render` and
`videola-compositor` do not exist, so there is no FFmpeg and no `wgpu` for a Rust server to link
against.

The cost, stated plainly: a Node process and a serialisation step at the WASM boundary, and the
2 GiB media ceiling that the WASM heap imposes. When the render crates land, the argument flips —
a server that has to drive FFmpeg belongs in Rust, and `Api` is the seam to reimplement there.

## Media, and what happens without OPFS

In the browser, imported files go to OPFS, addressed by the SHA-256 of their own bytes. A server has
no OPFS. Here the core keeps imported bytes in its own WASM memory, which is where the ceiling comes
from: 2 GiB of media per process, enforced by the core with a message rather than by exhausting the
heap. The consequences for the interface:

* **Import** takes a path inside the storage root, or a raw HTTP body. It never takes base64 — a
  video encoded into a JSON field costs a third more bytes and has to pass through a string before
  the core sees it.
* **Export** means writing a `.videola` archive: `PUT /api/projects/:id/file` to a path in the
  storage root, or `GET` the same route for the bytes. There is no video encoder on the server.
* Media ids are content hashes, so importing the same file twice is idempotent and costs the budget
  once.

## What is not here

Named explicitly, because an interface that advertises what it cannot do is worse than a smaller one:

| Missing | Why |
|---|---|
| `get_frame` | Needs a compositor. The browser's is WebGL2 in `@videola/engine`; the Rust one does not exist. An agent working through this server cannot see its result. |
| `render` / export to video | Same reason plus an encoder. `.videola` archives are the only output. |
| `get_audio_peaks` | Needs a decoder outside the browser. |
| `list_templates`, `template.instantiate` | The template format is M5. |
| WebSocket `/api/events`, MCP over SSE or streamable HTTP | Nothing pushes yet: the command response already carries the patch, and there is no render progress to stream. MCP is stdio only. |

## Running it

```sh
pnpm wasm                        # the core must be built first
pnpm --filter videola-server build
node apps/server/dist/serve.mjs  # HTTP
node apps/server/dist/mcp.mjs    # MCP over stdio
node apps/server/dist/cli.mjs    # batch editing, see the build guide
```

Configuration is environment only:

| Variable | Default | Meaning |
|---|---|---|
| `VIDEOLA_HOST` | `127.0.0.1` | Bind address. A non-loopback address without a token is refused, with an explanation, rather than bound. |
| `VIDEOLA_PORT` | `7331` | |
| `VIDEOLA_TOKEN` | unset | When set, every request needs `Authorization: Bearer <token>`. Compared in constant time. An empty value counts as unset. |
| `VIDEOLA_STORAGE_ROOT` | the working directory | The whole of the server's authority over the file system. |
| `VIDEOLA_MAX_PROJECTS` | `8` | Projects held open at once. Each can hold up to 2 GiB of media. |
| `VIDEOLA_MAX_BODY_BYTES` | `536870912` | Counted as chunks arrive, not taken from `Content-Length`. |
| `VIDEOLA_LOCALE` | `en` | Written into the manifest of saved archives. |
| `VIDEOLA_WASM` | resolved from `@videola/core` | Path to `videola_core_bg.wasm`, if it is not where the package resolver finds it. |
| `VIDEOLA_WEB_ROOT` | unset | A directory of built web-app files to serve beside the API; this is how the Docker image serves the editor. Unset, every path outside `/api` answers 404. Served **without** the token, because the editor keeps its projects in the visitor's own browser and the storage root stays behind `/api`. |

The MCP server reads only `VIDEOLA_STORAGE_ROOT`, `VIDEOLA_MAX_PROJECTS` and `VIDEOLA_LOCALE`. It
listens on nothing, so a bind address meant for the HTTP server cannot stop it from starting — which
is what a container that sets `VIDEOLA_HOST` for its API would otherwise do.

For an MCP client, that is a stdio server entry:

```json
{
  "mcpServers": {
    "videola": {
      "command": "node",
      "args": ["/path/to/videola/apps/server/dist/mcp.mjs"],
      "env": { "VIDEOLA_STORAGE_ROOT": "/path/to/my/videos" }
    }
  }
}
```

## The trust boundary

Every scalar arriving from HTTP or from an agent is untrusted, and so is every `.videola` file. None
of that validation lives in `apps/server`: it lives in `Project::normalize` and in the command
handlers, which is where the browser's dispatches are checked too. A duplicate check here would be a
second rule to keep in step with the first.

What the server layer owns is the part the core cannot see:

* **Paths.** A path from a request is resolved against the storage root and then checked against the
  *real* path, because a symlink inside the root can still point out of it. Absolute paths are
  refused. Containment is settled before any directory is created, so a refused request leaves
  nothing behind outside the root.
* **Authentication and body size**, above.
* **Atomic batches.** `POST /api/projects/:id/commands` applies its commands under one coalesce key,
  so what lands is a single history entry. A command rejected anywhere in the chain is taken back
  with `Document::rollback`, which — unlike undo — leaves nothing on the redo stack for a later redo
  to reapply half a rejected batch from.
* **Revisions.** Every view carries a `revision`. A batch may send `ifRevision`; a mismatch is
  answered with `409` and changes nothing. The document itself is only ever touched synchronously, so
  two requests cannot interleave inside one batch; `revision` is there so a second client can tell
  that its picture of the project is stale. Writes to one path in the storage root are queued and go
  through a staging file and a rename, so a crash mid-write cannot truncate an existing archive.

## HTTP reference

Errors are `{ "error": { "code", "message" } }`. A command the core refuses is a `400` carrying the
core's own message.

| Route | Meaning |
|---|---|
| `GET /api/health` | Liveness plus the storage root in effect. |
| `GET /api/schema` | The command catalogue: one JSON Schema per command, generated from the Rust enum. |
| `GET /api/projects` | The open projects. |
| `POST /api/projects` | Empty body creates a project; `{ "path": "reel.videola" }` opens one from the storage root. `201` with a handle. |
| `GET /api/projects/:id` | The handle's view plus the full project model. |
| `DELETE /api/projects/:id` | Closes it. Unsaved changes are lost. |
| `POST /api/projects/:id/commands` | `{ "command": {…} }` or `{ "commands": [{…}] }`, optionally with `"ifRevision"`. Answers with the view and one dispatch result per command. |
| `POST /api/projects/:id/undo`, `…/redo` | |
| `GET /api/projects/:id/describe` | The text summary. |
| `GET /api/projects/:id/validate` | Consistency findings. |
| `POST /api/projects/:id/media?path=…` | Imports from the storage root. `&mime=` overrides the type guessed from the extension. |
| `POST /api/projects/:id/media?name=…&mime=…` | Imports the raw request body. |
| `GET /api/projects/:id/file` | The `.videola` archive as `application/zip`. |
| `PUT /api/projects/:id/file` | `{ "path": "out/reel.videola" }` writes it into the storage root. |

## MCP reference

Twenty-six tools come straight from the generated catalogue — one per command, named for it with the
dot replaced by an underscore (`clip.split` becomes `clip_split`). Each takes the command's own fields
plus `project`, and optionally `ifRevision`; the `type` discriminant is not an input, because the tool
name already fixes it. Adding a command to the Rust enum adds a tool without anyone editing the server.

Thirteen more tools cover what the catalogue does not:

| Tool | Purpose |
|---|---|
| `project_create` | An empty project. Returns the handle everything else needs. |
| `project_open` | A `.videola` file from the storage root. |
| `project_list` | The open projects. |
| `project_get` | The full model as JSON. Large. |
| `project_describe` | A compact text summary: tracks, clips with their times, effects, library, markers. |
| `project_validate` | Overlapping clips, clips referencing media the library does not declare, empty durations, fades longer than their clip. |
| `project_save` | Write a `.videola` archive into the storage root. |
| `project_close` | Drop it. |
| `media_importFile` | Read a media file into the library; returns its content-hash id. |
| `history_undo`, `history_redo` | |
| `effects_list` | The effects and transitions this build can render, with their parameters. `effect.add` accepts nothing else. |

A rejected command comes back as tool output with `isError`, carrying the core's reason — not as a
protocol error, which would tell the agent the tool is broken and hide why.

`project_describe` matters more than its size suggests. Without a frame renderer it is the only way
an agent can check what it actually built, so read it after a change rather than assuming the change
landed as intended.

## Example flows

Times are in **flicks**: 705 600 000 flicks are one second. A frame at 30 fps is 23 520 000.

### Cut a clip and save the result

```
project_create                          → { id: "prj_…" }
media_importFile   project, "raw/interview.mp4"
                                        → { mediaId: "med_<sha256>" }
track_add          project, kind "video", name "V1"
project_describe   project              → read the track id off the summary
clip_add           project, track, source { kind: "media", media: mediaId },
                   start 0, duration 705600000
project_describe   project              → read the clip id
clip_split         project, clip, at 352800000
clip_remove        project, <the later half>
project_save       project, "out/interview-cut.videola"
```

`clip_add` needs a duration; there is no "whole medium" shorthand, because the server cannot probe a
file's length. Take it from the source's metadata on your side, or trim afterwards.

### Fade a clip in with a keyframed effect

```
effects_list                            → brightness takes `amount`, 0…4
effect_add         project, clip, effectType "brightness"
keyframe_add       project, clip, effectType "brightness", key "amount",
                   time 0, value { kind: "float", value: 0 }, interp "linear"
keyframe_add       project, clip, effectType "brightness", key "amount",
                   time 352800000, value { kind: "float", value: 1 }, interp "linear"
```

A keyframed parameter overrides the static value from `effect.setParam`. `ParamValue` is always
tagged: `{ kind: "float", value }`, `{ kind: "int", value }`, `{ kind: "bool", value }`,
`{ kind: "color", value: [r, g, b, a] }`, `{ kind: "vec2", value: [x, y] }`,
`{ kind: "choice", value }`.

### The same thing over HTTP

```sh
BASE=http://127.0.0.1:7331/api
ID=$(curl -s -X POST $BASE/projects | jq -r .id)

curl -s -X POST "$BASE/projects/$ID/media?path=raw/interview.mp4" | jq -r .mediaId

curl -s -X POST "$BASE/projects/$ID/commands" -d '{
  "commands": [
    { "type": "track.add", "kind": "video", "name": "V1" },
    { "type": "project.setTitle", "title": "Interview" }
  ]
}' | jq .view

curl -s "$BASE/projects/$ID/describe" | jq -r .description
curl -s -X PUT "$BASE/projects/$ID/file" -d '{"path":"out/interview.videola"}'
```

### Ripple a whole edit safely

Send the whole sequence as one batch with `ifRevision` set to the revision you last saw. If another
client moved on, you get a `409` and nothing changed; if one command in the middle is rejected, the
batch is rolled back whole and the undo stack looks as it did before.

```json
{
  "ifRevision": 7,
  "commands": [
    { "type": "clip.split", "clip": "clp_a", "at": 352800000 },
    { "type": "clip.remove", "clip": "clp_b" },
    { "type": "clip.move", "clip": "clp_c", "toTrack": "trk_1", "start": 352800000 }
  ]
}
```

## Pitfalls worth knowing before the first call

* **`clip.trim` takes a delta, never an absolute edge.** Compute it from the clip's *current* edge
  each time. A rejected trim must not be carried into the next one, or the sequence runs out of step.
* **`clip.split` needs a point strictly inside the clip**, not on either boundary.
* **`effect.add` for an effect the clip already carries is a silent no-op**, and so is `media.import`
  for an id already in the library. Both answer with an empty patch, which is how you can tell.
* **`media.remove` deletes every clip using the medium**, descending into nested compound timelines.
* **`sizeBytes` on a `MediaAsset` is a plain JSON number on the wire**, whatever the generated
  TypeScript type says about the Rust `u64`.
* **A track's `volume` and `pan` are clamped, not refused** — 0…4 and −1…1. `speed.rate` is refused
  outside (0, 100].
