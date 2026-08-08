# Effects and transitions

**Ten effects, five transitions, two masks and a text engine.** Every colour on this page was
measured against a real driver rather than asserted — `pnpm --filter @videola/engine test:gpu` runs
258 pixel checks through headless Chrome, and each claim below is one of them.

## An effect is a manifest and a fragment shader

One file per effect under `packages/engine/src/effects`, exporting a manifest:

```ts
export const contrast: EffectManifest = {
  id: "contrast",
  name: { de: "Kontrast", en: "Contrast" },
  category: "color",
  inputs: 1,
  params: [{ key: "amount", name: { de: "Staerke", en: "Amount" }, default: 1, min: 0, max: 4 }],
  fragmentSource: /* GLSL */,
};
```

The registry maps an `effectType` from the model onto that manifest. A type nobody implements comes
back as `undefined` and the effect is skipped — a project written by a later version still plays,
minus what this version cannot draw.

Names are carried by the manifest in both languages rather than by the i18n catalogues. Adding an
effect is then one file, and the inspector needs to know nothing about any particular effect to
label it.

## GLSL, not WGSL, for now

The design calls for one WGSL source per effect, shared by the browser and a native `wgpu`
compositor. That compositor does not exist yet, so a shared source would have exactly one consumer
and a translation step nothing depends on. The shaders are therefore GLSL for WebGL2, and the
manifest is the piece that survives the change.

What a fragment source may rely on:

| Name | What it is |
|---|---|
| `in vec2 v_uv` | the fragment's place on the frame, **y running up the picture** |
| `uniform sampler2D u_source` | the chain so far, premultiplied |
| `uniform sampler2D u_second` | the second input, premultiplied, only when `inputs` is 2 |
| `uniform float u_<key>` | one per declared parameter |
| `uniform float u_pass` | which sweep this is, only when `passes` is 2 |
| `textureSize(u_source, 0)` | the texel size, for any kernel that needs one |

### The y axis is the one thing here that cannot change

A pass draws the same quad it samples, so `v_uv` has to be the identity on the target — and a target
is stored the way GL stores one, first row at the bottom. The clip's own shader, upstream of the
chain, runs y the other way.

Every symmetric effect hides this. It surfaced when the wipe was first pointed at 90° and came up
from the bottom. An effect that cares about direction converts rather than assuming: a heading meant
to read clockwise on screen, the same convention as the transform's rotation, is
`vec2(cos a, -sin a)` inside a pass.

## Two passes for a separable kernel

A manifest may declare `passes: 2`, which runs its shader twice with `u_pass` at 0 and then 1. That
is eighteen samples for a blur a single pass would need eighty-one for. The draw list expands it into
two entries so the compositor's rule stays intact — one entry, one draw.

## The values come from the core, never from TypeScript

A parameter may be static or keyframed, and `Effect::param_at` in the Rust core decides which one
wins and how a keyframe track interpolates. The renderer asks the core for the answer:

```ts
const params = doc.effectParamsAt(playhead);
```

One call per frame, not one per effect, because the preview asks at display rate. The result is a
map from effect id to a map from parameter key to `ParamValue`, and it covers every effect on every
clip the moment touches.

TypeScript does two things with that value and nothing else: it unpacks the `ParamValue` and it
clamps the number into the range the manifest declares. A value of a kind that is not a number, one
outside the range, or a `NaN` falls back to the manifest's default — all three otherwise travel
through `uniform1f` without complaint and paint the clip black.

A transition's own parameters come off the model rather than out of that batch, and go through the
same clamp. A wipe's angle that a project file left out is the manifest's default, not the zero an
unset uniform would be — and for a wipe those are two different directions.

Interpolating in TypeScript would give the preview and the export two different answers for the same
frame. That is the divergence the Rust core exists to prevent, and it is why this path is a query
rather than a calculation.

**Keyframes are read on project time.** Reversing a clip reverses which frame is decoded; it does not
reverse the animation of an effect on it.

## Premultiplied alpha, all the way down

The clip's own fragment shader premultiplies once, on the way into the chain. Everything after that
— every pass, every intermediate target, the picture on the screen — carries premultiplied colour.

Which side of that line an effect falls on decides how it is written:

| Operation | Linear in `a·c`? | What it means |
|---|---|---|
| brightness, temperature, vignette | yes | scale `rgb`, clamp to `a` |
| saturation, blur, sharpen | yes | a weighted sum is *why* premultiplied exists |
| cross dissolve, wipe, slide | yes | a plain `mix` of the two inputs |
| contrast | **no** | divide by `a`, work, multiply back |
| chroma key | writes `a` | scale the whole `vec4`, colour and alpha together |
| masks | writes `a` | scale the whole `vec4`; `m` is in [0, 1], so nothing needs clamping |

