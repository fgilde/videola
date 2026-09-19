---
layout: home
hero:
  text: Cut video in your browser
  tagline: >
    Drop your clips in — or paste a YouTube link and pull the video straight down. Cut it, colour
    it, mix the sound, export an MP4. Nothing is uploaded: your footage stays on your machine.
  image:
    src: /videola-logo.webp
    alt: Videola
  actions:
    - theme: brand
      text: Try it now
      link: https://video.nksoft.de/
    - theme: alt
      text: Downloads
      link: /download
    - theme: alt
      text: What it can do
      link: /guide/features
    - theme: alt
      text: Source
      link: https://github.com/fgilde/videola
features:
  - title: Import from YouTube and a thousand other sites
    details: >
      Drag your own files onto the window, or paste a link — or just search. Videola pulls the
      video down and you pick the format and quality first. Works for YouTube, Vimeo, TikTok and
      most sites yt-dlp knows; you need the Videola server running for it.
    link: /guide/editing#getting-media-in
    linkText: Importing
  - title: Your footage never leaves your machine
    details: >
      No upload, no account, no project sitting on someone else's server. Files go into your
      browser's own storage and stay there until you decide to publish.
    link: /guide/editing
    linkText: How it works
  - title: Cuts, trims and everything around them
    details: >
      Ripple, roll, slip, slide, groups, markers, snapping, copy and paste of attributes — and the
      same gestures work with a finger on a phone.
    link: /guide/editing#the-timeline
    linkText: The timeline
  - title: Keyframes without the busywork
    details: >
      Switch on record, move the playhead, change something. Videola writes the keyframes for you
      and keeps everything before your change exactly as it was.
    link: /guide/editing#recording-keyframes
    linkText: Keyframes
  - title: Colour and sound finished in the editor
    details: >
      Scopes, curves, colour wheels and your own LUTs. A mixer with EQ, compressor, limiter,
      loudness to broadcast target, ducking and noise reduction that learns from the pauses in your
      own recording.
    link: /guide/audio
    linkText: Sound
  - title: Effects you can see before you pick one
    details: >
      Sixteen effects and seven transitions, and every tile in the browser shows your frame with
      that effect on it. Anything you set can be animated.
    link: /guide/effects-and-transitions
    linkText: Effects
  - title: Publish without leaving the editor
    details: >
      Send the finished file to YouTube, Vimeo, PeerTube, Mastodon, Bluesky, Telegram, a Facebook
      page or any address of your own. Bluesky needs nothing but an app password.
    link: /guide/self-hosting#destinations
    linkText: Destinations
  - title: Browser, desktop, phone, your own server
    details: >
      One codebase: a web app you can install, Windows, macOS and Linux builds, and a Docker image
      for your NAS. Unraid, Umbrel and Proxmox have ready-made installs.
    link: /guide/self-hosting
    linkText: Running it yourself
---

## What you can do with it today

### Editing

Everything you expect from a timeline: ripple delete, trim, roll, slip and slide, multi-selection,
groups, a clipboard, markers, snapping and zoom. Lock a track and nothing on it moves. Fold a
selection into one compound clip and grade or fade the whole thing at once.

Undo covers all of it, including a hundred-step drag, which counts as one.

### The picture

Play back frame by frame, scrub, or run J/K/L at speed. Drag the clip around on the picture itself —
the box on the frame is the real geometry, not a handle drawn near it. Freeze a frame, ramp the
speed, add motion blur that follows the actual movement.

Dropped a camera card with a dozen takes in one file? Videola can find the cuts for you and split
them in a single step.

### Sound

A mixer with volume, pan, mute and solo, live meters, fades, EQ and dynamics. Stereo or 5.1 with a
real position per track. Loudness normalisation to EBU R128, ducking under a voice, silence cutting,
a marker on every beat, and spectral noise reduction learned from the quiet parts of your own clip.

### Getting things in and out

- **In:** your own files, a YouTube link or a search, images, subtitles as SRT or WebVTT, LUTs as
  `.cube`, and mixes from [Audiola](https://www.audiola.de).
- **Out:** MP4 or WebM with progress and a cancel that works. Or hand the cut on as an EDL, FCPXML
  for Resolve and Final Cut, or the XML Premiere Pro imports as a real sequence.
- **Another shape in one press:** portrait, square or 4:5, with every clip rescaled to fill the new
  frame.
- **Fifteen templates** — lower thirds, countdowns, picture-in-picture and the rest. They draw
  themselves, so nothing here is stock footage with a licence attached.

### Where it runs

In a browser that can be installed as an app and opens offline. As a desktop build for Windows,
macOS and Linux. As a Docker image on your own machine, with one-click installs for Unraid, Umbrel
and Proxmox. On a phone and a tablet, with the panels taking turns where there is no room.

There is also an HTTP API, an MCP server and a CLI, so an agent can cut and export without a
browser at all.

## What is missing

No magnetic timeline — that is a decision, and the [editing chapter](/guide/editing) explains it.
FFmpeg is not bundled either; exports use the browser's own encoders.

The [architecture chapter](/guide/architecture) says, decision by decision, what is built and what
is planned.

## Built out in the open

Videola is GPL-3.0 and the whole thing is on [GitHub](https://github.com/fgilde/videola). The model
lives in a Rust crate that the browser drives through WebAssembly, so the preview and the export
work from exactly the same numbers. Every screenshot on this site is taken by a test that builds the
app, drives it in a real browser and measures what it sees.

<figure class="shot">
  <img src="/editor-desktop.webp" alt="The Videola editor: a decoded video frame in the preview, a transport showing 00:00:00.00 of 00:00:02.00 with the pause button active, and a clip named fixture.mp4 on track V1">
  <figcaption>A real frame, decoded and composited in the browser — from the run that builds the application, drops a video into it and reads the result back off the canvas.</figcaption>
</figure>

Theme and language switch without a reload, and every word you see, errors included, comes from a
catalogue rather than from the code.

<section class="sibling">
  <a class="sibling-card" href="https://www.audiola.de" target="_blank" rel="noreferrer">
    <img src="/audiola-logo.webp" alt="Audiola" width="180" height="180" loading="lazy">
    <div class="sibling-copy">
      <p class="sibling-kicker">From the same workshop</p>
      <h2>Audiola</h2>
      <p>The audio tool next door — and where Videola's own sound work comes from.</p>
      <span class="sibling-cta">audiola.de →</span>
    </div>
  </a>
</section>
