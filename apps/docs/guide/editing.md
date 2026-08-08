# Editing

This page describes what the editing surface does today. Anything not listed here does not exist
yet — there is no export in the application.

![The editor with a decoded frame in the preview](/editor-preview.png)

## Getting media in

Two ways, both doing the same thing:

- Drag one or more files anywhere onto the window.
- Press **Import media** in the header.

The bytes are hashed with SHA-256 and written to OPFS under that hash before anything is
dispatched, so a medium is on disk before the project refers to it. Importing the same file twice
stores it once. A clip is placed on the first video track; if the project has none, one is created.

An untouched project adopts the format of its first medium, so a 640×360 clip does not sit as a
small rectangle in the corner of a 1080p frame. Past that point the format is a decision somebody
made, and **Fit to frame** in the inspector is how a later clip is brought up to it.

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
that `pointerdown` mints; the next `pointerdown` mints another one. The inspector's sliders work the
same way, and it is the same rule that makes a slider drag over a keyframed parameter one entry on
the undo stack instead of two hundred keyframes on the same spot.

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

## The inspector

Selecting a clip opens its properties beside the picture. Every control sends a command; the
inspector holds no state of its own.

| Group | What it does |
|---|---|
| Transform | position, scale, rotation, opacity, and **Fit to frame** |
| Sound and speed | clip volume, playback rate, and a reverse switch |
| Transition | a cross dissolve on the clip's incoming edge, and its length |
| Effects | add an effect, then one row per parameter |

`clip.setTransform` carries the whole structure, so a row reads the clip's current transform,
replaces its own field and sends it back. Anchor and crop have no row: both are fractions of the
source with nothing on screen to grab, and they wait for an on-canvas handle rather than getting a
slider that nobody can aim.

There is no row for the audio fades. The model carries them and the audio graph plays them, but no
command sets them — a slider there would write nothing.

### Keyframes

A parameter row of an **effect** carries a keyframe switch, arrows to the previous and next
keyframe, and — where one sits under the playhead — a picker for what happens after it: linear,
hold or ease. The switch sets a keyframe at the playhead or removes the one already there.

The value on the row is the one `Effect::param_at` gives for that moment, asked through
`doc.effectParamsAt`, never a calculation of its own. Interpolating in TypeScript would give the
preview and the export two different answers for the same frame.

Once a parameter is keyframed the slider writes keyframes rather than the static value, and it
writes them at the playhead. `keyframe.add` is an upsert, which is what makes a drag one undo step.
While the playhead stands outside the clip the keyframe controls are locked: a keyframe written
there is never evaluated for this clip, so the switch would report a state no picture ever shows.

**Only effect parameters have the switch.** `Clip::keyframes` exists in the model, but nothing
evaluates it — the draw list reads `clip.transform` statically. A switch on transform or volume
would write data no picture ever sees. Giving it one means sending `clip.transform` through the
same evaluation as an effect parameter, which is work in the core and in the engine rather than in
the surface.

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
and a tab bar underneath swaps between **Media**, **Timeline** and **Properties**. The picture has
to stay visible while you work below it, and 390 px cannot hold a library, a preview and a timeline
side by side without all three being useless.

Three tabs, not the six the design sketch names. Text, audio and export have no panel of their own;
a tab that opens nothing is worse than a tab that is not there, and each one joins the bar on the
day its panel does. **Properties** is the third because it carries effects, keyframes, transitions
and speed — while it sat as a strip between the transport and the tab bar it had a third of the
screen and still could not show a single effect, which made the phone a viewer rather than an
editor.

The panel that is not showing is unmounted rather than hidden. The timeline windows its clips by
the width it measures, and a `display: none` container measures zero — it would come back empty.

The same Pointer Events path carries mouse, pen and finger, and the touch targets are 44 px.

### The header

The topbar carries ten controls, which do not fit 390 px at 44 px each. The project actions — new,
template, open, import, add track — live behind the **☰** disclosure at the left, and on a phone
export, save and the language and theme switches join them. What stays on the bar is undo and redo,
the two a thumb reaches for constantly.

