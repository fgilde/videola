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

## Saving

**Save** writes a `.videola` file: a ZIP holding a manifest, `project.json` and every referenced
medium, each named after the hash of its own bytes. **Open** reads it back. The media come from
OPFS, so a saved project carries its footage with it rather than pointing at paths on your machine.

## What is verified, and what is not

The compositor is checked against real pixels in headless Chrome, the timeline and the inspector
against real browser layout, and the application itself against a real dropped video — 182 checks in
three harnesses that run without Playwright.

The keyframe chain is measured end to end in the last of those: brightness is put on the clip
through the surface, two keyframes are set through the surface, and the drawing buffer is then read
at three moments. Against the same three frames without the effect, the picture comes back at 0 at
the first keyframe, at half in the middle and at the original brightness at the second — the
interpolation is the core's, the pixels are the compositor's, and both halves run in one pass.

Not verified: lip-sync, because headless Chrome has no audio output; sustained frame rate at 1080p;
the phone layout with a live preview; and a transition set through the inspector has never been
drawn, because a cross dissolve needs two overlapping clips and the harness drops one file.
