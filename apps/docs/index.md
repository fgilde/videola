---
layout: home
hero:
  text: A video editor built on a Rust core
  tagline: >
    Import, cut, keyframe, mix and export — in a browser, on a desktop, a tablet or a phone.
    With an HTTP API and an MCP server for agents.
  image:
    src: /videola-logo.webp
    alt: Videola
  actions:
    - theme: brand
      text: Downloads
      link: /download
    - theme: alt
      text: What it does
      link: /guide/features
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

- **Editing** — ripple delete and trim, roll, slip, slide, multi-selection, groups, clipboard,
  markers, snapping and zoom, paste attributes, with one pointer path for mouse, pen and finger.
  Lockable tracks,
  enforced by a single gate in front of the whole command dispatch.
- **Compound clips** — fold a selection into one clip; the picture is proven not to change. Fade,
  blend, grade, crop or dissolve the compound and it is isolated on a surface of its own first, so
  all five meet the composed group once rather than each clip in it.
- **Playback** — WebCodecs into a WebGL2 compositor, audio clock leading, frame-accurate transport.
- **Geometry on the picture** — a box on the frame with corner and rotation handles, its corners
  computed from the very matrix the compositor hands the GPU, and the motion path a series of
  position keys traces, sampled from the core rather than drawn corner to corner.
- **Effects and transitions** — eight effects, seven transitions (any of them on every cut in one
  choice), masks, a text generator, colour
  curves and lift/gamma/gain wheels, chosen from a browser whose every tile is that effect's own
  shader over the current frame. Every parameter keyframable, including a clip's position, scale and
  rotation, all resolved in the Rust core so the preview and the export read the same values.
- **Colour and sound finishing** — waveform, vectorscope and histogram; curves, lift/gamma/gain and
  `.cube` lookup tables that travel inside the project file; a mixer with live meters,
  EQ, low cut, high cut, compressor and limiter, loudness normalisation, ducking, silence detection and a marker on
  every beat.
- **Subtitles** — SRT and WebVTT in and out, on a caption track of their own.
- **Classical editing** — freeze frames, in and out points, insert and overwrite, J/K/L, adjustment
  tracks, speed
  ramps whose time mapping is an integral rather than a multiplication.
- **Proxies** — anything taller than 720 pixels is transcoded once into a 720p copy the preview
  decodes; the export always reads the original, proven on the written file by ffprobe and ffmpeg.
- **Audio** — mixer with volume, pan, mute and solo, fades as automation, waveforms, EBU R128
  loudness checked against the Tech 3341 cases.
- **Export** — MP4 or WebM in a worker, with progress and a cancel that stops it.
- **Another shape in one press** — portrait, square or 4:5, with every clip scaled to cover the new
  frame in the same undo step.
- **Templates** — a gallery, a wizard, and a bake that leaves you with an ordinary project.
- **An API, an MCP server and a CLI** — the whole command catalogue, generated from the Rust enum,
  plus stills and audio peaks so an agent can look at what it just did.
- **Installable and offline** — a manifest and a service worker: the browser build installs as an
  application, opens without a network, and offers a reload when a new build is waiting.
- **Self-hosting** — one Node process serving the editor, the API, MCP and the CLI.
- **Phone, tablet and desktop** — the same code, panels taking turns where there is no room.

## What is not there yet

No motion blur. No noise reduction: the low and high cut take away a band, which is not the same as
separating a voice from noise sharing its band. A curve is copied across one parameter's own track
and no further — two tracks' keys need not line up. The magnetic timeline is deliberately absent, and
the [editing chapter](/guide/editing) argues why. FFmpeg is not bundled; the export uses the
browser's own encoders.

The [architecture chapter](/guide/architecture) marks, decision by decision, which parts of the
design are built and which are planned.

## The editor

<figure class="shot">
  <img src="/editor-desktop.webp" alt="The Videola editor: a decoded video frame in the preview, a transport showing 00:00:00.00 of 00:00:02.00 with the pause button active, and a clip named fixture.mp4 on track V1">
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
