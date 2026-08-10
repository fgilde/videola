# Audio

The sound leads and the picture follows. Elapsed time is read from the audio context, because drift
in audio is audible and a dropped frame is not — every position the editor shows comes from
`AudioContext.currentTime` by way of the clock, and nothing derives project time from a decoder
timestamp.

## The graph

```
Clip → buffer source → clip gain (volume, fades)
     → track inserts (equaliser, compressor, …)
     → track bus (gain for volume/mute/solo → stereo panner)
     → master inserts (the mastering chain)
     → master gain
     → destination
```

Every clip that the library says has channels gets a voice, whatever kind of track it sits on: a
video track carries clips whose medium has an audio stream, and an audio track can hold a video file
someone dropped on it. The library entry is the only thing that knows.

A medium that will not decode costs its own clip its sound and nothing else. One gap does not
silence the timeline.

### Volume, mute and solo

Track volume, mute and solo act on the track bus rather than on the individual clip gains, so a
track silenced in the middle of a fade stays silenced and the fade automation underneath it is left
alone.

**Mute beats solo.** A track that is both muted and soloed stays silent, and soloing it still
silences every track that is not soloed. The mixer's two buttons are independent for the same
reason: pressing one must not quietly clear the other.

### Effects on a bus

A track and the project itself each carry a chain of effects, addressed by the same `effect.add` and
`effect.setParam` commands a clip's effects use — pointed at `on.track(id)` or at `on.project`
instead of at `on.clip(id)`.

Three exist, and all three are native Web Audio nodes:

| Effect | Node | Knobs |
| --- | --- | --- |
| Equaliser | `BiquadFilterNode`, peaking | frequency, gain, Q |
| Compressor | `DynamicsCompressorNode` | threshold, ratio, attack, release |
| Limiter | `DynamicsCompressorNode` at ratio 20, no knee | threshold |

**Inserts sit ahead of the fader**, the way a console wires them. The fader then rides a signal the
compressor has already levelled, so pulling it down changes how loud the track is and not what the
compressor is doing to it. The same rule on the master leaves the master fader as the last thing
before the output, which is what a fader is for.

An effect type the build has no node for — a blur someone dropped on a bus, or a type from a newer
version — is passed over, and the rest of the chain still sounds. Refusing the chain would cost the
whole track its sound over one entry. A disabled effect is skipped the same way.

Chains are sequences, not sets: a limiter after a boost catches what the boost made, and the same two
the other way round boost what the limiter already held down.

::: warning What the limiter's threshold is not
`DynamicsCompressorNode` applies its own makeup gain, so the level that leaves sits above the
threshold rather than at it — measured, at ratio 20 and no knee, a full-scale tone comes out at about
−4 dBFS with the threshold at −12. The knob is therefore called a threshold and not a ceiling: what it
does is real and monotone (lower it and the master gets quieter and more even), but it is not a
brickwall guarantee, and naming it one would be naming something the node does not deliver.
:::

### Automation on a bus

A bus parameter takes keyframes exactly as a clip's does, so an automated filter sweep or a ducking
curve is the same mechanism as an animated blur. Unlike a clip's, a bus parameter can be keyed
wherever the playhead stands: a track and a mastering chain have no clip window to fall outside of.

The keyframes are resolved **in the core and nowhere else.** The graph reads the corner times to
decide *when* to ask, then asks `Document.effectParamsAt` for the value at each of them and hands the
result to the same scheduling used for fades. Between two corners it asks again at a few points in
between, so a curve the core bends is followed as a polyline through the core's own values instead of
being straightened into the line across its ends; a linear segment is untouched by this, because
every extra sample lands back on the line it already had. A held keyframe steps rather than glides,
because the graph also asks one flick short of each corner.

The consequence worth stating: preview, export, the server renderer and the loudness reading are all
handed the same resolver and the same `AudioGraph`. There is no second interpolation anywhere for the
two to disagree about.

### Fades

A fade is automation, not arithmetic per frame. The envelope is a list of corners, and the audio
thread interpolates between them per sample — a gain written once per animation frame is a staircase,
and a staircase in an amplitude is a click.

Playback starting in the middle of a fade enters at the interpolated value and schedules only what
is still ahead. That matters more than it sounds: automation times are absolute and cannot be
negative, and a clip whose fade began before playback did is the ordinary case, not an edge one.

Trimming and splitting leave fades alone, so a clip shorter than its own fades is reachable without
anyone touching a fade handle. Both fades are then scaled down by the same factor, keeping their
ratio, and the envelope peaks where the two would have crossed.

