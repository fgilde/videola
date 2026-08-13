---
title: Downloads
description: Videola for Windows, macOS, Linux, Android and iOS — and in the browser.
---

# Downloads

Videola runs in the browser with nothing installed. The desktop builds are the same editor in a
window of its own: they open and save files through the operating system's own dialogues, remember
where they were, and can check for an update.

<Downloads lang="en" />

## What a build can and cannot do

Every build carries the whole editor: the timeline, the effects, the mixer, the templates, the API
and the MCP server. None of them bundles FFmpeg — the export runs on the browser engine's own
encoders, which is also why a Docker container can serve the editor but cannot render for you.

The macOS disk image is unsigned unless an Apple certificate was configured for the release, so
Gatekeeper will refuse it until you allow it by hand. Android and iOS assets exist only for releases
built with their signing keys; where a key is absent the job is skipped rather than shipping
something that cannot be installed. [Building and releasing](/guide/building-and-releasing) has the
whole table.

## On a server

The four packaged ways to run it on your own hardware — Docker, Unraid, Umbrel and a Proxmox script that
makes the container for you — are in [Running it yourself](/guide/self-hosting). Every release also
carries a **server bundle** that needs nothing but Node 22: no dependencies to install, because they are
already bundled into the entry points.

One thing worth knowing before you start: the server refuses to listen on anything but loopback without a
token. That is deliberate, and the installers generate one for you.
