# Editing

This page describes what the editing surface does today. Anything not listed here does not exist
yet.

![The editor with a decoded frame in the preview](/editor-desktop.webp)

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

Each entry carries a thumbnail decoded from the file itself, and audio clips draw their waveform
from the buffers the graph already decoded — no second decode, and a reversed clip shows itself the
way it plays.

### When the bytes are gone

Media live in OPFS, which belongs to the browser and the origin, not to the project file. Open a
project on another machine — or in another browser — and the library entries are there while their
bytes are not. Such an entry is marked **Data missing**, cannot be placed on the timeline, and
offers **Relink**.

Relinking asks for the file and checks it: the id of a medium *is* the SHA-256 of its content, so
only the same file is accepted. Another file would be a different medium wearing this one's name,
and every clip pointing at it would quietly show the wrong picture.

### Proxies

Material taller than 720 pixels is transcoded once, in a worker of its own, into a smaller copy
that the preview decodes instead of the original. The entry says **Building proxy** while that is
happening and **Proxy** once it is there. One medium at a time: three at once would take three
times as long to deliver the first, and the first is the one being waited for.

The copy is 720 pixels tall, H.264, with a key frame every second, and carries no sound. Each of
those is one number rather than a preference:

| Choice | Why |
|---|---|
| 720 pixels tall | A decoded frame costs width × height × 4 bytes whatever the file was compressed to. The 256 MiB frame cache holds 8 frames of 4K, 32 of 1080p and 72 at 720p — so a step back finds the frame in memory instead of decoding a whole group of pictures again. |
| H.264 | The one codec with hardware decoding on every machine that runs a browser. A machine that cannot *encode* it simply gets no proxy. |
| A key frame every second | Playback restarts at the key frame before the instant asked for. A camera file with 250 frames between key frames costs 250 decodes for one step backwards; this costs at most a second's worth, whatever the camera did. |
| No audio track | Sound always comes from the original, decoding it was never the expensive part, and leaving it out makes the proxy quicker to build and smaller to keep. |

The frame rate and the length are deliberately untouched. A proxy on another timebase would put
every source time the timeline hands out on the wrong picture.

**The export never reads a proxy.** Neither does a still, nor anything else that produces a file:
what is written is decoded from the original at full resolution, whatever is on screen while you
cut. That is checked on a real written file by `ffprobe` and `ffmpeg`, with a deliberately wrong
proxy sitting on disk while the file is written.

A proxy is stored beside the original in OPFS, under the original's own content hash, and never
enters the library: it has no media id, is never written into a `.videola`, and cannot be relinked
to. A medium whose proxy is missing behaves exactly like one that never had a proxy — the original
is decoded, and only the speed is gone.

**Use originals** in the library toolbar switches the preview back to the material. It changes what
is decoded, not what is displayed: every open decoder is closed and reopened on the file the switch
now names.

## In and out points

The classical cut is three points: where the material starts, where it ends, and where on the
timeline it goes. The **scissors** button beside a library entry arms that medium and opens the
**source bar** under the transport.

| Key | Result |
|---|---|
| <kbd>I</kbd> | marks the in point at the source position |
| <kbd>O</kbd> | marks the out point there |
| <kbd>,</kbd> | inserts the marked range at the playhead |
| <kbd>.</kbd> | overwrites with it at the playhead |

The four keys listen on the window, like the transport's, so they work while the focus is in the
timeline. All four have buttons beside them: a finger has no keyboard, and a range marked with the
scrub bar and placed with two buttons is the same edit.

Nothing marked means the whole medium, which is what a clip nobody has trimmed yet is. An out point
at or before the in point is not a range and the two buttons are disabled — the surface can see
that, so it does not send a command for the core to refuse and the banner to report.

The range lands on the track the selected clip is on. With nothing selected it lands on the first
track the material belongs on, which is the rule an import already follows, and where there is no
such track one is made. The playhead moves to the end of what was placed, so a run of edits stacks
up instead of laying every take over the one before it.