### Reversed clips

An `AudioBufferSourceNode` has no negative playback rate, so a reversed clip plays a reversed copy of
its own range, made once when the clip is prepared. The offset arithmetic needs no special case: a
position `p` into the clip consumes `p × rate` seconds of source counted back from the out point,
and that is the same `p × rate` counted forward from the start of the reversed copy.

### Speed

Offset and duration are measured in the buffer's own time, which runs at the playback rate relative
to the timeline — a clip at half speed consumes half a second of source per second of timeline.

## Waveforms

The timeline draws a strip per clip from the samples the graph already decoded for playback. There
is no second decode and no second cache, so what is seen and what is heard cannot drift apart — a
reversed clip shows itself the way it plays.

Each bucket keeps the minimum and the maximum of the samples under it, not their average: an average
turns a snare hit into a bump and a stretch of speech into a grey band. The strip is drawn in its own
coordinates and stretched to the clip by its `viewBox`, so it survives every zoom step without being
rebuilt.

A clip with no peaks yet draws no strip at all. A flat line would promise a signal nobody has read.

## Loudness

Videola measures **integrated loudness to ITU-R BS.1770 / EBU R128**, in LUFS. The K-weighting
coefficients are recomputed from the filter formulas for the project's own sample rate rather than
taken from the 48 kHz table printed in the standard, so a 44.1 kHz project measures as correctly as a
48 kHz one.

Both gates are applied: blocks below −70 LUFS absolute, then blocks more than 10 LU below the mean of
what survived. This is what keeps the pauses in a dialogue track from dragging the reading down.

The measurement is of the **programme, not the material**. It comes from a real offline render of the
real graph, so clip gains, fades, track buses, mute, solo and the master fader are all in the number —
because they are all things that change it.

Measuring renders the whole timeline, so it happens when you ask for it in the mixer and never per
frame.

::: tip What the number means
−23 LUFS is the EBU R128 delivery target for broadcast. Streaming platforms normalise to somewhere
between −14 and −16 LUFS. A programme measured at −23 will be turned up by a platform targeting −14,
so mastering louder than the target buys nothing but lost headroom.
:::

## The mixer

The desk is opened from the transport, next to the switch for the instruments, and it starts folded
away. A strip of two labelled faders over mute, solo and a chain picker is a hundred and ninety
pixels; standing there whether or not anyone was mixing, with the instruments open as well, it left
the picture sixty pixels of a seven-hundred-pixel window. Who gives the picture up, and when, is a
decision rather than a default. On a phone it is one of the panels behind the tab bar instead.

One strip per track, ordered the way the timeline stacks them rather than the way the core stores
them — `tracks[0]` is the bottom of the stack, and a mixer listing them in that order would put the
top track's strip last.

Each strip carries a level meter, a volume fader, a pan control from left through centre to right,
and the mute and solo buttons. One drag of a fader is one step in the undo history, not one per
pixel. Below them sit the two actions that need the samples rather than the project alone: the
picker that ducks this track under another, and the button that cuts the silence out of it.

Below those sits the strip's insert chain: a button per effect the build can make a sound with, and
once one has been added, a row per parameter with the same keyframe controls the inspector uses. A
row reports the value the **core** resolved for the playhead, clamped to the range the effect
declares — the same clamp the graph applies before the number reaches a filter, so what is read is
what is heard.

Last on the right, set apart by a border, is the **master strip**: the project's own fader and the
mastering chain. Everything to its left feeds it.

## Low cut and high cut

Two filters, one knob each, on the same insert chain as the equaliser.