Two consequences worth knowing before writing a shader:

- **Whoever scales `rgb` clamps it to `a`.** Past that point the texel is no longer a valid
  premultiplied colour, and the over-operator would let a half-transparent clip paint brighter than
  an opaque one at the same setting.
- **A blur on straight alpha counts a transparent texel's colour as much as an opaque one's.** That
  is the dark halo around every blurred cutout, and premultiplied is what removes it.

Contrast is the one effect here that is not linear, and the difference is not subtle: the same slider
on a half-transparent grey gives 97 done correctly and 33 done on the premultiplied value. No
assertion about the shader's text could tell those apart, which is why it is a pixel check.

**The alpha channel is not a blend mode's business.** The compositor composites alpha as a plain
over-operator in `#draw`, independent of the colour equation, so no mode can punch a transparent hole
through the picture. A chroma key producing transparency is a different thing entirely — that happens
inside a fragment shader, where it belongs.

## The library

Effects run in **frame space, after the transform**, on the clip's intermediate target. For a
per-pixel effect that makes no difference. For a blur it softens the clip's edges into the frame,
which is right. For a vignette it means the falloff is a property of the shot rather than of the
layer, which is what a vignette is.

| Effect | Category | Parameters | What it does |
|---|---|---|---|
| Brightness | colour | `amount` 0–4 | a gain; 1 is untouched, 0 is black |
| Contrast | colour | `amount` 0–4 | a slope about mid grey; 0 flattens to that grey |
| Saturation | colour | `amount` 0–2 | mixes towards luma; **0 is black and white** |
| Colour temperature | colour | `amount` −1–1 | red against blue, green anchored |
| Vignette | colour | `amount` 0–1, `size` 0–1.4 | darkens towards the corners |
| Blur | detail | `amount` 0–16 | separable Gaussian, spacing in frame pixels |
| Sharpen | detail | `amount` 0–4 | unsharp mask against the four neighbours |
| Chroma key | key | `hue` 0–360, `tolerance`, `softness` | cuts a hue out; 120 is a green screen |
| Mask (rectangle) | key | `centerX`, `centerY`, `width`, `height`, `feather`, `invert` | keeps a rectangle, drops the rest |
| Mask (ellipse) | key | the same six | keeps an inscribed ellipse |

There is no separate monochrome effect: it would be the saturation shader with the slider nailed to
zero.

A chroma key ignores greys on purpose. A grey has no meaningful hue and the arithmetic hands back
zero for it, so without a floor on saturation a key set to red would erase every grey in the picture.

### A mask is an effect, not a field on the clip

Everything a mask needs already existed for effects: parameters resolved and keyframed in the Rust
core, a chain with intermediate targets, the clamp that keeps a project file's value usable as a
uniform, `Project::normalize` checking it on load, the `effect.*` and `keyframe.*` commands, and an
inspector that puts a row on screen for every parameter a manifest declares. A `clip.mask` field
would have needed a model type, a normalize arm, its own commands and MCP tools, a batch query
across the WASM boundary and inspector code — all to express *multiply the coverage by a shape*.

Two things fall out of that choice for free. **Masks compose**: a rectangle and an ellipse in one
chain intersect, because each scales the coverage the one before it left. And a mask is
**keyframable and animatable** by the same commands as any other parameter, which is what makes a
travelling reveal an ordinary edit.

The cost is that a mask is measured in **frame space, after the transform** — the same place a
vignette is measured. A clip that moves under a still mask is the reveal that buys; a mask that
travels *with* its clip would need the chain to run in clip space. Two masks of the same shape on
one clip are not possible either: `effect.add` treats a repeated type as a no-op, so a chain keyed
by effect id rather than by type is what a second rectangle would want.

Six parameters, all fractions of the frame so they mean the same thing at any output size:
`centerX`/`centerY` from the top-left corner, `width`/`height` as the **full** extent rather than
the half, `feather` straddling the edge so growing it does not move the boundary, and `invert` as a
fade to the complement rather than a switch — the ends are the two settings anyone wants, and the
middle is an even half.

Two contracts a mask cannot get wrong, both measured:

- **It scales all four channels, not just alpha.** On premultiplied colour `(rgb·a, a)` times `m` is
  the same colour at lower coverage. The straight-alpha reflex — touch `a` alone — leaves `rgb` at
  full brightness, and the over-operator then adds a whole white to the background instead of a
  third of one. The pixel check reads 81 done correctly and 255 done wrong.
- **`y` is flipped.** `v_uv` runs *up* the picture inside a pass; every measurement in the model runs
  down it. A mask centred at 0.25 belongs in the upper quarter, and without the flip it lands in the
  lower one. A rectangle is not symmetric about the middle row, which is exactly why this surfaced
  here and not in the y-symmetric effects built before it.

