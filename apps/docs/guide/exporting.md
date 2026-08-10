# Exporting

**Built.** A project can be written out as an MP4 with H.264 and AAC, or as a WebM with VP9 and
Opus where the browser cannot encode H.264. Everything happens in the browser: there is no server
and no FFmpeg anywhere in the path.

## What actually runs

The export renders the timeline offline, frame by frame, through the **same compositor class the
preview uses**. That is the whole point of the arrangement — a second render path is the one way a
finished file can disagree with what was on screen while you cut it.

For each output frame:

1. The core is asked where every visible clip reads from at that instant.
2. The decoders are asked for those source frames.
3. The compositor draws them into an `OffscreenCanvas` at the export resolution.
4. `VideoEncoder`, via [mediabunny](https://mediabunny.dev), encodes the canvas and the muxer
   appends it.

The sound is rendered separately in one pass by an `OfflineAudioContext` running the same audio
graph as playback, and the samples are handed to the encoder as one track.

## It runs in a worker

An export of a few minutes is a few minutes of solid decoding and encoding. On the main thread that
is a frozen window, so the run lives in a dedicated worker (`packages/engine/src/export/worker.ts`)
with its own WebGL2 context on an `OffscreenCanvas`.

One part stays on the main thread and cannot move: **Web Audio is a Window API.**
`OfflineAudioContext` does not exist in a worker — measured in Chrome, not assumed — so the sound is
rendered on the main thread and its samples are transferred into the worker. Offline rendering is
not real-time and does not block the interface.

The other part that stays behind is the question "where does this clip read from?". The Rust core
lives on the main thread, and `WasmDocument` can be built from a `.videola` file or from nothing,
never from a `Project`. The answer for every output frame is therefore collected before the run
starts and travels with the request.

## Timestamps come from the model

Every output frame sits on the project's own ruler: the range start plus whole frame durations in
[flicks](/guide/architecture#time-is-an-integer). Nothing reads a timestamp back out of a decoder.

This is not pedantry. `EncodedPacket.microsecondTimestamp` truncates: frame 10 of an NTSC file lies
at 333,666.67 µs and travels as 333,666. A file whose frames were placed from those numbers drifts
by a whole frame every thirty-three seconds.

## The format menu only offers what encodes

Which codecs a browser can *encode* is not the same question as which it can play, and it differs
between Chromium, Firefox and Safari — and between machines, because a 4K H.264 encode can be
refused where 1080p is fine. So the dialog asks `VideoEncoder.isConfigSupported` and
`AudioEncoder.isConfigSupported` at the size and sample format the run will really use, and offers
only what answered yes.

If H.264 is not available, the dialog says so in your language and offers WebM with VP9 instead. If
the audio codec is not available, it says the export will be silent rather than failing halfway.

## The dialog

| Setting | Notes |
|---|---|
| Preset | 1080p, 4K, 720p, upright 1080 × 1920, square 1080 — fills the size fields below |
| Format | MP4 (H.264 + AAC) or WebM (VP9 + Opus), filtered by what encodes |
| Width, height | Default from the project; both edges are kept even, because every codec here samples chroma at half resolution |
| Frames per second | Rational throughout — 30000/1001 is offered as itself, never as 29.97 |
| Bitrate | In Mbit/s. The suggestion follows the resolution and rate until you type your own |
| Range | The whole project, or the selected clip |

A preset carries **sizes and frame rates only**, never a bitrate: the suggestion is computed from the
size and the rate, so a preset that brought its own would be a second opinion about the same question —
and the wrong one would be whichever nobody recomputed after changing the size. Picking one therefore
hands the bitrate field back to that suggestion, even if a number had been typed into it: a bitrate
chosen for 720p is not the bitrate for 4K.

The project's own frame rate is kept unless a preset insists on one. Quietly moving a 25 fps edit to 30
would drop or repeat a frame in five, and nothing in the word "1080p" asked for that. The select
returns to its own heading after a pick, because it names an action and the fields under it are the
state.

Progress is counted in output frames and reaches a hundred percent on the last one. **Cancel really
stops it**: the worker is ended, and because the file only ever exists in that worker's memory,
there is nothing half-written to clean up.

## How this is known to work

A green unit test proves nothing about a video file. `pnpm --filter @videola/engine test:export`
therefore drives the real thing in headless Chrome:

- it encodes a colour-coded H.264 fixture and a tone, imports both through the real import path
  into OPFS and the real Rust core,
- exports one second of the resulting project through the real worker,
- reads the file back with the demuxer and checks resolution, frame rate, length, frame count,
  frame order and the colour of individual pictures,
- writes the file to disk and hands it to **ffprobe and ffmpeg**, which share no code with anything
  in this repository, to confirm the codec, the resolution, the frame rate, the frame count, the
  length, the audio stream, and that every frame decodes,
- decodes the audio back and measures that the tone that went in is the tone that came out.

## Handing the cut to another editor

Two files leave here that are not video: an **EDL** and **FCPXML**, both in the overflow menu beside
the subtitles. A cut assembled in Videola can be finished in DaVinci Resolve, Premiere Pro or Final
Cut — the assembly travels, and the grade and the effects are done there.

Neither carries an effect, a keyframe or a grade, and that is not a gap to be closed later: there is
no honest way to write a Videola blur as a Resolve one. What both carry is where every piece of
material sits, which is what a conform needs.

| | EDL (CMX3600) | FCPXML 1.9 |
|---|---|---|
| Tracks | one video, one audio | every track, on lanes |
| Names | relink by clip name | relink by asset, keyed by content hash |
| Read by | practically everything | Resolve, Premiere, Final Cut |
| Times | timecode, `HH:MM:SS:FF` | exact rationals |

The EDL says which tracks it could not carry, in a comment, rather than dropping two layers quietly.
Its timecode is always non-drop, and where the project runs at a fractional rate — 30000/1001 — a
comment says so, because a duration read off that clock by hand comes out a little short.

FCPXML rounds nothing. A time is written as `value/timescale s` with the frame rate's numerator as the
timescale, and because a flick is 705,600,000 to the second and divides evenly by every rate anyone
uses, every instant in a project is a whole number of ticks. A clip with no medium behind it — a
title, a colour, a compound — travels as a gap of the right length rather than as an asset pointing at
nothing, which would open in the other system as an offline clip somebody has to hunt for.

Both are written in the Rust core, next to the reader and the writer, and for the same reason: a
timecode is integer arithmetic over a rational rate, and a second implementation in TypeScript would
be a second answer to the same question. `project_handOff` offers both to an agent, and refuses a
format it does not write rather than defaulting to one — being handed FCPXML after asking for AAF is
the worst of the three possible answers.

## What is not there yet

- **No FFmpeg, native or server rendering.** Export is WebCodecs only; the Tauri shell hosts the
  web bundle and runs the same path.
- **Effects and transitions are not in the picture yet**, because the effect chain itself is not.
  What the compositor draws today is what the export writes.
- **Reversed clips are silent**, as they are in playback: an `AudioBufferSourceNode` has no
  negative playback rate.
- **The whole range's sound is rendered and held in memory at once.** An hour of stereo is about
  1.4 GB of samples. A scheduling window is the way out and it is not built.
- **The source times for the whole range are collected before the run.** At 30 fps an hour is
  108,000 calls across the WASM boundary, about a second of work before the export starts.