Neither is a denoiser, and calling one that would be a lie: nothing in a filter separates a voice from
noise sharing its band — that is what the [noise reduction](#noise-reduction) below is for. What these
do is take away a band that carries nothing anyone wants — rumble, wind and mains hum under a voice,
tape hiss or a fan over it — and on a location recording that is most of what is wrong with it.

The low cut sits at 80 Hz by default, under the lowest note of a speaking voice; the high cut at
12 kHz, above the consonants and inside the hiss. There is no Q knob: a biquad's Q at its corner is
a resonance, and a resonant high-pass on a voice is a howl at the frequency it was set to.

Both are measured through the real renderer against two tones in one signal, so neither can pass by
going quiet: at a cutoff of 1 kHz the low cut leaves the 200 Hz tone at under a tenth of its strength
and the 6 kHz one at over seven tenths, and the high cut does the same the other way round.

## Noise reduction

**Built.** A switch on the clip's own properties, beside its volume, and a strength beside that. It is
spectral noise reduction: the thing the two cut filters cannot do.

**How it can work at all.** Noise is *steady* and speech is not. Between words, between notes, between
takes, the only thing left in a recording is its noise — so those windows are a measurement of it. The
quietest fifth of the clip, by total energy, is averaged bin by bin into a noise floor, and every
window of the clip is then turned down per bin by however much of it is floor. Spectral subtraction
with a gain floor, which is what Audacity's noise reduction is and what every broadcast denoiser
starts from.

| Setting | What it does |
|---|---|
| Amount | how many times the measured floor is taken away. One leaves an audible remainder; past three the artefacts are the loudest thing left |
| Floor | how far down a bin may be pushed, in decibels. Never to silence: a bin gated off and on again between windows is the warble that gives cheap noise reduction away |

**Where it runs.** Over the decoded buffer, in the audio graph, where a clip's samples are loaded —
not as an insert on a bus. Two reasons, both structural. The analysis needs the *whole* recording and a
live node sees 128 samples at a time; and noise belongs to a recording rather than to a mix, so
learning one floor for a bus carrying two microphones would clean neither. It is therefore a **clip**
effect, and the same buffer feeds the preview, the export and the waveform strip — which is why the
strip visibly changes when it is switched on, and why that is what the browser check measures.

The result is cached by the settings as well as by the clip's range, so turning the amount up analyses
again and dragging the clip across the timeline does not.

**The arithmetic, and why it is written out here.** 2048-point windows at a quarter hop, a periodic
Hann window analysing and synthesising, and the overlap-add divided by the window energy that actually
landed on each sample. Four periodic Hann windows at that hop sum to a constant, which is what makes a
pass with the gain left at one return the recording rather than a version of it with a ripple through
it. The gain is smoothed across each bin's two neighbours before it is applied, because a gain that
jumps from bin to bin rings, and the ringing is heard as a metallic edge on every consonant.

The clip is padded with a window of silence at each end. Without that the first and last samples are
covered by one window whose taper is nearly zero there, and dividing by that window sum made the ends
of every clip **eighteen times too loud** — a fault every ratio measured inside the file missed and a
peak reading found at once. Both checks are in the suite now.

**What it cannot do.** Tell a steady signal from steady noise. A recording with no pause anywhere — a
sustained tone, an unbroken drone — has no window where the noise is alone, and nothing can be measured
there that is not also the signal. That is what stationarity means rather than a shortcoming of this
estimate, and it is why the strength is a knob rather than a switch.

Measured, not asserted: against a tone in bursts with hiss over it, the noise **inside the tone's own
band** drops by more than 9 dB while the tone stays within 2 dB of where it was. No filter can make
that claim, which is the whole reason this exists beside them.

## Beats

The metronome symbol on a strip puts a marker on every beat of that track.

What counts as a beat is a **rise**, not a level: the difference between one bucket of the envelope
and the last, kept only where it is positive. A loud passage is not a beat and a quiet one is full
of them, which is why the level itself cannot be the signal. The threshold moves with the music — a
mean over the surrounding half second, times a factor — so the same hits are found in the quiet half
of a track as in the loud half, which a fixed threshold cannot do. A rise also has to be larger than
its immediate neighbours, so one hit is one beat rather than the three or four buckets its attack is
spread over.

It reads the envelope the waveform strip already holds, so it costs a few passes over a few thousand
floats rather than a decode. The bucket-to-time step goes through the same inversion silence
detection uses, so a clip on a speed ramp has its beats where they are heard rather than where they
would be at a rate of one.

Markers and not cuts, deliberately. Where the beat falls is a suggestion to cut against — the
timeline snaps to markers — and a hundred cuts nobody asked for would be a hundred clips to take
back one at a time. The whole press is one step in the history whatever it found.

A steady tone has no onsets and yields nothing, which is the right answer rather than a failure.

## Surround

**Built.** A project is laid out over **stereo or 5.1**, chosen on the master strip, and every track
has a position in that field rather than a place between two speakers.

The channel order is stated once and kept everywhere: **L, R, C, LFE, Ls, Rs** — WAVE order, which is
what every codec here writes and what the offline context, the encoder and the meters all count in.

| Control | What it does |
|---|---|
| Pan | left to right, the same number a stereo mix uses — so switching a project to 5.1 keeps the placement it already had |
| Rear | front to back, 0 at the front speakers to 1 behind the listener |
| LFE | how much of the track is sent to the low-frequency channel |

**Pairwise, constant power.** A position is panned between the two speakers it stands between: left to
centre over the left half of the pan, centre to right over the right half, and the rear pair as one
span behind. Both axes are a quarter-circle sine/cosine law, so a track swept anywhere keeps its
loudness — a linear law dips by 3 dB in the middle of every sweep, which is heard as the sound
receding as it passes the centre, and is the reason no desk uses one.

Mixing three amplitudes at once loses the same 3 dB: amplitudes add and power is their square. The
first version of this did exactly that, and the check that measures power at fifteen positions caught
it.

**A stereo track keeps its width.** Each of its two channels is placed a whole pan-width to its own
side, so a bed left where it is comes out of the front pair the way it went in — not summed to mono and
placed as a point, which is what a music bed cannot survive. Panned to an edge the two halves converge
and the track becomes a point, because there is nothing beyond the last speaker to spread into. Pan a
bed inwards and the half that reaches the middle lands on the **centre** speaker, which is what a
centre channel is for.

**The LFE is a send, not a place.** What goes there is a band: a low-pass at the 120 Hz the
specification for that channel names, taken from both channels so a track panned hard to one side still
reaches the subwoofer. A position never puts anything there.

**Built out of gains rather than out of `PannerNode`.** That node is a stereo device — it renders a 3D
position to two channels through HRTF or an equal-power law and has no notion of a centre speaker or an
LFE. A surround panner *is* a table of gains, so this is a splitter, a gain per destination and a
merger, and `surroundGains` is the one place the table is decided.

**Delivery.** The export renders at the project's layout and encodes it where the machine can: a 5.1
mix the browser cannot encode is written in **stereo** rather than in silence, and the placement is not
thrown away doing it — the graph still puts every track where the mix says, and the two-channel render
folds six down by the standard rules. What is lost is the delivery format, not the mix.

A strip's meter reads the track and not the loudest speaker, which is why the tap moved ahead of the
panner when this arrived. In stereo the two are the same number.

**Measured, not asserted.** Fifteen positions for constant power, and a real six-channel render for
every claim: a bed at the front lands on the front pair and nothing behind, pushed back it lands on the
rear pair, panned inwards it reaches the centre speaker, forty hertz passes the LFE send while a
kilohertz is four times down, and half a send arrives at half the level.

## Level meters

Every strip carries a meter, the track strips and the master alike, and every one of them is a real
tap in the signal path rather than a bar beside it: an `AnalyserNode` sits **in** the line, because a
node with no route to the output is not processed at all and a meter hung off the side would read
zero for exactly as long as nobody checked. An analyser passes its input through unchanged, which is
why the export still renders sample for sample the same as playback does.

A track's tap sits **after** its fader and its pan, so a strip reports what that track is sending and
not what its clips were before anyone touched the desk. Mute and solo are on the bus gain ahead of
it, so a silenced track reads silent.

Three numbers per bar, all in dBFS:

- **Peak** — the loudest sample in the window, drawn as the pale part of the bar. This is what says
  whether anything clipped.
- **Effective value** — the root mean square, drawn solid. This is what the eye reads as loudness: a
  sine's peak stands 3 dB above its own effective value and a square wave's does not.
- **Hold** — a marker at the loudest peak lately, falling at 20 dB a second. A transient that lasts
  one buffer is one nobody sees without it.

The bar is linear in **decibels** over a 60 dB scale, not in amplitude: half the bar is 30 dB down.
That is the whole reason a meter is readable — the quiet end of the range gets as much room as the
loud one. The last six decibels turn the bar red.

The whole desk is read once per animation frame and nothing about it goes through React: the loop
writes three lengths and one class straight onto the elements. A mixer with ten strips costs one
`getFloatTimeDomainData` per strip per frame over a 2048-frame window, and no re-render at all.

::: warning What is not measured
A headless browser has no audio output, so the meters *moving while the transport rolls* is the one
thing the tests cannot see. What is measured is everything either side of it: the arithmetic against
real rendered samples, and the taps themselves against a real offline render — a track at half gain
reads −6.02 dBFS through the real `AnalyserNode`.
:::

## Bringing a project to a target

The mixer's master strip offers the three targets anyone actually asks for — −14 LUFS for streaming,
−16 for a podcast, −23 for broadcast — and a button that moves the master fader until the programme
measures there.

**It measures again after correcting.** What appears in the readout afterwards is a reading and never
the target that was asked for, which matters in the cases where the target cannot be reached: a
programme already at the fader's ceiling of 4, or a silent one, then says so with a number instead of
claiming success.

::: tip Why one pass lands, and why it is checked anyway
The fear is the reasonable one: a compressor or a limiter is not a gain, it stops limiting as its
input comes down, and `DynamicsCompressorNode` adds its own makeup on top. It does not apply here,
and the reason is the wiring rather than the node — **inserts sit ahead of the fader**, so the
mastering chain sees the same signal at every fader setting and the fader is a plain gain over
whatever leaves it. Measured, with a limiter engaged twenty decibels under the material: one pass.

What does not follow is that the arithmetic may be believed. The R128 gates are level-dependent —
moving a programme changes which of its blocks clear the absolute gate at −70 LUFS — so what comes
back is always a reading.
:::

## Ducking

Pulling the music down while somebody is talking. Pick the voice track from the picker on the music
track's strip, and the music comes down while the voice is there and back up after.

**It writes keyframes, not an automatic.** The music bus gets a `Gain` insert and a curve on it: four
corners a phrase — open, down, down, open — the fall taken a quarter of a second *before* the phrase
starts, because a bed that begins to come down on the first syllable has already covered it, and the
rise half a second after. Two phrases close enough that the rise would still be climbing when the
next fall began leave the bed down in between, which is what a console does and what an editor would
have drawn by hand.

Because it is keyframes, the whole of it is yours afterwards: every corner is a value on a row in the
strip, with the same diamond, the same previous and next, and the same interpolation the inspector
gives any other parameter. Ducking again over a re-cut voice track replaces the curve rather than
laying a second one over it, and the whole duck comes off in a single undo.

::: tip Why not a sidechain compressor
Because the Web Audio API has no sidechain. `DynamicsCompressorNode` takes one input and there is no
second one to key it off, so a sidechain here would have to be built out of an analyser and a gain
written per animation frame — the staircase every other envelope in this graph exists to avoid. The
keyframes cost nothing extra: the insert chain already automates every parameter it has, sample by
sample on the audio thread, and preview and export read the same track of them.
:::

The insert sits ahead of the fader like every other one, so the duck and the strip's own fader
multiply rather than fight — and so do the duck and a clip's fade, which is on the clip gain further
upstream. Measured: a bed at half gain under a fade at half reads a quarter.

## Finding and cutting silence

The button on a track strip finds the pauses in it and takes them out, leaving a gap where each one
was.

The detection is read from **the peaks the timeline is already drawing**, at a resolution fine enough
for the job — the samples were decoded for playback and scanned once for the strip, so this is a
third pass over a few thousand floats rather than over a few million. A bucket counts as sounding if
it reaches −40 dBFS; gaps shorter than 250 ms are inside a phrase rather than between two and get
closed up; what is left and still shorter than 150 ms was a click and not a phrase; and every phrase
is grown by a tenth of a second at both ends, so the cut falls in the pause and not on the first
syllable.

A bucket is turned back into a moment by inverting the core's own source mapping, not by dividing a
duration. That is what makes it right for a clip that is not playing straight: under a speed ramp the
peaks are laid out over the *buffer*, and the buffer is not proportional to project time at all. A
reversed clip needs no case of its own — its buffer is already the reversed copy the graph plays.

::: warning A gap, not a ripple
The cut leaves everything after it where it stands. Rippling would pull the rest of this track
earlier and leave every other track — the picture the voice belongs to above all — where it was.
Silence removal is worth having; silence removal that walks the sound off the lips is not. Closing
the timeline up afterwards is a ripple-delete on the gaps, which is one command you can see and undo.
:::

## What is not here yet

Named rather than hinted at, because a control that does nothing is worse than no control:

- **Filter shapes other than a peaking band.** The equaliser cannot be a high- or low-pass, because a
  filter type is a choice and the effect manifests carry floats only. `ParamValue` already has a
  `choice` kind; the shelves arrive with the widget that can edit one.
- **Gain-reduction metering.** The strips show what a bus is sending; how hard its compressor is
  working is a second reading, and `DynamicsCompressorNode.reduction` is where it would come from.
- **Layouts beyond 5.1.** 7.1 and Atmos are more channels and, for the second, a renderer of another kind. `AUDIO_LAYOUTS` in the core is where a third entry would go.
- **Bus automation in the timeline's keyframe lane.** A duck's corners are editable on the strip
  that wrote them, with the same controls the inspector uses; the lane below a clip draws clip
  keyframes only, and drawing a track's would mean giving a lane an identity that is not a clip.
- **True peak (dBTP).** The peak reading is sample peak; an inter-sample peak needs oversampling.
- **Lip sync is nowhere measured.** Headless browsers have no audio output, so the offset between
  picture and sound is reasoned about rather than observed.
