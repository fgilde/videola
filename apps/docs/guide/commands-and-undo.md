# Commands and undo

Every edit is a serialisable command. There is no code path that mutates the project directly, which
is what makes undo, and later a REST API and an MCP server, fall out of one mechanism instead of
three.

The bus lives in `crates/videola-core/src/command`, the history in
`crates/videola-core/src/history.rs`, and the two are joined by `Document` in
`crates/videola-core/src/document.rs`.

## The twenty commands

`videola-core` defines twenty commands today. The design reserves a much wider set — keyframes,
masks, transitions, text, markers, audio chains, render and templates — but none of those exist yet.

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

`source` is one of three shapes: `{ kind: "media", media }`, `{ kind: "generator", generator }` for
text, solid, shape, gradient and countdown clips that need no media file, or
`{ kind: "compound", timeline }` for a nested timeline. `edge` is `start` or `end`, and `delta` is a
signed `Time`, so one command covers trimming in either direction from either edge.

Playing a range backwards is `clip.setSpeed` with `reverse: true`, not a separate clip type — split
the clip and set the flag on the middle piece.

### `effect.*`

| Command | Fields |
|---|---|
| `effect.add` | `clip`, `effectType` |
| `effect.setParam` | `clip`, `effectType`, `key`, `value` |

These maintain the model only. Nothing renders an effect yet. `value` is a tagged
`ParamValue`: `float`, `int`, `bool`, `color`, `vec2` or `choice`.

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
operation changes without it. Twenty commands mean twenty inverses to keep honest, and the count only
grows: the roadmap adds keyframes, masks, transitions, nesting and an audio chain.

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
consecutive drags of different clips from merging into one step. A dispatch with no key never
coalesces, and a dispatch whose key does not match the top of the stack starts a new entry, so ending
a gesture requires no explicit "commit" call — the next unrelated edit ends it.
