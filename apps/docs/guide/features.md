# What Videola does

A tour of the editor as it stands. Everything below is built and checked; the
[architecture chapter](/guide/architecture) marks, decision by decision, what is planned instead.

## The editing surface

![The Videola editor on a desktop: media library on the left, a decoded frame filling the preview, the properties panel on the right, the timeline below it and the mixer along the bottom](/editor-desktop.webp)

Four zones, and the picture is the largest of them — a check holds that, because a grid row that
grows with its contents had twice shrunk the canvas to a stamp before anyone noticed.

**The library** lists what the project holds, each medium with its length, its size in pixels and
its sample rate, and a thumbnail decoded from the file itself. **The properties panel** shows what
is adjustable about the selected clip and lets any parameter be animated. **The timeline** is where
the work happens. **The mixer** carries one strip per track plus a master.

## Cutting

| Gesture | Result |
|---|---|
| Click a clip | selects it; hold a modifier to select more |
| Drag the middle | moves it, across tracks too |
| Drag an edge | trims, ripples or rolls, depending on the edge mode |
| Drag with the move mode on slip or slide | slips the source under the clip, or slides the clip between its neighbours |
| Drag in the ruler | scrubs |
| Two pointers | zoom by the change in distance |
| Long press | opens the context menu |

Ripple delete closes the gap it leaves. Groups move together. Cut, copy and paste work on whole
clips, markers sit on the ruler, and a selection can be folded into a **compound clip** — that the
picture does not change when you do is proven against the whole frame buffer, the draw list at
sixteen instants and the audio render sample for sample.

Everything runs through Pointer Events, so mouse, pen and finger take the same path, and a whole
drag — two hundred pointer moves — is **one** undo step.

## Effects, transitions and text

![The effect browser: tiles by category, each rendered through the effect it offers](/editor-effects.webp)

They are picked from a browser grouped by category and searchable in both languages, and **every
tile is the effect's own shader over the frame at the playhead** — not a painted illustration. A
tile that failed to change the picture it was drawn from fails the build, which is what stops an
effect from advertising itself with its own default value.

Brightness, contrast, saturation, colour temperature, curves, colour wheels, vignette, blur, sharpen
and chroma key. Cross dissolve, wipe, slide, iris, zoom, blur dissolve and dip-to-colour. Rectangular and elliptical
masks with feather and invert; two masks in one chain intersect. A text generator with styling and
in, out and loop animation.

They are chosen from a **browser you can look at**, grouped by category and searchable in both
languages — and every tile in it is that effect's own shader run over the frame the editor is
showing, at the size of a thumbnail. Not a painted illustration and not a stock photograph: what the
tile promises is what the timeline delivers, because it is the same shader. A transition's tile shows
the moment that says the most about it, which for a dissolve is halfway and for a dip is not.

Every parameter can be keyframed — including a clip's position, scale, rotation and opacity — and a
`position` track turns a series of keys into a **motion path** interpolated as a curve rather than
a set of corners. The interpolation happens in the Rust core, so the preview and the export cannot
read different values.

