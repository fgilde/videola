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

Brightness, contrast, saturation, colour temperature, vignette, blur, sharpen and chroma key.
Cross dissolve, wipe, slide, zoom and dip-to-colour. Rectangular and elliptical masks with feather
and invert; two masks in one chain intersect. A text generator with styling and in, out and loop
animation.

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

Each effect's behaviour is measured against real pixels rendered by a real driver: 258 such checks
run on every build. A third-covered pixel over red must read 81, which is what premultiplied alpha
gives; the reflex answer of 255 fails.

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

![The gallery and a baked template: three clips on the timeline, each the template's duration rather than the file's](/editor-templates.webp)

A template is the same container as a project with one extra entry, so the same bytes still open as
a project. Pick one, answer the wizard, and what you get is an ordinary editable project — there is
no template mode to leave. The gallery card draws the timeline the template will build, read off its
own project, rather than a picture that claims a result.

Four ship, none of them carrying footage, and each demonstrates something that really works rather
than something that would look good in a screenshot.

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
