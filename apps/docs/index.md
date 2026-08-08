---
layout: home
hero:
  text: A video editor built on a Rust core
  tagline: >
    Drop a video in, cut it on the timeline, press play and watch it. Effects, keyframes and
    export are not in the surface yet.
  image:
    src: /videola-logo.webp
    alt: Videola
  actions:
    - theme: brand
      text: Downloads
      link: https://github.com/fgilde/videola/releases
    - theme: alt
      text: Documentation
      link: /guide/getting-started
    - theme: alt
      text: Source
      link: https://github.com/fgilde/videola
features:
  - title: Import, cut, play
    details: >
      Drag a video onto the window or pick it from the button. It lands in OPFS under the hash of
      its own bytes, becomes a clip, and plays back through WebCodecs and a WebGL2 compositor with
      the audio clock in the lead.
    link: /guide/editing
    linkText: Editing
  - title: One pointer path for mouse and touch
    details: >
      Dragging, trimming, scrubbing, pinch-zoom and long-press all run through Pointer Events, so
      the phone is not a second implementation. Hit areas grow to 44 px when the pointer is not a
      mouse.
    link: /guide/editing#the-timeline
    linkText: Gestures
  - title: One model, written once
    details: >
      The project model, the command bus and the .videola reader and writer live in
      videola-core, a Rust crate. The browser drives the same crate through WASM, so there is no
      second model in TypeScript to keep in step.
    link: /guide/architecture
    linkText: How it fits together
  - title: Undo from diffs
    details: >
      Applying a command produces a JSON-Patch and its inverse. Undo replays the inverse, so no
      command carries a hand-written reverse operation that can drift out of step with it.
    link: /guide/commands-and-undo
    linkText: Commands and undo
  - title: Integer time
    details: >
      Positions and durations are flicks, not float seconds. One second is 705,600,000 flicks,
      which divides evenly into every frame rate and audio sample rate the editor will meet.
    link: /guide/architecture#time-is-an-integer
    linkText: Why flicks
  - title: A project file you can open with unzip
    details: >
      .videola is a ZIP holding a manifest, project.json and the media files, each named after
      the SHA-256 hash of its own bytes. Reader and writer round-trip it losslessly.
    link: /guide/videola-format
    linkText: The container layout
  - title: Types generated, not transcribed
    details: >
      ts-rs derives the TypeScript model types from the Rust types, and CI fails if the committed
      output no longer matches the source.
    link: /guide/architecture#the-typescript-facade
    linkText: The facade
  - title: Web, desktop and Docker
    details: >
      One codebase produces the Vite web app, a Tauri shell with Windows, Linux and macOS
      installers, and an image that serves the web app over nginx.
    link: /guide/building-and-releasing
    linkText: Building and releasing
---

## What works today

- **Editing.** Import by drag-and-drop or file picker, move and trim clips across tracks, scrub,
  split and delete, snap to clip edges and the playhead, zoom from frames to the whole project.
- **Playback.** WebCodecs decoding into a WebGL2 compositor, with the audio clock in the lead and a
  transport for play/pause, frame stepping and jumping to either end.
- **Effects and transitions.** A brightness effect and a crossfade, resolved from keyframes in the
  Rust core so the preview and any later export read the same values.
- **The Rust core.** `videola-core` holds the project model, a bus of 26 commands, undo and redo
  built from JSON-Patch diffs, and the `.videola` reader and writer.
- **One pointer path.** Mouse, pen and touch take the same code; hit areas grow to 44 px when the
  pointer is not a mouse.
- **Packaging.** A Tauri shell that builds Windows, Linux and macOS installers, and a Docker image
  that serves the web app as static files.

## What is not there yet

No export, so nothing can leave the application yet. No inspector, no media library, no templates.
FFmpeg is not integrated, and the Android and iOS release jobs are skipped until signing keys are
configured. The [HTTP API and the MCP server](/guide/api-and-mcp) do exist, but with no renderer
behind them an agent can edit a project and save it — it cannot see a frame.

The [architecture chapter](/guide/architecture) marks, decision by decision, which parts of the
design are built and which are planned.

## The editor

<figure class="shot">
  <img src="/editor-preview.png" alt="The Videola editor: a decoded video frame in the preview, a transport showing 00:00:00.00 of 00:00:02.00 with the pause button active, and a clip named fixture.mp4 on track V1">
  <figcaption>A real frame, decoded and composited in the browser. The screenshot is taken by a test that builds the application, drives it in headless Chrome and drops a video file into it — the same run that caught a preview canvas which never grew past its intrinsic size.</figcaption>
</figure>

Theme and language switch without a reload. Every user-visible string comes from a catalogue,
including the errors the Rust core reports as codes.

<section class="sibling">
  <a class="sibling-card" href="https://www.audiola.de" target="_blank" rel="noreferrer">
    <img src="/audiola-logo.webp" alt="Audiola" width="180" height="180" loading="lazy">
    <div class="sibling-copy">
      <p class="sibling-kicker">From the same workshop</p>
      <h2>Audiola</h2>
      <p>The audio tool next door — and where Videola's own audio work comes from.</p>
      <span class="sibling-cta">audiola.de →</span>
    </div>
  </a>
</section>
