# Templates

**Built.** A gallery with nine templates in five categories, each card a picture rendered from the
template itself; a wizard that shows what it is building while you fill it in; and a `.videolat` file
you can hand to someone else. What comes out at the end is an ordinary project: the same editor, the
same commands, the same undo stack. There is no template mode to leave.

## The constraint that shapes everything

**There is no footage in this repository and there is not going to be any.** A template is a recipe;
shipping video with it would make every entry as heavy as the project it came from, and would put
someone else's material in the gallery instead of the template's own idea.

So a template is built out of what the renderer can draw from a project file alone: the text
generator with its entry, exit and loop moves, solids and gradients, the ten effects, the five
transitions, masks, and keyframed transforms including a motion path. Your own material arrives
through the placeholders.

This is the point rather than a workaround. What a template can honestly show you is rhythm,
typography, colour and movement — and that is exactly what tells you whether it is any good.

## What ships

| Template | Category | What it is | What it shows working |
|---|---|---|---|
| Bold Open | Openings | a title over a colour field hands off to your shot, 6.5 s | text growing in and fading out, a gradient, the zoom transition, a colour that reaches both the field and the background |
| Iris Open | Openings | a circle opens onto the picture, 4.6 s | a mask whose size is keyframed — the only way this version has of revealing a shot out of a shape |
| Soft Slideshow | Slideshows | four pictures dissolving, under a caption, 8.6 s | the cross dissolve at a length you can feel, a masked band lifting words off the picture, a caption that stays put while everything under it changes |
| On the Beat | Slideshows | five short takes on a short beat, 4 s | the wipe, and that its angle is a parameter — each hand-over comes from a different edge |
| Vertical Story | Upright | three upright shots with a hook and a call to action, 6.4 s | the slide transition, landscape material filling a 9:16 frame rather than sitting in bars, text on its own box |
| Split Screen | Upright | two pictures, one frame, 5 s | a cover fit into half the frame plus a rectangular mask holding it there — the pair is what makes a split with no seam |
| Lower Third | Titles and credits | a name and a role over your shot, 6 s | a bar that slides in because its *mask* moves, and two lines timed a fraction apart so they read as one gesture |
| End Card | Titles and credits | the shot fades down, a card takes over, 6.5 s | a keyframed brightness taking the picture to nothing, the dip transition, two closing lines a beat apart |
| Product Reveal | Products | one thing, shown properly, 7 s | a motion path — a `position` keyframe track carrying a line across the frame — plus a vignette and a contained fit |

Between them the nine use **every transition the renderer implements**. That is a test, not a
coincidence: a gallery of nine cards is only worth having if the nine are not the same card.

## The card is a rendered picture

A painted card would be a promise with nothing behind it. It can show a look the renderer would never
produce, and nobody would find out until after they had chosen.

So the card is rendered, through the same path a real answer takes:

```
Template::preview(frame) → Project → renderStills() → one PNG
```

`preview` bakes the template against a **stand-in** for every piece of material — a plain grey
gradient — and then hands back an ordinary project made of nothing but generators. The application
draws it with the same compositor the editor uses. If a card is wrong, the template is wrong.

Three decisions inside that are worth stating:

* **The stand-in is exactly the size of the chosen frame.** A generator is drawn at frame size, so
  the fit arithmetic only puts the grey rectangle where your footage will go if the stand-in claims
  to be that size. A clip fitted to the whole frame therefore comes out at scale 1 in *every* frame
  a template offers, and that is the assertion which fails the moment the stand-in stops following
  the frame.
* **Its ramp is turned a little further for each stand-in in turn.** Two pictures side by side — a
  split screen, an inset over a backdrop — are two different pictures, and drawing both in exactly
  the same grey makes the seam between them disappear, which is the one thing those templates exist
  to show.
* **It is lighter than the card it sits on.** A stand-in darker than the surface behind it made every
  template whose material fills the frame look like an empty card, which hid the good templates
  behind the ones that happened to carry more text.

`posterAt` in the manifest is the instant a card is drawn from. An author picks it, because only the
author knows which second of their build is worth showing and there is no arithmetic that reliably
lands on it.

### What it costs

