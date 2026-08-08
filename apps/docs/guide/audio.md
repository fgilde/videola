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

One strip per track, ordered the way the timeline stacks them rather than the way the core stores
them — `tracks[0]` is the bottom of the stack, and a mixer listing them in that order would put the
top track's strip last.

Each strip carries a volume fader, a pan control from left through centre to right, and the mute and
solo buttons. One drag of a fader is one step in the undo history, not one per pixel.

Below those sits the strip's insert chain: a button per effect the build can make a sound with, and
once one has been added, a row per parameter with the same keyframe controls the inspector uses. A
row reports the value the **core** resolved for the playhead, clamped to the range the effect
declares — the same clamp the graph applies before the number reaches a filter, so what is read is
what is heard.

Last on the right, set apart by a border, is the **master strip**: the project's own fader and the
mastering chain. Everything to its left feeds it.

## What is not here yet

Named rather than hinted at, because a control that does nothing is worse than no control:

- **Filter shapes other than a peaking band.** The equaliser cannot be a high- or low-pass, because a
  filter type is a choice and the effect manifests carry floats only. `ParamValue` already has a
  `choice` kind; the shelves arrive with the widget that can edit one.
- **Live level metering.** Peak and gain-reduction meters need a per-bus analyser read per frame.
- **Ducking, noise reduction, beat detection, spatial panning beyond stereo.**
- **True peak (dBTP).** The peak reading is sample peak; an inter-sample peak needs oversampling.
- **Lip sync is nowhere measured.** Headless browsers have no audio output, so the offset between
  picture and sound is reasoned about rather than observed.
