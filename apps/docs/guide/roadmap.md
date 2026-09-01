# What is planned, and why in this order

This page is the plan of record. It exists because the work runs across many sessions: what is decided
and what is left has to be written down somewhere both sides can read, not carried in somebody's head.

Everything here is either **data**, **one shader**, or **one command plus one panel** — the three shapes
that have carried every feature in this program so far. A plan entry that does not reduce to one of
them is a plan entry that has not been thought through yet, and it says so.

## The rule about other people's content

Videola ships no asset it does not own. No template, transition, sound or font is copied out of another
editor, and that is not caution — a licensed library pasted into a GPL repository is an infringement
with somebody's name on it, and the somebody is whoever published it.

What replaces it: **generators**. Every shipped template is arithmetic over shapes, gradients and a
font the system already has, which is why fifteen of them weigh nothing and can become a hundred.
Where real material is genuinely needed later — a music bed, a texture — it comes from a CC0 source
with the provenance written beside it, or it does not come.

## Next

### 1. Audio effects

The mixer already builds its chain from Web Audio nodes and reads gain reduction off the live
compressor, so each of these is a node and a panel row rather than a new mechanism.

| Effect | Node | Why it is on the list |
|---|---|---|
| ~~Three-band EQ~~ | shipped: bass and treble shelves, and a notch at the mains frequency | the fix for a boomy voice, and the thing every editor has |
| Reverb | `ConvolverNode` with a generated impulse | the one effect that makes a voice recorded in a room sound like it was meant to be there |
| Pitch / speed lock | playback rate plus `preservesPitch` | a speed ramp that does not turn a voice into a chipmunk |
| Noise gate | a gain schedule off the meter's own reading | the cheap half of the noise reduction that already exists |

**What the interface still owes them.** An audio effect is one native node today, and both the reverb
and the gate need two: a wet path and a dry one to mix, a reading and a gain to schedule. Bass, treble
and the hum filter shipped first precisely because each is one node. Extending `AudioEffectNode` to an
input and an output is the small, real piece of work in front of the other two, and it belongs in the
graph rather than in the effects that want it.

The impulse is generated rather than shipped, for the reason above: a decaying noise burst shaped by
room size is three lines and owes nobody anything.

### 2. Look presets for the picture

The same table the twelve titles are: a name and a list of effects with their settings. Twenty-three
effects are unusable by somebody who does not know what "posterize" means; "Vintage", "Cinema",
"Summer", "Night" are the same effects arranged by somebody who does.

### 3. Many more project templates

Fifteen ship. Each is Rust data of the shape `builtin.rs` already holds, and the test suite around them
already refuses a template that names an effect, a transition, a track kind or a title move the
renderer cannot draw — so the tenth new one is as safe as the first.

### 4. The phone, end to end

Importing, recording and picking from the gallery are all there, and the layout has been measured at
390 px for a year. What has never been walked in one piece is the whole errand: material in, cut,
title, export. That walk is the next harness run to write, and whatever it finds is the next thing to
fix.

### 5. Effects on a range rather than a whole clip

Today an effect is a property of a clip. Filmora applies one to a span. The honest version here is a
split at both ends of the range and the effect on the middle piece, in one step of the history — which
needs no new model, only one command sequence and one gesture.

## Done since this page was written

* **Custom templates.** A dialogue decides what a template asks for and what it carries; an unmarked
  medium travels inside the file. That is the half of "replace the Python tool" that is about making
  the video.
* **Publishing destinations.** A server holds them, the editor lists them, and an export can go
  straight to a channel. That is the other half.
* **The preview holding a stale layer with several media on the timeline**, which was the pin this
  page's predecessor promised.

## Open defects

**The effect shelf comes up without its tiles in the headless harness.** Twenty-three tiles, no
pictures, no error. It draws normally in a real browser. Ruled out so far, each by measurement: the
frame clock (the same call resolves in the GPU harness under a stopped one), a lost context (a race
against the loss event never fired), the drawing-buffer read (replacing it with a pixel read changed
nothing), an empty result and a key mismatch (the shelf now reports what it was handed). A failed run
reports an empty grid rather than staying "still drawing", and it still reports pending -- so the
promise neither resolves nor rejects, and the next thing to instrument is whether the tile preview gets
a WebGL context at all in a page that already holds the preview and the scopes.

**A native audio context is a scarce resource, and the audio tests sit at the edge of it.** A fourth
`OfflineAudioContext` in one test file takes the vitest worker down with it. One check was rewritten to
need three; the others have not been counted, and a suite that grows into a fifth will fail as a
mysterious CI-only assertion rather than as a crash.

## Not planned

* **A remote asset catalogue.** The shipped set is offline and additive on purpose; a store is a
  business decision, not a feature.
* **AI subtitles, AI cutting, AI anything** until there is a model that runs on the machine in front of
  the person. Sending somebody's footage to a server to get a caption back is not a feature this
  program will grow quietly.
* **A second interpolation.** Every animation resolves in the Rust core. Presets sit on top of what the
  core resolved; nothing else is allowed to interpolate, because two answers to "where is this clip at
  this instant" is the one bug that cannot be tested away.
