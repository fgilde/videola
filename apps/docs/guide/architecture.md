# Architecture

This chapter explains the decisions that shape the code, and says for each one whether it is built
or still planned. The original reasoning is recorded in German in
[`docs/superpowers/specs/2026-08-07-videola-design.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/specs/2026-08-07-videola-design.md);
this page is the English account of it.

## The risk everything is arranged around

A video editor is expected to render on more than one machine. The same cut is previewed in a
browser, exported by a desktop build, and — eventually — rendered headless on a server. The failure
that ruins such a tool is divergence: the same project produces a different picture depending on
which host drew it. Divergence has one root cause, and it is duplication. It appears wherever the
project model or an effect is implemented twice.

Videola's architecture is mostly a set of measures to keep the number of implementations at one.

## The model lives in Rust

**Built.** `crates/videola-core` holds the project model, the command bus, undo and redo, and the
`.videola` reader and writer. `crates/videola-core-wasm` wraps it with `wasm_bindgen` so the browser
drives that same crate.

The obvious alternative — model and editing logic in TypeScript, Rust only for encoding — was
rejected because it does not actually save the Rust implementation. A native or server-side
compositor has to read and interpret the whole project anyway: tracks, clips, effect parameters,
keyframe curves, speed ramps. The model therefore exists in Rust whether or not it also exists in
TypeScript. Writing it a second time in TypeScript would not remove work; it would add a copy that
has to be kept in step by hand, forever, and that copy is exactly where the two hosts drift apart.

Two costs of this were accepted deliberately:

- **The development loop has a build step.** `pnpm wasm` has to run before anything in the
  workspace typechecks or builds, because `packages/core/src/wasm` is generated and not committed.
- **The TypeScript-to-WASM boundary serialises.** Every call across it converts values.

The second cost is what dictates the shape of the boundary. It is deliberately coarse — one
`dispatch(command)` returning a patch — rather than a fine-grained object graph the front end could
walk. A chatty boundary would pay the serialisation cost per property access.

One thing the design anticipates but has not reached: the crate is meant to be linked natively into
the Tauri shell and into a server as well as compiled to WASM. Today only the WASM path exists. The
Tauri shell in `apps/desktop` hosts the web bundle and does not depend on `videola-core` at all, so
the desktop app runs the same WASM core the browser does. That is a packaging detail rather than an
architectural change, but it means the "linked natively" half of the plan is untested.

## The TypeScript facade

**Built.** `packages/core` is `@videola/core`, a thin TypeScript layer over the WASM module. The
model types under `packages/core/src/generated` are produced from the Rust types by
[ts-rs](https://github.com/Aleph-Alpha/ts-rs), so `Project`, `Clip`, `Command` and the rest are
derived rather than transcribed.

Generated files that are committed rot silently unless something checks them, so CI has a `types`
job that regenerates them, stages the result and fails if `git diff --cached` is non-empty. Staging
first matters: `git diff` ignores untracked files, so a newly generated type would otherwise slip
through unnoticed.

The facade adds only what the boundary itself needs — a document wrapper with a subscription, the
`cmd.*` constructor helpers, and the flicks conversions. It contains no editing logic, because
editing logic in the facade would be the duplicate the whole arrangement exists to avoid.

## Undo is a diff, not a reverse operation

**Built.** Applying a command does not mutate the project in place. `Document::dispatch` serialises
the project to JSON, applies the command to a clone, serialises the result, and diffs the two
documents with [json-patch](https://crates.io/crates/json-patch). The forward patch and the reverse
patch — the diff taken the other way round — go onto the undo stack as a pair. Undo applies the
reverse patch; redo applies the forward one.

The alternative is the conventional one: each command implements its own inverse. That is where undo
bugs come from. An inverse has to be written and maintained for every command, it is only exercised
when someone presses Ctrl+Z on that exact command, and it silently goes stale the moment the forward
operation is changed without the inverse being updated. Twenty commands mean twenty inverses to keep
honest; a diff means none. The undo machinery is written once and is correct for command
twenty-one before it is written.

The cost is a clone and two serialisations per dispatch. That is acknowledged in the code as a thing
to revisit if drag-frequency dispatch on large projects ever makes it visible; the fix would be to
build patches by hand per command while keeping the same history structure.

The clone is not purely a diffing artefact, either. It also gives every handler a free rollback:
`media.remove` walks nested compound timelines and can fail partway through, after clips at
shallower levels have already been removed. That partial mutation lands on the clone and is
discarded, so a failed command leaves the project untouched.

## Time is an integer

**Built.** `Time` is a newtype over `i64` counting *flicks*, and one second is exactly

```
FLICKS_PER_SECOND = 705_600_000
```

Float seconds are the intuitive choice and the wrong one. A frame boundary is a value the editor has
to hit exactly — a cut, a keyframe, the end of a clip — and `1/30` is not representable in binary
floating point. Accumulate enough of them and a clip that should end precisely on a frame ends a
hair before or after it, so a split lands on the wrong frame or a keyframe fires one frame late. Two
hosts rounding those errors differently is the divergence problem again, in the time axis.

705,600,000 is chosen because it factors as

```
705,600,000 = 2^9 · 3^2 · 5^5 · 7^2
```

which means it divides evenly by every frame rate and audio sample rate that matters:

| Divides evenly into | Values |
|---|---|
| Frame rates | 24, 25, 30, 48, 50, 60, 90, 100, 120 |
| Audio sample rates | 8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 192000 |

It also handles the NTSC rates exactly. A rate is stored as a rational `Rate { numerator,
denominator }`, so 30000/1001 is a real value rather than 29.97. One frame at 30000/1001 is
705,600,000 × 1001 / 30000 = 23,543,520 flicks — an integer, so frame-to-time and time-to-frame
round-trip without loss. `videola-core` tests that round trip for every frame rate listed above and
for 30000/1001.

Two guard rails come with the choice:

- `Time::MAX_REASONABLE` caps a single value at 24 hours. Commands arrive from a REST API and from
  agents; without an upper bound an absurd value such as `i64::MAX` passes every other check and
  only misbehaves much further downstream.
- `Time` serialises transparently as a plain JSON integer, so `project.json` contains
  `705600000`, not an object.

## The `.videola` container

**Built, in part.** The format is a ZIP. What the writer produces today is the manifest, the model
and the media:

```
project.videola  (ZIP)
├─ videola.json          schemaVersion, appVersion, projectId, title,
│                        created, modified, locale
├─ project.json          the model
└─ media/<sha256>.<ext>  the media files
```

The design also reserves entries for embedded fonts, a preview image and video, and — separated from
everything above — regenerable caches: proxies, timeline thumbnails, audio peaks and an optional
undo history. Those are planned; nothing writes or reads them yet. The separation is what makes a
"slim save" possible: drop the regenerable half and the file is small enough to share, and still
opens everywhere. [The `.videola` format](/guide/videola-format) documents the whole layout in
detail.

Media is **content-addressed**: a file's entry name is the SHA-256 hash of its own bytes, and its
`MediaId` is that same hash with a `med_` prefix. This buys several things at once. The same file
imported twice is stored once. Media identity is stable across saves, so a project diffs and syncs
sensibly instead of churning identifiers. And the reader can verify what it loaded — if an entry's
bytes do not hash back to the name it is filed under, the entry has been tampered with or corrupted,
and the id in that name can no longer be trusted to mean what it claims.

Content addressing also removes a whole class of path handling. The entry name is derived, never
taken from user input, so a hostile `originalName` cannot steer a file out of `media/`.

## Effects: one shader, several execution sites

**Built for WebGL2, with two effects.** There is an effect registry, a GLSL shader per effect, and a
compositor that runs the chain and mixes a transition — see [Effects and
transitions](/guide/effects-and-transitions) for how one is written and what it may rely on. What is
below is the shape the shaders take once a second compositor exists.

The intended design is the same "write it once" rule applied to rendering. An effect is two files: an
`effect.json` describing its parameters, its bilingual labels and its UI hints, and a `shader.wgsl`
holding the actual pass. WGSL was picked because it runs unchanged in two of the three places it is
needed:

```
              effect.json + shader.wgsl
                          │
        ┌─────────────────┼─────────────────┐
   WebGPU              WebGL2              wgpu
  (browser)      (fallback, GLSL)   (native and server)
```

Browser WebGPU consumes WGSL directly. Rust `wgpu` consumes the same file. For WebGL2 a build step
transpiles WGSL to GLSL with `naga`, which is part of wgpu — so the fallback is generated from the
same source rather than written alongside it.

The WebGL2 fallback is not optional. WKWebView on macOS and iOS does not support WebGPU reliably,
and those are two of the six targets.

The payoff is that an effect is authored once and no FFmpeg filter graph has to be rebuilt to match
it. Transitions fall out of the same mechanism: a transition is an effect with two inputs and a
`progress` parameter, not a second subsystem.

## What is built and what is planned

| Piece | State |
|---|---|
| Project model, 20 commands, undo/redo | built |
| `.videola` manifest, `project.json`, content-addressed media | built |
| Regenerable cache entries (proxies, thumbnails, peaks, history) | planned |
| WASM bindings, ts-rs generated types, TypeScript facade | built |
| Theme, German and English catalogues, layout detection, app shell | built |
| Native linking of the core into the Tauri shell and a server | planned |
| Timeline UI, preview, playback, audio graph | planned |
| Effect registry, GLSL shaders, WebGL2 compositor, brightness and cross dissolve | built |
| Shared WGSL sources, WebGPU and `wgpu` compositors | planned |
| Export in any form; FFmpeg | planned |
| REST API, MCP server, generated command catalogue | planned |
| Template mode (`.videolat`, gallery, wizard) | planned |