## A motion path is a keyframe track

A clip can be sent along a curve rather than along two independent ramps on `x` and `y`. The track
is called `position`, it is the one keyframe key that carries a `vec2` instead of a `float`, and it
is written with the same `keyframe.add` an effect parameter uses — one command per point.

The curve is a Catmull-Rom spline through the points, resolved in the Rust core by `transform_at`
and handed to the renderer through the same `transformsAt` batch every other placement travels on.
That is deliberate: an interpolation living in TypeScript would mean the export computed a different
path from the preview.

Three properties worth knowing:

- **Two points are exactly the straight line between them.** The virtual point beyond each end is
  its neighbour mirrored through it, which makes the end tangent the chord itself. Without that
  mirror a two-point path bulges, and a path would stop being a superset of a pair of `x`/`y` tracks.
- **A third point reshapes the segment before it.** That is the whole difference between a path and
  a polyline, and it is what separate `x` and `y` tracks cannot express — they interpolate value
  against time and can only ever meet at a corner.
- **`interp` still times the travel and nothing else.** Hold, ease and the bezier handles decide how
  fast the clip moves along the curve, never where the curve goes, so a key's interpolation keeps
  its single meaning.

A `position` track overrides `x` and `y` both. Letting the two settle it by iteration order would
hand the answer to a `BTreeMap`'s alphabet, and where a clip stands is not a fact about spelling.

`ponytail:` the parameterisation is uniform rather than centripetal, so points far apart in space
but close in time pull the curve into an overshoot — it leans away from a coming corner before
turning into it. Centripetal Catmull-Rom takes the same four points and divides by the chord
lengths; that is the swap to make the day a path visibly loops past a key.

## Transitions

A transition is an effect with two inputs, not a second subsystem. `u_second` is the picture the
frame already holds when the incoming clip's turn comes, `u_source` is that clip after its own
effects, and `progress` runs from nothing to everything across the transition's window.

| Transition | Parameters | What it does |
|---|---|---|
| Cross dissolve | — | a plain mix of the two |
| Wipe | `angle` 0–360, `softness` 0–1 | an edge travels across the frame |
| Slide | `angle` 0–360 | the incoming clip pushes the outgoing one out |
| Zoom | `from` 0.05–4 | the incoming clip grows out of the middle |
| Dip to colour | `level` 0–1 | out through a flat colour and back in |

Angles are degrees clockwise on screen: 0 comes in from the left, 90 from the top.

To author one: put the two clips so that they **overlap in time** and set the transition on the
incoming clip, aligned to `in` — the only alignment this milestone can play out. Both clips then have
a picture for the length of the overlap.

The incoming clip's opacity is carried in the same progress. A half-opaque clip halfway through its
transition is a quarter of the way over, not a half that is afterwards faded. Once the window is
behind the moment, the clip is composited the ordinary way again.

### Zoom composites, it does not mix

Where the incoming picture has been scaled down there is nothing outside it, and `mix` weights both
sides — so it would have halved the alpha of whatever was already on the frame. In a premultiplied
canvas that is a transparent hole around the shrunken picture, and a transparent hole is the page
showing through. An over-operator only ever adds. The check that catches it reads the corner of the
frame through a coloured page.

## Titles

A generator clip has no medium behind it. Its picture is painted rather than decoded, and it fills
the frame — that is the only size it has.

**Text becomes pixels through canvas 2D into a texture**, not through glyph outlines into geometry.
The browser already has a shaper, a font fallback chain and a hinting engine; reimplementing any one
of them is a project rather than a milestone. What it costs is that a title is a raster at the
project's resolution — which is why **every measurement in a text style is a fraction of the frame**
and never a pixel count. A project authored at 720p and exported at 4K rasterises its titles again at
4K, and that is the right way round.

`Generator::Text` carries a free-form `style` object, so none of this needed a change to the Rust
model. It does need a trust boundary: the style arrives from a project file, a template or an agent,
and on a canvas an unreadable colour leaves `fillStyle` where it was while an unreadable font string
leaves `ctx.font` at 10px sans-serif. Both silent, both catastrophic. Every field is bounded, every
colour is hex or it is the default, and a family name is stripped to what a CSS shorthand can hold.

| Key | Default | What it is |
|---|---|---|
| `fontFamily` | `sans-serif` | a generic family is always appended |
| `fontSize` | `0.09` | fraction of the frame's height |
| `fontWeight` | `700` | 100–900 |
| `italic` | `false` | |
| `color` | `#ffffff` | hex, 3/4/6/8 digits |
| `align` | `center` | how lines sit relative to `x` |
| `lineHeight` | `1.25` | multiple of the font size |
| `letterSpacing` | `0` | fraction of the font size |
| `x`, `y` | `0.5`, `0.5` | the block's anchor, as a fraction of the frame |
| `maxWidth` | `0.8` | where lines wrap, fraction of the frame's width |
| `strokeWidth`, `strokeColor` | `0`, `#000000` | fraction of the font size |
| `shadowBlur`, `shadowX`, `shadowY`, `shadowColor` | `0`, `0`, `0.05`, `#00000080` | fractions of the font size |
| `background`, `padding` | `""`, `0.3` | a box behind the text; empty means none |