The source bar has no picture. Scrubbing one needs a decoder per position and a second compositor
beside the one drawing the timeline, which is a monitor rather than a control; what is here is the
timecode, and the poster the library shows says which medium it belongs to.

### What insert and overwrite each promise

**Insert** opens a gap at the playhead the length of the range and moves everything from there on
back by exactly that much — on **every** track, not only the one being edited. That is the one thing
an insert must never get wrong: sound and picture are separate tracks, and a gap that opened on only
one of them would put the timeline out of step from that point on for the rest of the film. A clip
that reaches across the insertion point is cut in two first, and the far half reads on from where
the near half stopped, so taking the material back out again leaves a cut nobody can see. Groups
travel whole, across tracks included.

**Overwrite** places the range at the playhead and lets it replace whatever occupied that span, on
the one track named. Nothing moves, so the timeline keeps the length it had unless the material
reaches past the old end. A clip the span falls wholly inside is left as a head and a tail; a clip
the span merely clips is cut back to the edge; a clip it covers is gone, and its transition goes
with it — a dissolve belongs to the edge it was authored on, and that edge no longer exists.

Both are **one** command, so both are one step on the undo stack however many clips moved. An insert
across three tracks and a dozen clips is a single <kbd>Ctrl</kbd>+<kbd>Z</kbd>.

One thing they do not do: markers do not ripple. They keep their absolute positions.

A locked track refuses both of them outright, and it does not matter which track was named. An
insert opens the gap on **every** track, so skipping the locked one would move the picture out from
under its own sound — the one thing the operation exists to prevent. Refusing is the honest answer;
unlock the track and edit, or leave it alone.

## Cutting at the markers

The marker list carries one action of its own: cut every clip the markers pass through. With beats
marked on a music track that is "cut on the beat" in one press — and one step in the history,
however many cuts it made.

It is applied one cut at a time against the live document, because a list of commands built up front
cannot be right: a split mints two clips out of one, so the second cut through the same clip would
name an id the first has already retired. Each clip is found again by where it sits, immediately
before it is cut.

A marker sitting exactly on an existing cut has nothing to do and is passed over rather than asked
about, and so is a locked track — the core would refuse it either way, and one locked track must not
take the other five with it.

## The picture is a control

Select a clip and a box appears on the frame with a handle on every corner and one to turn by.
Dragging inside it moves the shot, a corner scales it and the handle above the top edge rotates it —
on the picture, because that is where the answer is: a number in a panel says 1.4, and only the
picture says whether the face is still in shot.

The corners are not an approximation of where the clip lands. `clipQuad` in the engine and
`quadMatrix` — the matrix the compositor hands the GPU — are checked against each other over
translation, uneven scale, rotation, an off-centre anchor and every combination with a crop, so the
handles sit on the picture rather than near it.

| Gesture | Result |
|---|---|
| Drag inside the box | moves the clip, in project pixels whatever the pane is scaled to |
| Drag a corner | scales it, with the opposite corner staying exactly where it is |
| Drag a corner with <kbd>Shift</kbd> | scales each axis on its own instead of keeping the aspect |
| Drag the handle above the top edge | turns it about the middle of the picture |
| Turn with <kbd>Shift</kbd> | snaps to whole 15° steps |

A corner of a turned clip grows along the edge it is on rather than along the screen, and a rotation
is the angle between where the handle was grabbed and where the pointer is now — not a delta anyone
accumulates, so a pointer that leaves the window and comes back lands where it is.

The whole drag is one step in the history, the same bargain the timeline's own drags make: the
coalescing key is minted on the way down and dropped on the way up, so a hundred pointer moves are
one <kbd>Ctrl</kbd>+<kbd>Z</kbd>. Every one of them goes through `clip.setTransform`, so the fields
in the properties panel move with the box and a keyframe set from either side means the same thing.