It is a `<details>` element rather than a menu built by hand: the open state, the keyboard handling
and the accessible name all come with it.

Before this the bar simply scrolled sideways. Every button stayed reachable in principle, and in
its resting state half of them sat outside the window — "Import medi…" cut off at the right edge.
No test saw it, because no test asked whether the bar fitted the window. One does now: at 390 px
its `scrollWidth` must equal its `clientWidth`.

### Camera and gallery

On a phone and a tablet the library offers **Record** and **From the gallery** beside **Import
media**. Both are ordinary `<input type="file" accept="video/*">`; the first adds
`capture="environment"`, which is what asks a phone for its rear camera instead of its file system.

That attribute is the whole feature, and it is as far as verification goes: a headless browser has
no camera and no gallery. The harness checks that the input is there with the right `accept` and
`capture`, that it is a 44 px target, and nothing beyond that. What a real phone does with it has
not been observed.

## On a tablet

![The editor on a tablet, two media on two tracks](/tablet.png)

Between 768 px and 1280 px — and on anything without a fine pointer, whatever its width — the
editor lays out in two columns: the media library down the left, the picture, the transport and the
properties panel stacked on the right, and the timeline across the bottom.

Two columns rather than the desktop's three, because a portrait tablet is short of width and long
on height. At 834 px, three panels side by side left the middle about 330 px — narrower than the
transport itself, which cut the timecode off mid-digit.

The library and the timeline are on screen together, and that is the point of the mode: it is what
lets you **drag a medium out of the library onto a track**, which a phone cannot offer because the
two never show at the same time. Press an entry, carry it over the timeline — the target track
lights up and a line shows where the clip would start — and let go. One command, so one undo step.
The **Add to timeline** button stays as well: a drag is not keyboard-operable, and it is the only
other way onto the timeline.

## Saving

**Save** writes a `.videola` file: a ZIP holding a manifest, `project.json` and every referenced
medium, each named after the hash of its own bytes. **Open** reads it back. The media come from
OPFS, so a saved project carries its footage with it rather than pointing at paths on your machine.

## What is verified, and what is not

The compositor is checked against real pixels in headless Chrome, the timeline and the inspector
against real browser layout, the application itself against a real dropped video, and the export
against ffprobe and ffmpeg — four harnesses that run without Playwright.

The keyframe chain is measured end to end in the last of those: brightness is put on the clip
through the surface, two keyframes are set through the surface, and the drawing buffer is then read
at three moments. Against the same three frames without the effect, the picture comes back at 0 at
the first keyframe, at half in the middle and at the original brightness at the second — the
interpolation is the core's, the pixels are the compositor's, and both halves run in one pass.

The phone layout is driven at a real 390×844 viewport at twice the pixel density, and the tablet at
834×1112, both over the devtools protocol with touch emulation on: Chrome on Windows refuses a
window narrower than 500 CSS pixels and clips the screenshot instead of scaling it, so
`--window-size` alone would have measured a small tablet and called it a phone. Import, a finger
drag, undo, every tab, an effect put on a clip and playback are checked on the phone; on the tablet,
two media on two tracks, the drag from the library onto a track, and that the picture, the transport
and the panels each get a box inside the window. The screenshots above come out of those runs.

Thumbnails are checked as pictures, not as elements: the `<img>` must report a non-zero
`naturalWidth` at 160×90, the two media in the tablet run must differ from each other, and a still
must not be one flat colour — a placeholder, a black frame and a failed decode all fail that.

Not verified: lip-sync, because headless Chrome has no audio output; sustained frame rate at 1080p;
what a real camera or gallery does with `capture`, because a headless browser has neither; pixel
readback at phone size — the drawing buffer is gone once the page has composited it, and the phone
run needs the wall clock for its layout to be trustworthy, so the screenshot is the evidence that
the preview decodes there; and a transition set through the inspector has never been drawn, because
a cross dissolve needs two overlapping clips over the same cut.