Keyframes are edited on a lane under the tracks, on the timeline's own axis: press one to pick it,
drag it to move it, <kbd>Delete</kbd> or the button above the lane to remove it, and a picker for
what times the stretch after it — linear, hold or ease. One drag is one undo step, and it all works
with a finger as well as with a mouse. There is no curve editor yet: a project that carries bezier
handles keeps them and keeps its shape, but nothing here can drag one — see
[Editing](./editing.md#the-keyframe-lane).

Each effect's behaviour is measured against real pixels rendered by a real driver: 303 such checks
run on every build, and every tile in the browser is one of them — a tile that failed to change the
picture it was drawn from fails the build. A third-covered pixel over red must read 81, which is
what premultiplied alpha
gives; the reflex answer of 255 fails.

## Colour correction, and something to judge it by

Curves and colour wheels, and three measuring instruments to read the result on.

**Curves** on brightness and on each of the three channels, with control points you drag: tap the
field to add one where you tapped, tap a point to take it away, and the two ends stay. The line is
a monotone cubic, which cannot overshoot between two points — an overshoot on a tone curve is a
bright rim along every edge in the picture that crossed that tone. The brightness curve is not the
three channel curves in step: it scales all three by one ratio, so the colour of a pixel comes out
exactly as it went in and only its brightness moves.

**Colour wheels** — lift, gamma and gain — each with a tint and a strength, which is what the wheel
and the ring on a real panel are. Lift says where black goes, gain says where white goes, and gamma
bends what lies between without moving either end.

**Scopes**: a waveform, a vectorscope and a histogram, in a strip under the picture that a switch on
the transport opens. They read the preview's own pixels, so what they show is what the export will
write. They are shrunk on the GPU before they are counted and measured ten times a second: 0.9 ms a
reading rather than the 33 ms a naive full-frame count costs at 1080p, and nothing at all while the
strip is closed.

Everything here is keyframable like any other parameter, curves included — a curve keyframe
interpolates its control points, so a knee slides sideways as well as up.

## Retiming and presets

A clip's speed is a **curve over time**, not a factor. Keyframes on the `speed` track make the map
from project time to source time an integral rather than a multiplication — the area under the rate
curve — and `consumed_source` is that same integral asked for the whole clip, so a total and a
prefix of it can never disagree. Reversal, trimming and the decoder clamp all keep working because
they were built on that one function rather than on the arithmetic it replaced.

The sound follows the same curve: an `AudioBufferSourceNode` reads its buffer at the running
integral of `playbackRate`, so the picture and the sound are one mapping computed by two engines,
not two implementations that have to be kept in step. A ramp is checked flick for flick against the
Rust core across seven shapes, and sample for sample in a real offline audio render.

A **frame hold** is a rate of zero and nothing else. No still-image clip, no second kind of source.

The presets — a frame hold, three slow-motion shapes, a Ken Burns push, picture in picture, a split
screen — are lists of commands sent under one coalesce key, not entries in the project file. That
makes each of them one press of undo without a line of inversion code, and reachable from an agent
by sending the same commands. See [Editing](./editing.md#presets).

## Sound

![The editor on a tablet: the properties panel in two columns, three complete mixer strips along the bottom](/editor-tablet.webp)

Per-track volume, pan, mute and solo, with mute winning over solo. Fades are scheduled as
automation rather than computed per frame, which is the difference between a clean fade and a
click. Waveforms are drawn from the buffers the graph already decoded — no second decode, and a
reversed clip shows itself the way it plays.

Each track and the master can carry **inserts**: a peaking EQ, a compressor, a limiter. They sit
ahead of the fader, console-style, so the fader rides the levelled signal. Their parameters are
keyframable like any other, and the same resolver serves the preview, the export, the server and
the loudness meter.

Loudness is measured to EBU R128 and verified against the Tech 3341 conformance cases. The limiter's
knob is called **threshold**, not ceiling: the browser's compressor applies its own makeup gain, so
it is not a brickwall, and the documentation says so rather than implying otherwise.

## Playback and export

The audio clock leads and the picture follows, because audio drift is audible and a dropped frame is
not. Frame rates stay rational to the last division — 30000/1001 is not 29.97, and a frame step
built from the decimal drifts off the ruler within a few hundred frames.

Export writes MP4 with H.264 and AAC, or WebM with VP9 and Opus, in a worker, through the same
compositor the preview uses. Progress is reported and cancelling really stops it. A browser that can
encode a format's picture but not its sound writes a silent file rather than failing halfway — Chrome
on Linux is exactly that browser.

Every export in CI is handed to `ffprobe` and `ffmpeg`, which share no code with this project, and
the decoded result is compared frame by frame against what went in.

## Templates

![The template gallery: nine cards in five categories, each one a still rendered from the template itself](/editor-templates.webp)

A template is the same container as a project with one extra entry, so the same bytes still open as
a project. Pick one, answer the wizard, and what you get is an ordinary editable project — there is
no template mode to leave.

**Nine ship, in five categories, and not one of them carries a frame of video.** A template is a
recipe, so each is built out of what the renderer can draw from a project file alone: the text
generator with its entry, exit and loop moves, solids and gradients, the ten effects, the five
transitions, masks, and keyframed transforms including a motion path. Your own material arrives
through the placeholders. Between them the nine use every transition the renderer implements.

The card is not a painting of a result — it is **rendered from the template**, through the same bake a
real answer goes through, with a grey stand-in exactly where your footage will land. A painted card
could show a look the renderer would never produce, and nobody would find out until after they had
chosen. Costs one small picture per template, drawn one at a time while the gallery is already open;
a preview project holds nothing but generators, so there is no decoding and no storage to read.

## On a phone

<div class="shots">
  <img src="/editor-phone.webp" alt="Videola on a phone: preview and transport at the top, a tab bar, the timeline below">
  <img src="/editor-phone-library.webp" alt="The media library on a phone, the preview staying visible above it">
  <img src="/editor-phone-inspector.webp" alt="The properties panel on a phone, reachable as its own tab">
</div>

Below 768 px the editor becomes one column: the picture and the transport stay at the top, and a tab
bar swaps between media, timeline and properties. The panel that is not showing is unmounted rather
than hidden — the timeline windows its clips by the width it measures, and a `display: none`
container measures zero.

Nothing else changes. The same pointer path carries a finger, hit areas grow to 44 px when the
pointer is not a mouse, and every action reachable on a desktop is reachable here. Import can come
from the camera or the gallery.

The phone layout is driven at a real 390×844 viewport at twice the pixel density over the devtools
protocol, because Chrome on Windows refuses a window narrower than 500 CSS pixels — `--window-size`
alone would have measured a small tablet and called it a phone.

## For agents and scripts

The whole command catalogue is exposed over HTTP, to AI agents over MCP, and on the command line.
The catalogue is generated from the Rust enum, so a new command becomes an agent capability without
anyone editing a list.

An agent can also **look at what it did**: `project_getFrame` renders a still at any instant and
`project_getAudioPeaks` returns the mixed waveform. The still comes out of the same core, draw list
and compositor the editor draws with, so it cannot show something the editor would not.

See [The API and MCP](/guide/api-and-mcp).

## Self-hosting

One Node process serves the editor, the HTTP API, the MCP server and the CLI. It refuses to start on
a public address without a token and says why. See
[Building and releasing](/guide/building-and-releasing).

<style scoped>
.shots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.shots img {
  width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}
</style>