## Locked tracks

The padlock beside a track's name is a promise: nothing on that track moves until it is unlocked
again. It is enforced in the core, in one gate in front of the whole command dispatch rather than in
each of the twenty handlers that could edit a clip — a lock half the commands honoured would be
worse than no lock at all, and the next command anyone adds would be a hole nobody notices.

What it covers is the timeline: the clips on the track, their trims, their speed, their transforms,
their effects and keyframes, the track's own effect chain, and the track itself. What it leaves
alone is the mixer and the name — a locked track is still faded, panned, muted and soloed — and the
flags themselves, which is how a track is unlocked again.

The timeline does not wait for that refusal to arrive. A clip on a locked row is not a drag target
at all, so it never comes away from under the pointer and springs back; the row is hatched, and the
padlock beside its name says why.

## The timeline

| Gesture | Result |
|---|---|
| Click a clip | selects it, and the whole group if it is in one |
| Ctrl/Cmd or Shift click | adds a clip to the selection, or takes it out again |
| Drag the middle of a clip | moves the whole selection, across tracks when one clip is dragged |
| Drag a clip edge | trims that edge |
| Drag in the ruler | scrubs |
| Two pointers | zooms by the change in distance |
| Long press, right click | opens the context menu of the clip or the marker under the pointer |

A press inside a selection of several clips keeps it — otherwise the press that starts a drag would
have thrown away what it is about to move. Releasing without dragging narrows it to the one clip.

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

### Edge and clip modes

Two lists in the toolbar decide which command a drag sends. They are lists rather than modifier
keys because a finger has no modifiers, and because the mode has to be readable *before* the drag
rather than guessed from what it just did.

| Edge drag | What moves |
|---|---|
| **Trim** | that edge, and nothing else |
| **Ripple** | that edge, and every clip after it on the same track by the same step |
| **Roll** | the cut this edge shares with its neighbour: the pair keeps its total length |

| Clip drag | What moves |
|---|---|
| **Move** | the clip, along the track and across tracks |
| **Slip** | the material behind the clip, which stays where it is and keeps its length |
| **Slide** | the clip along the track, with the clips that meet it absorbing the step |

Roll refuses where no clip meets that edge, and every one of them refuses a step that would empty a
clip or read from before the start of the material. A refusal during a drag is ordinary: the edit
simply does not happen, and no error is reported for it.

A ripple of the *head* is the one that looks odd until you try it: the clip stays where it is and
its material moves, because leaving the clip glued to what is in front of it is the whole point of a
ripple. What the pointer changes there is the length, not the position.

### Deleting, cutting and pasting

| Key | Result |
|---|---|
| <kbd>Delete</kbd> | removes the selection and leaves the gap |
| <kbd>Shift</kbd>+<kbd>Delete</kbd> | removes it and closes the gap: every later clip on the track moves up |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> | copy, cut, paste at the playhead |
| <kbd>Ctrl</kbd>+<kbd>G</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> | group, ungroup |
| <kbd>N</kbd> | folds the selection into one compound clip |
| <kbd>M</kbd> | sets a marker at the playhead |

All of them sit in the clip's context menu as well, and an entry that cannot do anything — paste
with an empty clipboard, group with one clip selected — is disabled rather than sending a command
the core would refuse.

Ripple delete only moves what begins at or after the end of the deleted clip. A clip that reaches
across that end stays where it is: closing a gap must not create an overlap nobody authored.

The clipboard holds whole clips, not references — speed, transform, effects, keyframes and the
material offset travel with them. A paste puts the earliest one on the playhead and keeps the
spacing of the rest, on the track each came from where that track still exists. Ids are minted by
the core, so a clip pasted twice is two clips and not one clip mentioned twice.

Grouped clips are selected together and dragged together, and a group survives everything except
**Ungroup**. A pasted copy joins no group: it carries the original's material and look, not its
membership.