One small picture per template — 384 px on the longest edge — rendered one at a time in gallery
order, while the dialog is already open and usable. A preview project holds nothing but generators,
so there is **no decoding, no storage read and no network**; `renderStills` builds and disposes its
own WebGL context per call, so exactly one is alive at a time. Nine of them is a few hundred
milliseconds of GPU work that nothing is waiting on.

Every measurement in the text generator is a fraction of the frame, which is what makes rendering at
384 px honest rather than a different picture.

There is no `IntersectionObserver`. The catalogue is bounded by what a person will scroll through, and
the loop is already one at a time and in gallery order — a remote catalogue of hundreds would make
that loop take a filtered list, which is a filter and not a rewrite. Where there is no WebGL at all,
the card falls back to the outline of the timeline the template will build: a smaller claim, still a
true one.

## Placeholders

A placeholder — a *slot* — has a kind, a label and a hint in both languages, and one or more
**bindings** that say where its value lands:

| Binding | Kind | Where the value goes |
|---|---|---|
| `clipMedia` | media | a clip's source, plus the transform that fits it into the frame |
| `clipLabel` | text | a clip's name on the timeline |
| `projectTitle` | text | the project's name, the browser tab and the exported file name |
| `generatorText` | text | the words a text generator puts **on the screen** |
| `background` | color | `settings.background`, seen wherever no picture covers the frame |
| `generatorColor` | color | a generator's own colour: a solid's fill, the first stop of a gradient, or the ink of a title |

`generatorText` is the binding that makes a template look like the person who filled it in rather
than like the template. Both generator bindings are checked against the clip's **actual generator**
and not merely against a clip that exists: a text answer written into a solid colour would vanish
without a word, and the wizard would have asked a question whose answer goes nowhere.

One slot may hold several bindings, and that is the point of the design: Bold Open's title slot fills
both the words on the screen and the project's name.

**Every text slot is optional.** That is what lets a card show something: the template ships the words
it was designed with, so an unanswered title is the designer's line rather than an empty rectangle,
and the wizard starts each field on those words.

There is no audio slot. A music bed would need either a file shipped with every template or an upload
for every use, and no harness in this repository can hear the result — headless Chrome has no output.
It is a slot kind, not a mechanism, and it costs one variant to add later.

## Fitting

A media answer arrives with the material's width and height, and the frame is known only once the
wizard has been answered — so the transform is worked out at bake time and not by the author. A
binding carries a rectangle in fractions of the frame and a mode:

* **cover** fills the rectangle; whatever does not fit runs past its edges. This is what makes one
  template serve 16:9, 9:16 and 1:1 from the same footage.
* **contain** fits inside the rectangle; whatever is left over stays empty. This is what Product
  Reveal's inset uses, because a cover fit into a small box would spill out of it.

A cover fit into *part* of the frame spills over the rest of it on purpose, and is paired with a
`mask-rect` that holds it to its half — that is how Split Screen has no seam.

Only scale and position are written. Rotation, opacity, crop and the anchor stay as the template
authored them, so a fit cannot quietly undo an authored look.

Note that a motion path and a fit answer the same question, and the path wins (see `transform_at`).
Product Reveal therefore puts its path on a **text** clip, which has no fit to fight with.

## Material that is too short

The rhythm is the template. A file shorter than its slot is therefore **slowed** rather than
shortened: a shorter clip would leave a hole where the next transition expects a picture, and moving
the clips after it would be a different template than the card showed. Past four times slower a shot
reads as a freeze rather than as slow motion, and the bake refuses instead.

Material longer than the slot plays at its own speed and the rest of it is simply not used.

The wizard states the length each slot wants; the core decides what it refuses. Repeating the refusal
rule in the interface would be a second authority to keep in step.

## The gallery

* **Categories as chips**, in the order someone works: openings, slideshows, upright, titles and
  credits, products. A category this build has no word for still gets a chip under its own name —
  a template nobody can find is the same as a template that failed to load.
* **The card is the button.** A picture with a control under it makes the largest thing on the screen
  the one part that does nothing, and on a phone it hands the smallest target on the card to the
  thumb that is already over it.
* **The picture box holds the template's shape from the first paint**, taken from the first frame the
  template offers — so an upright template is visibly an upright template, and the grid cannot reflow
  under the pointer when a still lands.
* On a narrow screen the dialog is the screen: a centred card with a margin all round wastes the two
  things a phone has least of.

## The wizard

