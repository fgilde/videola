# Commands and undo

Every edit is a serialisable command. There is no code path that mutates the project directly, which
is what makes undo, and later a REST API and an MCP server, fall out of one mechanism instead of
three.

The bus lives in `crates/videola-core/src/command`, the history in
`crates/videola-core/src/history.rs`, and the two are joined by `Document` in
`crates/videola-core/src/document.rs`.

## The twenty-six commands

`videola-core` defines twenty-six commands today. The design reserves a wider set still — masks,
text, markers, audio chains, render and templates — but none of those exist yet.

### `project.*`

| Command | Fields |
|---|---|
| `project.setSettings` | `settings` |
| `project.setTitle` | `title` |

### `track.*`

| Command | Fields |
|---|---|
| `track.add` | `kind`, `name`, `index` |
| `track.remove` | `track` |
| `track.reorder` | `track`, `toIndex` |
| `track.rename` | `track`, `name` |
| `track.setVolume` | `track`, `volume` |
| `track.setPan` | `track`, `pan` |
| `track.setFlags` | `track`, `muted`, `solo`, `locked`, `hidden` |

`track.setFlags` takes each flag as a nullable value so one command can change any subset of them;
`null` means "leave alone". `kind` is one of `video`, `audio`, `text`, `overlay` or `adjustment`.

### `clip.*`

| Command | Fields |
|---|---|
| `clip.add` | `track`, `source`, `start`, `duration` |
| `clip.remove` | `clip` |
| `clip.move` | `clip`, `toTrack`, `start` |
| `clip.trim` | `clip`, `edge`, `delta` |
| `clip.split` | `clip`, `at` |
| `clip.setSpeed` | `clip`, `rate`, `reverse`, `preservePitch` |
| `clip.setVolume` | `clip`, `volume` |
| `clip.setTransform` | `clip`, `transform` |
| `clip.setTransition` | `clip`, `transition` |

`source` is one of three shapes: `{ kind: "media", media }`, `{ kind: "generator", generator }` for
text, solid, shape, gradient and countdown clips that need no media file, or
`{ kind: "compound", timeline }` for a nested timeline. `edge` is `start` or `end`, and `delta` is a
signed `Time`, so one command covers trimming in either direction from either edge.

Playing a range backwards is `clip.setSpeed` with `reverse: true`, not a separate clip type — split
the clip and set the flag on the middle piece.

`clip.setTransform` carries the whole `Transform` — position, scale, rotation, anchor, opacity and
crop — the same way `clip.setSpeed` carries all three speed fields and `project.setSettings` carries
all of the settings. Read the clip's current transform, spread the one field that changed, send it
back. A per-field command would need a null for every field it does not touch and still could not
express "put the crop back the way it was". This is also the only way a clip whose media is smaller
than the frame gets scaled up: the draw list maps one source pixel onto one project pixel, so a
640x360 clip in a 1080p project sits in the middle at its own size until a transform says otherwise.

`clip.setTransition` writes the clip's *incoming* edge, and `null` clears it, so one command adds a
transition, retimes it and removes it again. There is no command for the outgoing edge because
nothing reads one: a transition is drawn by mixing the incoming clip into the picture the frame
already holds, so it belongs to the clip that arrives. A `Transition` is `{ transitionType,
duration, alignment, params }` with `alignment` one of `in`, `out` or `center`. A cleared transition
is *absent* from the clip rather than `null` — the field is skipped when it is none.

### `effect.*`

| Command | Fields |
|---|---|
| `effect.add` | `clip`, `effectType` |
| `effect.setParam` | `clip`, `effectType`, `key`, `value` |

`value` is a tagged `ParamValue`: `float`, `int`, `bool`, `color`, `vec2` or `choice`. Both commands
address the effect by `effectType` rather than by `EffectId`, so two effects of the same type on one
clip cannot be told apart from the outside — the model allows it, the command catalogue does not
reach it.

### `keyframe.*`

| Command | Fields |
|---|---|
| `keyframe.add` | `clip`, `effectType`, `key`, `time`, `value`, `interp` |
| `keyframe.remove` | `clip`, `effectType`, `key`, `time` |
| `keyframe.move` | `clip`, `effectType`, `key`, `from`, `to` |
| `keyframe.setInterp` | `clip`, `effectType`, `key`, `time`, `interp` |

Keyframes address an effect parameter, the same `clip` plus `effectType` plus `key` triple that
`effect.setParam` uses. A parameter with a keyframe track is read from the track; a parameter
without one is read from the static value `effect.setParam` wrote. The static value survives
underneath, so removing the last keyframe takes the parameter back off the clock rather than
freezing it — and `keyframe.remove` drops the empty track from the model so that nothing later
mistakes "keyframed with no keys" for "keyframed".

`keyframe.add` is an *upsert*: sending it again at a `time` that already carries a key replaces that
key rather than adding a second one there. That is what makes a slider drag over a keyframed
parameter the same shape as a clip drag — one dispatch per pointer move, all of them under one
coalesce key, one entry on the undo stack (see below).

`interp` is `linear`, `hold`, `ease` or `bezier`. Bezier handles exist in the model but no command
writes them; a bezier key without handles uses the ease-in-out defaults. `keyframe.move` refuses to
land on a time another key already occupies rather than silently replacing it, but moving a key to
where it already is is accepted — a drag cannot know in advance that it went nowhere.

Keyframes on a *clip* property — opacity, volume, a transform field — have a place in the model and
no command, because nothing evaluates them: only `Effect::param_at` reads a keyframe track, so
writing one on a clip would be a promise with nothing behind it.

### `media.*`