### Nesting

**Nest**, or <kbd>N</kbd>, folds the selected clips into a single *compound* clip. The compound
covers the span they occupied and lands on the lowest track any of them was on; inside it, the clips
keep their positions relative to each other and one nested track per track they came from — track
one is the bottom of the stack in there as much as out here.

Folding changes nothing about the picture or the sound. Nesting two clips and playing the result
gives back exactly the frames and the samples the two gave before, which is what the pixel and audio
checks assert against the render taken *before* the fold.

From there the compound is an ordinary clip: move it, trim it, give it a speed, put an effect on it.
Trimming it cuts what is inside — its in point and duration decide how much of the nested timeline
it consumes — and a speed on it retimes everything in it, backwards included. Nesting may go eight
levels deep; a ninth is refused rather than stored and then quietly not drawn.

A compound is **isolated**: its clips are composited onto a surface of their own, and its opacity,
blend mode, effect chain, crop and transition then meet that one finished picture. Fade a compound
holding two overlapping clips to half and the overlap reads exactly what the rest of it reads —
128 over black, where fading each clip separately made the shared strip 191 and drew a seam between
them. Blend it and the blend runs once rather than once per clip; crop it and the crop is a cut
through the group rather than something with no meaning in any one clip's own frame; put a
dissolve on it and the picture underneath is mixed in once, which is why a transition on a compound
is authorable at all.

The surface costs a full frame of memory per level of isolation — 8.3 MB at 1080p, so 66 MB for a
project nested as deep as one may be, and twice that if every level also carries an effect chain or
a dissolve — and it is held until the preview is torn down. A compound
that fades nothing, blends nothing, grades nothing, crops nothing and dissolves nothing is therefore
drawn flat instead: the surface would hand back exactly what went onto it, and drawing flat is what
keeps *folding changes no pixel* true byte for byte rather than nearly.

There is no **un-nest**: <kbd>Ctrl</kbd>+<kbd>Z</kbd> takes a fold back, and a compound reopened
from a saved file stays one.

### Markers

**Set marker** in the toolbar, or <kbd>M</kbd>, puts one at the playhead. Clicking a marker on the
ruler moves the playhead there; its own context menu deletes it. Markers are snap candidates, which
is half of what they are for.

**Markers (n)** beside the button opens the list, over the tracks rather than above them — the
picture is the largest zone on this screen and a list nobody has opened must not take a row of it.
Every marker is a row: a colour, the timecode as a button that jumps there, a name and a note.

The colour is the operating system's own picker and comes back as the `#rrggbb` the core already
accepts. The name is what the ruler could show; the note is the longer text, and it is what a list
of thirty markers is read by. Typing in either is one undo step per field and per marker rather than
one per letter.

<kbd>Shift</kbd>+<kbd>→</kbd> and <kbd>Shift</kbd>+<kbd>←</kbd> jump to the next marker in that
direction. Standing exactly on one does not count as being ahead of it, so the key moves on rather
than landing on the same marker again.

### On magnetic timelines

Videola has no magnetic mode, and this is a decision rather than a gap. The useful half of one —
closing the gap an edit leaves — is already here as **ripple delete** and **ripple trim**, per edit
and per track, where you can see what moved. The other half is a different overlap rule for the whole
model: in a magnetic timeline clips cannot overlap, so every move pushes its neighbours and a
transition needs a slot the model reserves rather than an overlap the author builds. Videola's model
allows overlap on purpose — that is what a transition, a picture-in-picture and a crossfade are made
of — and changing that would change what every existing project means. If it ever arrives it will be
a mode you turn on, not a rule that appeared underneath you.

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

Every parameter row — an **effect** parameter and every **transform** field alike — carries a
keyframe switch, arrows to the previous and next keyframe, and, where one sits under the playhead,
a picker for what happens after it: linear, hold or ease. The switch sets a keyframe at the
playhead or removes the one already there. A row whose parameter has keyframes anywhere on the
timeline is marked with a diamond beside its label: the three switches only ever report the
playhead, so a row animated somewhere else looked exactly like a row animated nowhere.