* **The template's own picture stays on the screen for the whole flow.** Someone filling in six fields
  otherwise has no reminder of what they are filling them in for.
* **A rail of every step**, rather than "3 of 5": how much is left is the question the number stands
  in for.
* **Steps are one per kind of question** — your footage, your words, your colour — in the order
  someone answers them, and a step with nothing in it is not shown at all.
* **A chosen file appears as a picture with its length**, not only as a name.
* **The last panel lists every answer**, including the ones from panels that have left the screen. A
  wizard that asks across three panels and then acts on all of them at once is asking for a decision
  nobody has been shown.
* **Text fields are textareas.** The text generator honours a hard line break and an `<input>`
  silently drops one; a title shipped over two lines came back as one the moment the field was
  rendered. Leaving a field alone must never change the design it was showing.

## The file format

`.videolat` is the `.videola` container plus one entry:

```
videola.json      the same manifest a project has
project.json      the project, with placeholder clips
template.json     id, version, names, category, frames, poster instant, slots, steps
media/<sha256>…   only if the template brings material of its own
```

Reusing the container means the size caps, the content-addressed media naming, the migration path and
the "missing media is a warning, not a failure" behaviour are already written and already tested. The
same bytes still open as a project — a template is a project with questions attached, not a second
kind of file.

## The loading gate

`Template::normalize` is the one door, whichever way a template arrived: from the shipped set, from a
file, or back across the WebAssembly boundary from JavaScript that may have edited it. It runs
`Project::normalize` first and then checks the manifest:

* the schema version, the id, and a cap of 64 slots
* every offered frame against the same bounds a project's own width and height meet
* slot ids present and unique, and every binding legal for its slot's kind
* every binding naming a clip that exists — and, for a generator binding, a clip carrying the *kind*
  of generator that binding writes into
* every slot appearing in exactly one step. A required slot no step asks about would let the wizard
  hand the bake an answer set it is bound to refuse, and the dead end would only show itself on the
  last button of the flow.
* **every clip being something a viewer will actually see.** A media clip either takes its material
  from a slot or the template brought that material itself; a generator clip has to be one the
  renderer paints. This is the rule against the empty gallery entry.

`paintsGenerator` in the engine draws **text, solid and gradient**. A `shape` or a `countdown` is
dropped from the draw list without a word, so a template built on one would look complete in the
timeline and be blank on the screen — those two are refused. So are compound clips: one carries a
whole second timeline, and every clip inside it would need the same proof the top level gets, so the
honest answer is no rather than a check that only looks like it recurses.

A colour is not judged where it is written but where every other colour is judged. `Project::normalize`
now checks **generator colours** as well as `settings.background`: `hex()` in the engine falls back to
black or white for anything it cannot parse, which turns a typo into a colour instead of a message —
and a colour slot can now reach a generator.

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

**Save this project as a template**, from the gallery. The material stays behind, and the editor's
**selection is the marking** — selecting clips in the timeline is already how someone says "these
ones", and a second way to mark a clip would be a second thing to explain. Nothing selected means
"decide for me".

What marking can and cannot decide, honestly:

* **Media clips are placeholders whether they were marked or not.** The footage does not travel with
  a template, so a shot that was not a question would point at material no copy of the file carries —
  it would draw nothing at all. There is no version of "leave this shot as it is" that does not mean
  shipping the shot.
* **Text generators are a real choice.** An unmarked title simply keeps its words, because a generator
  is its own material. With nothing marked, every title becomes a field, which is what someone
  sharing a title sequence wants.
* **A marked solid or gradient becomes a colour question.** Unmarked ones never do: one colour field
  per coloured clip would be a wall of questions about a design nobody asked to change.

## What is not there

* A remote catalogue. The shipped set is offline and additive; `GET /api/templates` is a later
  milestone that adds entries to the same gallery.
* Search, and filtering by tag. `tags` is carried through the whole stack and read by nothing; nine
  cards behind five chips need neither.
* Swapping a slot's material after baking. The bake records which template a project came from but not
  the live bindings, because nothing yet offers that button.
* An audio slot, for the reason above.
* Choosing the poster instant, the category or the offered frames when saving your own project as a
  template. It takes the frame it was authored at, lands in `custom`, and has no poster — so its card
  shows the timeline outline. That is a small editor of its own, worth building when someone has a
  template they want to *shape* rather than merely share.