Hard breaks in the content are honoured and the rest is wrapped to `maxWidth`. A single word that
does not fit is left long rather than broken — hyphenation needs a dictionary, and a word cut at an
arbitrary letter reads worse than one that overhangs.

Solid and gradient generators are painted through the same path. A gradient spans the frame at its
own angle, clockwise on screen.

### A title's animation is a transform, not a repaint

| Key | Values |
|---|---|
| `animateIn`, `animateOut` | `none`, `fade`, `rise`, `fall`, `grow` |
| `animateInSeconds`, `animateOutSeconds` | `0.5` |
| `loop`, `loopSeconds` | `none` or `pulse`, `2` |

The glyphs are rasterised once and what moves is the quad they sit on. A pulsing title therefore
costs one matrix per frame instead of one text layout per frame, and the cached picture stays valid
for as long as the words do.

Both ends run through the same function, so `rise` means the title is below its place while it is not
in it: it comes up on the way in and goes back down on the way out. Two tables for the two ends is
how they come to disagree.

These are **not keyframes**, deliberately. A keyframe is resolved in the Rust core, and a second
interpolation next to it would be exactly the preview-against-export divergence the core exists to
prevent. This is a declarative preset with no authored values in between, evaluated in the draw list
— the one place the preview and the export both go through.

The first moment of a fade-in is a clip at zero opacity, and a clip at zero opacity is left out of the
draw list entirely. That is also a picture nobody has to paint.

## What happens for one clip

```
source texture, decoded or painted
  → the clip's quad, transformed, into an intermediate target
  → one pass per enabled effect, two for a separable one, the targets taking turns
  → opacity, then the clip's blend mode, onto the picture
     or, while a transition runs, a mix with the picture the frame already holds
```

A clip with no effect and no running transition skips all of it and goes straight onto the picture.
That path is the common one and stays cheap: nothing is allocated and no pass is compiled until a
project actually carries an effect.

## What is not there yet, by name

- **Masks are rectangular and elliptical only.** A drawn or tracked mask needs a polygon in the
  model and a shader that samples it, and tracking needs something to track. The two shapes here
  intersect in a chain, which covers more than the count suggests, but a shape traced around a
  subject is a different feature.
- **A mask travels in frame space, not with its clip.** It is measured after the transform, so
  moving the clip moves the picture under a stationary mask. A mask pinned to its layer wants the
  chain run in clip space, which is a change to the frame graph rather than to a shader.
- **One mask of each shape per clip.** `effect.add` treats a repeated type as a no-op, so a second
  rectangle needs the chain keyed by effect id rather than by effect type.
- **No editor for a motion path yet.** The core resolves the curve and the renderer draws it, but
  the points are placed by command rather than dragged on the preview — the inspector has no
  `vec2` row, because the effect manifest has no parameter type beyond a float.
- **Motion blur** needs more than one moment per output frame, which means more than one decoded
  frame per output frame. That is a change to the gather, not to a shader.
- **LUT import** needs a file import, a 3D texture and a parameter that is not a float. The manifest
  has no `type` field yet; that is where it would go.
- **Shape and countdown generators paint nothing.** They are in the model, they are not in the menu,
  and a clip whose generator this renderer cannot paint is dropped from the draw list rather than
  drawn as an empty rectangle.
- **A centred or trailing transition is half invisible.** Its window reaches back before the clip
  starts, where the clip is not drawn at all. Playing it out needs handles — material past the cut —
  and nothing creates them.
- **`transitionOut` is never read.** A cut between two clips is authored as the incoming clip's
  `transitionIn`, because the outgoing clip is drawn first and cannot mix with what comes after it.
- **Adjustment tracks, track effects and master effects still paint nothing.** The seam is in the
  draw list; the machinery is the same chain, applied to a track's intermediate target.
- **`overlay` and `difference` still fall back to `normal`.** They need the destination as a
  texture, which the transition path has — a small step rather than a missing piece.
- **Fonts in the export worker are whatever the worker can resolve.** A generic family always works;
  a web font loaded by the page is not automatically loaded there.

## Where it is measured

`pnpm --filter @videola/engine test:gpu` runs the whole compositor against headless Chrome with
SwiftShader and checks real pixels, including every claim on this page about a colour. No Playwright,
no browser download; set `CHROME_PATH` if the executable is somewhere unusual.