The value on the row is the one the core gives for that moment — `Effect::param_at` through
`doc.effectParamsAt`, `Clip::transform_at` through `doc.transformsAt` — never a calculation of its
own. Interpolating in TypeScript would give the preview and the export two different answers for
the same frame. See [Keyframing a transform](./commands-and-undo.md#keyframing-a-transform) for the
command a transform row sends.

Once a parameter is keyframed the slider writes keyframes rather than the static value, and it
writes them at the playhead. `keyframe.add` is an upsert, which is what makes a drag one undo step;
it replaces the value and the interpolation of the key already there and leaves its bezier handles
alone, because no command carries a handle pair and destroying one would be the only other thing an
upsert could do with it. While the playhead stands outside the clip the keyframe controls are
locked: a keyframe written there is never evaluated for this clip, so the switch would report a
state no picture ever shows.

Two rows carry no switch at all. Where a clip has a **motion path** the core resolves `x` and `y`
from it and ignores whatever the two fields hold, so a keyframe written on either would be stored,
saved and reloaded without ever reaching a pixel. For the same reason **Fit to frame** goes dead
while the placement it would write — `x`, `y`, either scale, or the path — is on the clock.

Volume is still unanimated, and that one is genuinely missing an evaluation.

### The keyframe lane

Under the tracks, inside the timeline's own scrolling area, is a lane showing the keyframes of the
selected clip: one row per keyframe track, named the way the properties panel names it, with a
point per keyframe and the gap between two points drawn in the shape of the interpolation that
times it — solid for linear, broken for hold, faint at both ends for ease.

It sits in the timeline rather than in the properties panel so that there is one conversion between
pixels and time in the whole application and not two. The lane, the ruler, the clips and the
playhead are all positioned by `timeToX` out of the same `flicksPerPixel` and the same scroll
offset, so a keyframe stands on the ruler tick of its own time by construction rather than by
agreement. A lane in the properties panel would need a second axis over the panel's width, its own
scroll and its own playhead — two answers to "where is now", which is the one thing a keyframe
editor cannot afford. Keyframe times are absolute timeline time in the model, the same instants the
playhead reports, so nothing is converted between the two ends.

Press a point to pick it; drag it to move it. It is the same pointer path clips use, so it works
with a mouse and with a finger without a second code path, snapping applies (hold <kbd>Alt</kbd> to
suspend it), and one drag is one entry on the undo stack. A drag stops at the clip's edges, because
a keyframe outside the clip is never evaluated for it — and because a clamp is what keeps the core
from refusing once per pointer move, which is how a trim held against its limit once produced nine
error banners in a single drag.

Above the lane, while a keyframe is picked, is a bar carrying what that keyframe is set to: its
parameter's name, the interpolation of the segment that starts at it, and a delete button. The bar
sits outside the scrolling area so that it stays reachable on a long project, and the button is
there because a finger has no <kbd>Delete</kbd> key. With a keyframe picked, <kbd>Delete</kbd>
removes that keyframe rather than the clip under it.

Rows a motion path has taken over are struck through and marked *overridden by the path*. They are
not hidden: the keyframes are still in the file, and the lane exists to show what is stored.

### The curve field

Beside the interpolation, the bar carries a **Curve** disclosure. It opens over the tracks the way
the marker list does, and it shows the one segment that starts at the picked keyframe: a square
field with the travel plotted from 0 at the left key to 1 at the right one, the even-paced diagonal
dashed behind it so the shape reads as a departure from it, and — once the key is set to
`bezier` — the two handles that shape it, each tethered to the end of the segment it governs.

**Why it is not in the lane.** The lane rides the timeline's own time axis, which is what makes a
keyframe line up with the ruler and the playhead without anything having to agree on where *now*
is. A curve needs a value axis the lane has not got, and a 26 px row (44 px under a finger) has
nowhere to put one. It also needs room across: a segment is usually a fraction of a second, which
at the default zoom is about fifty pixels — less than one touch target, so a handle on the
timeline's axis could not be dragged without zooming the whole timeline to it. The field's x is not
a second time axis at all: it is the segment's own 0..1, the unit square a handle pair is already
stored in, exactly as CSS `cubic-bezier` spells it.

**The line comes out of the core.** The field asks `keyframe::segment_shape` for its samples —
the same function `interpolate` applies to move the picture. Easing written again in TypeScript
would pass every end-point check ever written and be wrong in the middle, and a curve that looks
like one thing while animating like another is the one fault a curve editor must not have.

Dragging a handle sends `keyframe.setHandles`, one dispatch per pointer move under one coalesce key,
so one drag is one undo step. Each write carries the whole pair the keyframe holds: sending only the
one under the hand would clear the other back to the default. `handle_out` belongs to the picked key
and `handle_in` to the key after it, so the last keyframe of a track has no field of its own — its
arriving handle is reached from the field of the key before it. The three presets stay a single
click; the curve is the fourth entry beside them, not a mode that replaces them.

Two rules the field shows rather than merely obeys. A row a motion path has taken over says so
inside the field as well as in the lane header — the curve is real, and it changes no picture. And
a **rate track is never offered `bezier` at all**: `keyframe::integrate` has no exact area under a
bezier, the additivity `consumed_source` rests on would go with it, and the core refuses the change.
An entry that could only ever produce a refusal is worse than an entry that is not there.

A handle beyond the unit square — the overshoot a bounce is made of — is stored, loaded and
animated correctly, but the field pins it to its edge and the first drag flattens it.

## Speed ramps

A clip's rate is not one number any more. `Speed { rate, reverse }` is still what a clip runs at when
nothing is animated, but a clip can carry a **rate track** — keyframes under the key `speed`, in the
same factor `rate` uses — and then the speed is a curve over time.

That changes the arithmetic underneath rather than adding a feature beside it. Where the mapping from
project time to source time used to be

```
source = in_point + (t - start) * rate
```

it is now the **area under the rate curve**:

```
source = in_point + ∫ from start to t of rate(u) du
```

A clip running from half speed to double over two seconds has spent 0.875 s of its material after one
second, not 1.25 s. Every proportional reading of that moment — the rate at the instant, the average
rate, the static rate — gives a different answer, and all of them are wrong.

`Clip::consumed_source()` is the same integral asked for the whole clip, deliberately: the total and
every prefix of it come out of one function, so they cannot drift apart. A reversed clip reads
`in_point + consumed − area`, and the moment those two were computed separately its first frame would
fall outside the range a decoder may read.

**The sound follows the same curve, not a copy of it.** An `AudioBufferSourceNode` reads its buffer at
the running integral of `playbackRate`, which is that same integral. The audio graph hands the platform
the rate curve as automation, so the picture and the sound are not two implementations that have to
agree — they are one mapping, computed twice by two engines that both do calculus.

### What a rate keyframe may be

| | |
|---|---|
| Value | a number from 0 to 100 |
| Interpolation | `linear`, `hold` or `ease` |
| Zero | allowed, and it means a frame hold |
| `bezier` | refused |
| On a compound clip | refused |
| On a clip you then nest | refused |

`bezier` is refused because its easing has no elementary antiderivative in the track's own time, and
an inexact area would break the one property everything rests on: that the area over a span is the sum
of the areas over its parts. Compound clips are refused in both directions because folding a nested
timeline in or out inverts the outer rate by dividing, which only works while that rate is one number.
Flatten the ramp, or nest first and ramp afterwards.

`Project::normalize()` refuses all of it on load, and the `keyframe.*` commands refuse the same shapes
through the same function — so a ramp one route accepts is never a ramp the other refuses to open.

## Presets

A preset is a list of commands sent under one coalesce key. It is not a thing in the project file, and
that is the point: `Dispatch.coalesceKey` already collapses a list into one undo step, the patch and
its inverse already come from `json_patch::diff`, the command layer already refuses every field a
preset would otherwise have had to check itself, and `POST /api/projects/:id/commands` already carries
a list under one key. A preset in the model would need its own load boundary, its own undo and its own
wire format, and would become a second authority on what a quarter-size picture in the corner means —
one the commands could then disagree with.

So every preset below is reachable from an agent by sending the same commands. The builders live in
`packages/core/src/presets.ts`.

| Preset | What it sends |
|---|---|
| Freeze from here | two keys on the rate track: the clip's own rate, held, then zero |
| Slow start / end / middle | two or three eased keys on the rate track |
| Ken Burns in / out | two keys each on `scaleX` and `scaleY`, plus a two-point motion path |
| Picture in picture | one `clip.setTransform`, and a `clip.move` where a track sits above |
| Split screen | one `clip.setTransform` per clip, each cropped to its own half |

**Freeze from here** is a rate of zero and nothing else — no still-image clip, no second kind of
source, no branch anywhere downstream. The frame it stops on is the one the playhead was showing, and
the sound stops with it through the same track. It is refused on a reversed clip: backwards, a clip
reads `in_point + consumed − area`, so zeroing the rate shortens `consumed` and moves the frame the
clip is *anchored* to rather than the one it stops on. The button is disabled rather than wrong.

**Ken Burns** starts from the scale at which the material covers the frame, so the corners never open
onto the background at either end of the move.

**Split screen** crops each clip to the half it stands in rather than squashing it, so both keep their
proportions.

## Subtitles

Videola reads and writes **SRT** and **WebVTT**. Drop an `.srt` or a `.vtt` on the editor, or reach
for **Import captions** in the project menu, and every cue becomes a clip on a caption track of its
own. **Export captions** writes the track back out as an SRT beside the project.

A subtitle is an ordinary clip with a text generator in it, so everything the timeline can already
do to a clip it can do to a subtitle: drag it, trim either edge, split it at the playhead. Two more
things belong to captions in particular. **Merge with next caption** in the clip menu folds a
subtitle into the one that follows it -- the words joined on their own lines, the span reaching from
the first head to the second tail -- and it is one undo step, because a half-merged pair is not a
state anyone asked to land on. And the **Text** panel in the inspector is where the words are typed.
It is a textarea and not a single-line field: a hard line break is a line break on screen, and a
two-line subtitle typed into an input comes back as one line.

### Where the times live

The formats count in whole milliseconds and the project counts in flicks. 705 600 000 is a whole
multiple of 1000, so a millisecond is exactly 705 600 flicks and neither direction loses anything.
That conversion lives in `millisecondsToTime` and `timeToMilliseconds` in
`packages/core/src/commands.ts` and nowhere else, and it is what lets the same file go in and come
back out character for character -- which is checked, on a file whose milliseconds are none of them
a whole second or a whole frame.

Only a caption track is read back out. That is the whole reason `TrackKind::Caption` exists rather
than a convention on the text track: the builtin templates put lower thirds on text tracks, so a
subtitle file written from every text clip in the project would carry the lower thirds as cues, and
one written from some of them would need a second marking somewhere else to say which. A hidden
caption track is left out of the file for the same reason it is left out of the picture.

### What an SRT is allowed to be

A caption file is something you were handed, so every one of these is dropped on its own and the
rest of the file is still read: a timestamp that will not parse, an end that does not come after its
start, a cue with no words in it, a cue further out than a project may reach. Reading stops after
20 000 cues, which is ten times a three-hour feature. A file that is not a caption file at all
yields nothing rather than an error. Markup is dropped -- the generator draws one run of text in one
style, and the alternative is drawing the tag as characters.

### How they look, and where they end up

The default is white on a translucent black plate, low and centred, in the style keys the text
generator already reads. The plate is what makes it readable on a bright sky and on a night interior
both -- a stroke alone survives one and not the other, and a stroke wide enough for both eats the
counters of the letters. That claim is checked at pixels, over white and over near-black, against
the same words with the plate taken away.

In the export dialog, captions go **in the picture**, **as a separate track**, or are **left out**.
In the picture is the default and needs nothing of the player. A separate track is one the viewer
can switch off; whether the chosen container can carry one is asked of the writer rather than
assumed, and the control is greyed out where it cannot. Both containers Videola writes can carry
WebVTT today.

## Playback

The transport gives you start, frame back, play/pause, frame forward, end, and a timecode read from
the project's frame rate. <kbd>Space</kbd> toggles playback and the arrow keys step frames; both
listen on the window, so they work while the focus is in the timeline.

The audio clock leads and the picture follows, because audio drift is audible and a dropped frame
is not. Frame rates stay rational to the last division — 30000/1001 is not 29.97, and a frame step
built from the decimal drifts off the ruler within a few hundred frames.

Browsers start an `AudioContext` suspended and only allow it to resume after a user gesture, so the
first press of play does slightly more work than the ones after it.

### J, K and L

| Key | Result |
|---|---|
| <kbd>J</kbd> | rewinds; each press in the same direction steps up 1, 2, 4, 8 |
| <kbd>K</kbd> | halts |
| <kbd>L</kbd> | plays forward, up the same ladder |

A press against the direction of travel drops straight back to the first rung rather than counting
back down, which is what makes tapping <kbd>J</kbd> out of a fast forward feel like a brake. The
rate is shown beside the timecode while it is not the ordinary one, and the two triangle buttons do
the same thing for a hand with no keyboard under it. A rewind ends at the head of the timeline and
halts there.

This is the **transport's** rate and not a clip's. A clip's speed — including a ramp, which is a
curve rather than a factor — is a property of the material and travels with it into the export; this
one exists only while somebody is shuttling, and nothing in the project ever reads it.

Sound plays at ordinary speed and at no other. An `AudioBufferSourceNode` is scheduled against real
time and cannot follow a shuttle, so the alternative is not fast audio but audio drifting further
from the picture with every second — which is worse than none.

### Preview resolution

The select beside the timecode draws the preview at **1/2** or **1/4** of the screen's own
resolution. The element keeps its size and the browser stretches the smaller buffer back over it, so
the picture only gets softer — the cheapest thing there is to trade for a preview that keeps up on a
big project. The export never sees it: it renders into a context of its own, at the size the export
dialogue was given.

## On a phone

![The media library on a phone, with the preview staying above it](/editor-phone-library.webp)

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

![The editor on a tablet, two media on two tracks](/editor-tablet.webp)

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

### The autosaved session

Every thirty seconds the editor writes the project state into browser storage on its own. Not a
`.videola`: a snapshot every half minute that gathered, hashed and zipped every medium would be
gigabytes of copying to remember where a clip sits. The media are in OPFS under their content hash
already, which is where the renderer, the decoder and the export read them from, so a snapshot that
names them is a snapshot that can be restored.

Open the editor after a crash and a banner offers the snapshot with the time it was taken. It is
only offered, never taken: restoring over a tab somebody opened on purpose is the same surprise as
losing the work, seen from the other side. **Discard** removes it.

An empty project is never written, so a fresh tab cannot overwrite the state it is still offering to
restore. A snapshot half-written when the machine went down reads as no snapshot at all, and one
whose project the loader would refuse is refused on the way back in as well — an autosave nobody
asked for must not be the reason the editor will not start. A snapshot whose media have since left
OPFS restores with the same "missing medium" banner an opened file would give.

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
