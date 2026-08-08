# Audio

The sound leads and the picture follows. Elapsed time is read from the audio context, because drift
in audio is audible and a dropped frame is not — every position the editor shows comes from
`AudioContext.currentTime` by way of the clock, and nothing derives project time from a decoder
timestamp.

## The graph

```
Clip → buffer source → clip gain (volume, fades)
     → track bus (gain for volume/mute/solo → stereo panner)
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

## What is not here yet

Named rather than hinted at, because a control that does nothing is worse than no control:

- **EQ and compression on the track bus.** `Track.effects` exists in the model and serialises, but
  `effect.add` and `effect.setParam` address clips only, so there is nowhere to persist band settings
  yet. The audio side is short once there is: `BiquadFilterNode` and `DynamicsCompressorNode` are
  native.
- **A master fader.** `project.master.volume` is in the model and the graph honours it, but no command
  writes it.
- **Live level metering.** Peak and gain-reduction meters need a per-bus analyser read per frame.
- **Ducking, noise reduction, beat detection, spatial panning beyond stereo.**
- **True peak (dBTP).** The peak reading is sample peak; an inter-sample peak needs oversampling.
- **Lip sync is nowhere measured.** Headless browsers have no audio output, so the offset between
  picture and sound is reasoned about rather than observed.
