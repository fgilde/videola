# Templates

**Built.** A gallery, a wizard, four shipped templates, and a `.videolat` file you can hand to
someone else. What comes out at the end is an ordinary project: the same editor, the same commands,
the same undo stack. There is no template mode to leave.

## What a template can promise

This version of the renderer draws media clips, a transform, one cross dissolve, one brightness
effect and a background colour. It has no text engine and no effect library. Every shipped template
is built out of exactly that list, because a gallery entry that produces a blank screen is worse
than no gallery at all.

| Template | What it is | What it shows working |
|---|---|---|
| Three Shots | three shots dissolving into one another, 6.5 s | the cross dissolve |
| Bookend | one shot opens and closes, a second carries the middle, 7 s | one placeholder writing into two clips; fading up from black and back into it, with a keyframed brightness |
| Vertical Story | four quick cuts in a 9:16 frame, 7.2 s | landscape footage fitted to fill an upright frame |
| Picture in Picture | one shot full frame, a second small in the corner, 6 s | two stacked tracks and a fit into a rectangle |

None of them carries footage. A template is a recipe; shipping video with it would make every entry
as heavy as the project it came from, and would put someone else's material in the gallery instead
of the template's own idea. The card therefore shows the **timeline the template will build**, read
straight off its project, rather than a preview video.

## Placeholders

A placeholder — a *slot* — has a kind, a label and a hint in both languages, and one or more
**bindings** that say where its value lands:

| Binding | Kind | Where the value goes |
|---|---|---|
| `clipMedia` | media | a clip's source, plus the transform that fits it into the frame |
| `clipLabel` | text | a clip's name on the timeline |
| `projectTitle` | text | the project's name, the browser tab and the exported file name |
| `background` | color | `settings.background`, seen wherever no picture covers the frame |

The specification writes a binding as a `path` string. An enum of the places a value can actually
reach is fewer lines than a JSON-pointer writer, and it cannot name a field that does not exist.
Every variant above is something a viewer can see today; the day generators render, the list grows
by a variant rather than by a mechanism.

One slot may hold several bindings, and that is the point of the design: the Bookend template's one
media slot fills both the opening and the closing clip.

There is no audio slot. A music bed would need either a file shipped with every template or an
upload for every use, and no harness in this repository can hear the result — headless Chrome has no
output. It is a slot kind, not a mechanism, and it costs one variant to add later.

## Fitting

A media answer arrives with the material's width and height, and the frame is known only once the
wizard has been answered — so the transform is worked out at bake time and not by the author. A
binding carries a rectangle in fractions of the frame and a mode:

* **cover** fills the rectangle; whatever does not fit runs past its edges. This is what makes one
  template serve 16:9, 9:16 and 1:1 from the same footage.
* **contain** fits inside the rectangle; whatever is left over stays empty. This is what the
  picture-in-picture inset uses, because a cover fit into a small box would spill out of it.

Only scale and position are written. Rotation, opacity, crop and the anchor stay as the template
authored them, so a fit cannot quietly undo an authored look.

## Material that is too short

The rhythm is the template. A file shorter than its slot is therefore **slowed** rather than
shortened: a shorter clip would leave a hole where the next dissolve expects a picture, and moving
the clips after it would be a different template than the card showed. Past four times slower a shot
reads as a freeze rather than as slow motion, and the bake refuses instead.

Material longer than the slot plays at its own speed and the rest of it is simply not used.

The wizard states the length each slot wants; the core decides what it refuses. Repeating the
refusal rule in the interface would be a second authority to keep in step.

## The file format

`.videolat` is the `.videola` container plus one entry:

```
videola.json      the same manifest a project has
project.json      the project, with placeholder clips
template.json     id, version, names, categories, frames, slots, steps
media/<sha256>…   only if the template brings material of its own
```

Reusing the container means the size caps, the content-addressed media naming, the migration path
and the "missing media is a warning, not a failure" behaviour are already written and already
tested. The same bytes still open as a project — a template is a project with questions attached,
not a second kind of file.

## The loading gate

`Template::normalize` is the one door, whichever way a template arrived: from the shipped set, from
a file, or back across the WebAssembly boundary from JavaScript that may have edited it. It runs
`Project::normalize` first and then checks the manifest:

* the schema version, the id, and a cap of 64 slots
* every offered frame against the same bounds a project's own width and height meet
* slot ids present and unique, and every binding legal for its slot's kind
* every binding naming a clip that exists — and, for a media binding, a clip that is a media clip
* every slot appearing in exactly one step. A required slot no step asks about would let the wizard
  hand the bake an answer set it is bound to refuse, and the dead end would only show itself on the
  last button of the flow.
* **every clip either filled by a slot or backed by material the template brought itself.** This is
  the rule against the empty gallery entry.
* no generator and no compound clips. The draw list drops both today, so a template built on them
  would look complete in the timeline and be blank on the screen.

A colour answer is not judged where it is written but where every other setting is judged: the bake
ends in `Project::normalize`, and `settings.background` is now checked there. The compositor reads
an unparsable colour as opaque black without complaining, which turned a typo into a colour instead
of a message.

## Bake-to-project

```
bake(template, answers, frame?) → Project
```

A fresh project id, the chosen frame, every answer applied, unanswered optional media clips removed
(a clip pointing at material that does not exist draws nothing at all), a note of which template it
came from under `template` in the project, and then the ordinary load gate.

Times are integers in flicks throughout, so baking the same template at 25 fps and at 30 fps gives
byte-identical clip positions. A template cannot drift onto another frame rate.

`template.instantiate` is deliberately **not** a command. Commands are edits with an inverse, and
"this project came into existence" has none. Baking is a document constructor, like opening a file,
and everything after it is a command like any other.

## Author mode

The specification describes marking slots in an existing project and exporting it. What is built is
the honest half of that: **Save this project as a template**, from the gallery. Every medium the
project uses becomes a required slot bound to every clip that uses it, the material stays behind, and
a title and a background-colour slot are added. One click, no second editor mode, and the loop is
closed — the file it writes is a file the gallery can open and bake.

Marking slots by hand, naming them, and grouping them into steps is a small editor of its own. It is
worth building when someone has a template they want to *shape*, not merely share.

## What is not there

* On-screen titles. The title slot names the project, the browser tab and the exported file, and the
  hint in the wizard says exactly that. A slot claiming a title in the picture would be the emptiest
  promise in the gallery.
* A remote catalogue. The shipped set is offline and additive; `GET /api/templates` is a later
  milestone that adds entries to the same gallery.
* Filters and search. Four cards need neither.
* Swapping a slot's material after baking. The bake records which template a project came from but
  not the live bindings, because nothing yet offers that button.