| Command | Fields |
|---|---|
| `media.import` | `asset` |
| `media.remove` | `media` |

`media.remove` also removes every clip that used the asset, walking into nested compound timelines to
do it.

## Wire format

Commands are a `serde` tag/content enum with a dotted tag and camelCase fields, so the JSON a
TypeScript client sends is the JSON Rust deserialises:

```json
{ "type": "clip.move", "clip": "clp_1", "toTrack": "trk_1", "start": 42 }
```

`start` is a plain integer because `Time` serialises transparently as flicks. A command is wrapped in
a dispatch envelope that adds the optional coalesce key:

```json
{
  "command": { "type": "clip.move", "clip": "clp_1", "toTrack": "trk_1", "start": 42 },
  "coalesceKey": "drag:clp_1"
}
```

In TypeScript the `cmd.*` helpers in `@videola/core` build the command objects, and
`VideolaDocument.dispatch(command, coalesceKey?)` sends them:

```ts
import { cmd, createWasmBackend, VideolaDocument } from "@videola/core";

const doc = new VideolaDocument(await createWasmBackend());
doc.dispatch(cmd.trackAdd("video", "V1"));
doc.undo();
doc.redo();
```

`media.import` has no `cmd.*` helper, because the caller does not compute the content hash itself.
`doc.importMedia(file, bytes)` hands the bytes to the core, which hashes them, builds the
`MediaAsset` and dispatches the command; it returns the resulting `MediaId`.

## Dispatch and patch

`Document::dispatch` does five things, in this order:

1. Serialise the current project to JSON — call it `before`.
2. Clone the project and apply the command to the clone.
3. Serialise the clone — call it `after`.
4. Diff `before` against `after`, and `after` against `before`, giving the forward patch and its
   inverse.
5. Push the pair onto the undo stack, clear the redo stack, and adopt the clone as the new project.

Every dispatch returns the same result shape:

```ts
interface DispatchResult {
  patch: JsonPatch;       // RFC 6902 operations
  label: string;          // a catalogue key, e.g. "cmd.track.add"
  canUndo: boolean;
  canRedo: boolean;
}
```

The patch is what makes the boundary cheap. The front end does not need the whole project back after
every edit; it gets the operations that changed. The `label` is a catalogue key rather than a
sentence, so history entries are translated by the interface — the core never emits user-visible
prose.

Two details of step 5 are deliberate:

- **A command that changes nothing records nothing.** If the diff is empty, no history entry is pushed
  and the redo stack is left alone. Setting a title to the value it already has does not cost an undo
  step, and it does not throw away a redo the user may still want.
- **Redo is cleared last.** Clearing it before the history entry is safely in place would discard
  redo history that a failed patch operation never invalidated.

Undo pops nothing until the inverse patch has applied successfully. `undo` peeks at the top entry,
applies its inverse, and only then moves the entry to the redo stack — moving it first would lose
the entry permanently if the apply then failed.

The undo stack holds 500 entries and trims from the oldest end.

## Why diffs instead of written inverses

The conventional design gives each command an `undo` method. Videola does not, and that is the point
of the diffing.

A hand-written inverse is code that only runs when a user presses Ctrl+Z after that specific command.
It is therefore the least-exercised code in the editor, and it goes stale the instant the forward
operation changes without it. Twenty-six commands mean twenty-six inverses to keep honest, and the
count only grows: the roadmap adds masks, nesting and an audio chain. The six commands this
milestone added cost nothing on the undo side — a test asserts that every variant in the catalogue
dispatches and undoes back to the exact prior state, and the new ones passed it the day they were
written.

A diff has none of those properties. The undo machinery is written once, exercised by every command,
and already correct for command twenty-one before that command is written. The Rust test suite leans
on this directly: a command's correctness test can assert that dispatch followed by undo restores the
exact starting state, because that property is structural rather than per-command.

What it costs is a clone and two serialisations per dispatch. The code marks this as the thing to
revisit if drag-frequency dispatch on large projects ever makes it visible, and the fix is local —
build patches by hand per command, keep the history structure unchanged.

The clone earns part of its keep independently. `media.remove` walks nested compound timelines and can
fail on the depth cap after clips at shallower levels have already been removed. Because handlers
mutate the clone, that partial mutation is discarded and the project is left untouched: the command
either fully applies or does not apply at all.

## Coalescing collapses a drag into one undo step

Dragging a clip does not produce one edit. It produces one `clip.move` per pointer move, which
without further arrangement would mean a hundred undo steps to get back to where the drag started.

The dispatch envelope carries an optional `coalesceKey`. If the entry currently on top of the undo
stack has the same key, the new command does not push a new entry — it rewrites the existing one so
that it spans from the start of the group to the current state:

1. Reconstruct the state the group began in, by applying the top entry's inverse patch to `before`.
   That state is not stored anywhere; it is recovered from the entry itself.
2. Replace the top entry's forward patch with the diff from that group start to `after`, and its
   inverse with the diff back.

The stack therefore keeps exactly one entry for the whole drag, and that entry's inverse restores the
position the clip had when the drag began — not the position it had one pointer move ago.

The key is chosen by the caller and only has to be stable for the duration of the gesture and unique
against unrelated edits. `"drag:clp_1"` is the natural shape: including the clip id keeps two
consecutive drags of different clips from merging into one step. An inspector slider needs the same
care one level deeper — the key has to name the field as well, or dragging `x` and then `y` merges
into a single undo step that puts both back at once. A dispatch with no key never
coalesces, and a dispatch whose key does not match the top of the stack starts a new entry, so ending
a gesture requires no explicit "commit" call — the next unrelated edit ends it.
