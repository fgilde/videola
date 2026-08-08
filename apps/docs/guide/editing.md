# Editing

This page describes what the editing surface does today. Anything not listed here does not exist
yet — there is no effect, keyframe, inspector or export in the application.

![The editor with a decoded frame in the preview](/editor-preview.png)

## Getting media in

Two ways, both doing the same thing:

- Drag one or more files anywhere onto the window.
- Press **Import media** in the header.

The bytes are hashed with SHA-256 and written to OPFS under that hash before anything is
dispatched, so a medium is on disk before the project refers to it. Importing the same file twice
stores it once. A clip is placed on the first video track; if the project has none, one is created.

An untouched project adopts the format of its first medium, because M1 has no command that sets a
clip transform — a 640×360 clip in a 1080p project would otherwise sit as a small rectangle in the
corner.

## The media library

Everything the project holds, with its length, its size in pixels and its sample rate. **Add to
timeline** puts a medium behind whatever is already on the first track of its kind — the same place
an import lands, so a medium can be placed as often as you like without importing it again.

There are no thumbnails and no waveform. `packages/media` computes neither, and a grey rectangle
where a picture belongs would be a promise the application cannot keep.

### When the bytes are gone

Media live in OPFS, which belongs to the browser and the origin, not to the project file. Open a
project on another machine — or in another browser — and the library entries are there while their
bytes are not. Such an entry is marked **Data missing**, cannot be placed on the timeline, and
offers **Relink**.

Relinking asks for the file and checks it: the id of a medium *is* the SHA-256 of its content, so
only the same file is accepted. Another file would be a different medium wearing this one's name,
and every clip pointing at it would quietly show the wrong picture.

## The timeline

| Gesture | Result |
|---|---|
| Click a clip | selects it |
| Drag the middle of a clip | moves it, across tracks too |
| Drag a clip edge | trims that edge |
| Drag in the ruler | scrubs |
| Two pointers | zooms by the change in distance |
| Long press | opens the context menu — split at the playhead, delete |

Everything runs through Pointer Events, so mouse, pen and finger take the same path. When the
pointer is not a mouse the trim zones grow to 44 px, because a 4 px target at the end of a clip is
not reachable with a finger.

A whole drag — two hundred pointer moves — is **one** undo step. The commands carry a coalesce key
that `pointerdown` sets and `pointerup` drops.

### Snapping

**Snap** in the toolbar toggles it. Candidates are the playhead, every clip edge on every track,
markers and a grid. The catch radius is computed in pixels and converted to flicks, never the other
way round, so it stays the same size on screen at every zoom level. Holding a modifier during a
drag suspends it.

### Zoom

Zoom is flicks per pixel. The lower bound rises with project length: the content element is as wide
as the whole project, and browsers stop honouring element widths above roughly 33 million pixels —
past that the timeline would silently truncate instead of scrolling. Zooming out far enough merges
runs of clips too thin to tell apart into a single box, which is what keeps the node count tied to
the viewport instead of the material.

## Playback

The transport gives you start, frame back, play/pause, frame forward, end, and a timecode read from
the project's frame rate. <kbd>Space</kbd> toggles playback and the arrow keys step frames; both
listen on the window, so they work while the focus is in the timeline.

The audio clock leads and the picture follows, because audio drift is audible and a dropped frame
is not. Frame rates stay rational to the last division — 30000/1001 is not 29.97, and a frame step
built from the decimal drifts off the ruler within a few hundred frames.

Browsers start an `AudioContext` suspended and only allow it to resume after a user gesture, so the
first press of play does slightly more work than the ones after it.

## On a phone

![The media library on a phone, with the preview staying above it](/phone-library.png)

Below 768 px the editor switches to a single column: the preview and the transport stay at the top,
and a tab bar underneath swaps between **Media** and **Timeline**. The picture has to stay visible
while you work below it, and 390 px cannot hold a library, a preview and a timeline side by side
without all three being useless.

Two tabs, not the six the design sketch names. Effects, text, audio and export have no panel yet;
a tab that opens nothing is worse than a tab that is not there, and each one joins the bar on the
day its panel does.

The panel that is not showing is unmounted rather than hidden. The timeline windows its clips by
the width it measures, and a `display: none` container measures zero — it would come back empty.

Nothing else changes. The same Pointer Events path carries mouse, pen and finger, the touch targets
were already 44 px, and every action reachable on a desktop is reachable here.

## Saving

**Save** writes a `.videola` file: a ZIP holding a manifest, `project.json` and every referenced
medium, each named after the hash of its own bytes. **Open** reads it back. The media come from
OPFS, so a saved project carries its footage with it rather than pointing at paths on your machine.

## What is verified, and what is not

The compositor is checked against real pixels in headless Chrome, the timeline against real browser
layout, and the application itself against a real dropped video — 173 checks in three harnesses
that run without Playwright.

The phone layout is driven at a real 390×844 viewport at twice the pixel density, over the devtools
protocol: Chrome on Windows refuses a window narrower than 500 CSS pixels, so `--window-size` alone
would have measured a small tablet and called it a phone. Import, a finger drag, undo, both tabs and
playback are checked there, and the screenshots above come out of that run.

Not verified: lip-sync, because headless Chrome has no audio output; sustained frame rate at 1080p;
and pixel readback at phone size — the drawing buffer is gone once the page has composited it, and
the phone run needs the wall clock for its layout to be trustworthy. The screenshot is the evidence
that the preview decodes there.
