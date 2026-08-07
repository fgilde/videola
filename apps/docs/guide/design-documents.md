# Design documents

These are the original records the project was built from. **They are written in German** and are
linked rather than copied, so that the record stays the record.

## The design specification

[`docs/superpowers/specs/2026-08-07-videola-design.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/specs/2026-08-07-videola-design.md)

The architecture document, agreed at the end of the brainstorming phase. It covers the requirements it
was written against, the technical decisions and their reasoning, the data model, the command bus, the
rendering and playback design, the effect and plugin system, the template format, packaging, the test
strategy, the code conventions and the roadmap from M0 to M8.

Read it as a statement of intended scope, **not as a description of what exists**. It describes a
finished editor with a timeline, playback, an effect library, an audio tool chain, a template mode and
a REST and MCP API. Almost none of that is built. [Architecture](/guide/architecture) marks which
parts are real; the sections of the specification with no counterpart there are design, not code.

The English account of the decisions that actually shape the current code is
[Architecture](/guide/architecture). It is derived from this document rather than a translation of it.

## The implementation plans

[`docs/superpowers/plans/2026-08-07-videola-m0-skeleton.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/plans/2026-08-07-videola-m0-skeleton.md)

The M0 plan: the monorepo, `videola-core` with the model, the commands, undo and the `.videola`
reader and writer, the WASM bindings and generated types, and the application shell with theme and
internationalisation. This is the milestone that is actually finished, so the plan is close to a
description of the code as it stands.

[`docs/superpowers/plans/2026-08-07-videola-m7-packaging.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/plans/2026-08-07-videola-m7-packaging.md)

The M7 plan: the Tauri shell, the six build targets, the release workflow, the signing and
notarisation secrets, and the Docker image. It was carried out before M1 to M6, so packaging exists
while the editor it packages does not. [Building and
releasing](/guide/building-and-releasing) describes the result.

[`docs/superpowers/plans/2026-08-07-videola-m1-editor.md`](https://github.com/fgilde/videola/blob/main/docs/superpowers/plans/2026-08-07-videola-m1-editor.md)

The M1 plan: media import into OPFS, a timeline, a WebGL2 compositor and audio graph in a new
`@videola/engine` package, one keyframeable effect and transition, and MP4 export through WebCodecs.
This one is not implemented yet, so it is the clearest statement of what comes next. It also records
three deliberate departures from the specification and why — WebGL2 before WebGPU, media in OPFS
instead of WASM memory, and no golden-frame test until a second compositor exists to compare against.
