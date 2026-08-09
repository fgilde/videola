# Effects and transitions

**Twelve effects, seven transitions, two masks, three measuring instruments and a text engine —
chosen from a browser that shows you each one at work.** Every colour on this page was measured
against a real driver rather than asserted: `pnpm --filter @videola/engine test:gpu` runs 349 pixel
checks through headless Chrome, and each claim below is one of them.

## An effect is a manifest and a fragment shader

One file per effect under `packages/engine/src/effects`, exporting a manifest:

```ts
export const contrast: EffectManifest = {
  id: "contrast",
  name: { de: "Kontrast", en: "Contrast" },
  blurb: { de: "Spreizt oder staucht …", en: "Spreads or flattens …" },
  category: "color",
  inputs: 1,
  // What the browser's tile is drawn with -- never the defaults, see below.
  preview: { amount: 2.4 },
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 4 }],
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
| `uniform float u_<key>` | one per declared float parameter |
| `uniform vec4 u_<key>` | one per declared colour parameter, **premultiplied** |
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

### A parameter is a float, a colour or a curve

Until recently every manifest carried floats and nothing else, and that was the wall a LUT ran into.
`ParamValue` in the Rust core has carried `Color`, `Int`, `Bool`, `Vec2` and `Choice` since the model
was written; what was missing was anything between the project file and the uniform that could say
which one a parameter is.

A manifest parameter now declares its `kind`. It is optional and defaults to `"float"`, so every
manifest written before there was a second kind still reads -- including the audio ones, which have
an `AudioParam` behind them and can never be anything else.

```ts
{ kind: "color", key: "colour", name: { de: "Farbe", en: "Colour" }, default: [0, 0, 0, 1] }
```

A colour is authored **straight**, each channel 0 to 1, and premultiplied on the way to the uniform
-- the same seam the project background is read across, for the same reason. `clampColor` is the
guard, and it enforces the contract the whole pipeline rests on: no channel above its own alpha. The
check that catches a mistake there does not feed it 1.4, because an RGBA8 target clamps that on its
own and proves nothing. It feeds a channel *above alpha and below one*, which is where a texel stops
being a legal premultiplied colour and nothing downstream notices.

In the surface a colour is the browser's own picker. `input[type=color]` brings an eyedropper, a
wheel, a recent list and the system dialogue a person already knows; what a custom one would add is a
second set of bugs.

`ponytail:` the picker has no alpha, so it edits rgb and carries whatever alpha the model held -- and
a colour parameter gets no keyframe switch, although `ParamValue::lerp` already interpolates one.

```ts
{ kind: "curve", key: "luma", name: { de: "Helligkeit", en: "Brightness" }, default: IDENTITY_CURVE }
```

A curve is a **list of control points**, `[input, output]` with both in 0 to 1 and the input
ascending — the points a person drags, and not the table a shader reads. That distinction is the
whole design decision, and it went the way it did for one reason: a table is derivable from points
and points are not derivable from a table. A curve stored sampled could be rendered and never edited
again, and a keyframe between two tables is not a keyframe between two curves — it is a keyframe
between two of their shadows. `ParamValue::Curve` therefore carries the points, and `ParamValue::lerp`
interpolates them pair by pair, both coordinates, so a keyframed knee slides sideways as well as up.
Two curves with different point counts have no pairing at all and do not interpolate; the core holds
the earlier keyframe, exactly as it does for a `Bool`.

**Into the shader as a uniform array, not as a texture.** `clampCurve` samples the points into 32
evenly spaced outputs and `uniform1fv` fills a `float[32]`; the shader mixes between neighbouring
entries. A LUT texture was the other candidate and would have cost a texture unit, an upload path and
a lifetime to manage in the compositor — the three things that leak — while buying nothing, because
a keyframed curve has different points every frame and the texture would be rebuilt from those points
anyway. What a texture *would* buy is hardware interpolation and a table long enough that the
interpolation does not matter; measured, it does not matter at 32 either. The error a linear read
leaves against the curve itself is under half of one 8-bit level, and `curve.test.ts` is the check
that says so.

That choice needed one rule added to `setUniforms`, and it is total rather than lucky: **an array
longer than sixteen components cannot be a vector or a matrix**, because GLSL ES has nothing wider
than a `mat4`. Below seventeen the shape is still ambiguous and still refused.

Between the points the curve is a **monotone cubic** — Fritsch–Carlson — and not an ordinary spline.
An ordinary spline through three points a colourist would actually place overshoots between them, and
an overshoot on a tone curve is a bright rim along every edge in the picture that crossed that tone.
Monotone limiting gives up a little smoothness and can never leave the box its neighbouring points
make. Outside the outermost points the curve is flat rather than extrapolated: a control point at 0.2
says what happens at 0.2, and guessing a slope past the end of what was drawn is how a curve that
looked tame in the editor clips the blacks.

The sampler lives in `@videola/core` rather than in the engine, and that is not where pixel
arithmetic would naturally go. Two very different consumers need exactly the same answer out of it:
the renderer samples it into the shader's table, and the curve editor draws the line under the
finger. A second implementation on the drawing side would be a curve that looks like one thing and
grades like another, which is the one bug a curve tool must not have. It is not keyframe resolution —
*which* points the curve has at a moment in time is still the core's answer, out of Rust.

In the surface a curve is a square field with the points as real buttons over an SVG drawing. Drag a
point to move it, tap the field to add one where you tapped, tap a point to take it away; the two ends
stay. Buttons rather than circles inside the drawing, because three things come free that way and
none of them is free in SVG: the platform focuses and reaches them with the keyboard, the touch
target is sized from the same `--v-touch-target` as every other control, and a browser check can
measure the rectangle a finger has to hit. A circle in a scaled `viewBox` has a radius in user units,
and forty-four pixels is not a fixed number of those.


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
| contrast, curves, colour wheels | **no** | divide by `a`, work, multiply back |
| chroma key | writes `a` | scale the whole `vec4`, colour and alpha together |
| masks | writes `a` | scale the whole `vec4`; `m` is in [0, 1], so nothing needs clamping |

Two consequences worth knowing before writing a shader:

- **Whoever scales `rgb` clamps it to `a`.** Past that point the texel is no longer a valid
  premultiplied colour, and the over-operator would let a half-transparent clip paint brighter than
  an opaque one at the same setting.
- **A blur on straight alpha counts a transparent texel's colour as much as an opaque one's.** That
  is the dark halo around every blurred cutout, and premultiplied is what removes it.

Contrast was the first effect here that is not linear, and the difference is not subtle: the same
slider on a half-transparent grey gives 97 done correctly and 33 done on the premultiplied value. No
assertion about the shader's text could tell those apart, which is why it is a pixel check. Colour
correction is entirely made of such effects — a curve asks about 0.31 instead of about 0.63 and comes
back at 23 rather than 93, a lift adds a constant that premultiplication would have scaled and comes
back at 124 rather than 92 — so every one of them undoes the premultiplication first and puts it back
after, and every one of them has its own pixel check for it.

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
| Curves | colour | `luma`, `red`, `green`, `blue`, each a list of points | drags single tones up or down |
| Colour wheels | colour | `liftTint`/`liftAmount`, `gammaTint`/`gammaAmount`, `gainTint`/`gainAmount` | black point, midtones and white point |
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

### Four curves, not three

The three channel curves are the ordinary ones: red in, red out. The fourth is not those three set to
the same shape, and that is why it exists. It reads the Rec. 709 luma of the pixel, asks the curve
what that tone should become, and scales all three channels by the ratio — so the ratio between them,
and with it the hue and the saturation, come out exactly as they went in. Measured on a pixel of
180, 90, 30 through the same S-curve: the brightness curve gives 146, 73, 24, still exactly two to
one; the identical shape through the three channel curves gives 217, 60, 8, which is a saturation
change nobody asked for.

What a ratio cannot do is lift something that is already black. Raising the foot of the brightness
curve opens the shadows and leaves true black alone — for that, use lift on the colour wheels, whose
whole job is to add rather than to scale.

### Lift, gamma and gain are one effect

They are one line. Lift says where black goes, gain says where white goes — between them they define
a straight line through the tone range — and gamma bends what lies between without moving either end.
Split into three effects the chain would run three unpremultiply/premultiply round trips and three
clamps to compute one line, and the middle one would be clamping a picture the last one is about to
stretch again.

Each wheel is a **tint and a strength**, which is what the two controls on a real panel are: the wheel
pushes the three channels apart and the ring moves all three together. A tint is stored as a colour,
so mid grey is no tint at all and the distance from mid grey is the push. It arrives premultiplied,
like every colour that reaches a shader here, and is divided back out — alpha is coverage, and a tint
covers nothing.

The three are told apart on black, and only there. A mid grey cannot distinguish them: a lift of 0.25
and a gain of 0.25 both put it at 160. On black, lift gives 64 and the other two give 0.

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

## The browser, and where its pictures come from

Thirteen names in a dropdown is a list. What replaced it is a shelf: grouped by category, searchable
over both languages and over the sentence under each name, and **every entry shows what it does**.

A tile is not an illustration of the effect. It is the effect's own fragment shader, over a real
frame, through the same screen quad and the same uniform convention the timeline uses --
`EffectPreview` in `packages/engine/src/render/preview.ts`, which shares `SCREEN_VERTEX_SOURCE` with
the compositor so that `v_uv` cannot come to run one way in the editor and the other in the tile that
claims to show it.

**The frame is the one the editor is showing.** The preview canvas is created readable and already
holds the composited picture at the playhead, so the source for the whole grid costs one `drawImage`
into a 192x108 scratch and no decoder at all. That is the decision worth stating plainly, because the
obvious alternative is one decode per tile, and one decode per tile to fill a dialog is what makes a
library feel broken. The passes themselves are not the expensive part -- one 192x108 tile is twenty
thousand fragments, and the seventeen the library holds today come to a sixth of a single 1080p
frame -- which is why nothing here is loaded lazily and nothing is cached between openings. A cache would be showing the
picture from wherever the playhead used to be.

Where the timeline has no picture to give -- an empty project, or a playhead in a gap -- the tiles
fall back to a **generated reference frame**: a hue sweep across, a fall in brightness down, hard
vertical bars for the two kernels and a full green for the chroma key. It is still the effect's own
output; only the material is ours. It is also what the pixel checks measure against, because a frame
chosen to give every effect something to work on is the only one where a tile that shows nothing is
the effect's fault rather than the footage's.

Two consequences of drawing from the real frame, both honest and both worth knowing:

- **The chroma key's tile does nothing on material that was never shot against a screen.** That is
  what the effect would do to your footage, and a tile that pretended otherwise would be the promise
  without the cover.
- **Brightness and contrast look alike on a saturated test pattern**, because bars already at full
  cannot get brighter. On real material they do not.

### A manifest names its own telling setting

Drawing a tile from the parameter defaults would have been the trap: a gain of 1 and a warmth of 0
are the untouched picture, so half the shelf would have promised an effect and shown one that does
nothing. Each manifest therefore carries a `preview` -- the one setting that makes its own point.
Saturation's is nought rather than a boost, because black and white is the setting nobody mistakes
for the original. A dip's is **not** the midpoint, because the middle of a dip is a flat rectangle of
the colour it dips through and says nothing about the effect that produced it.

The pixel check behind that is the one this whole feature rests on: every manifest's tile has to
differ from the picture it was drawn from by more than eight levels, averaged over every channel of
every pixel. A tile that came back is worth nothing; a tile that came back *changed* is the claim.

## The measuring instruments

Without a scope every colour decision is a guess about a monitor. Three of them read the preview:
a **waveform**, a **vectorscope** and a **histogram**, in a strip under the picture that the switch
on the transport opens.

They read the preview because the preview is the one surface in this application anything asks for a
pixel back from — `createContext(canvas, { readable: true })`, which is `preserveDrawingBuffer`. The
pixels are already there.

**What that costs, measured before it was chosen.** On the software rasteriser the harness runs, at
1080p:

| | per reading |
|---|---|
| `readPixels` of the whole drawing buffer, 8.3 MB | 3.4 ms |
| the same, then counting all two million pixels | **33.6 ms** |
| `sample(256, 144)` — a blit, then a 147 kB read | 0.22 ms |
| the same, then counting 36 864 pixels | **0.91 ms** |

Thirty-three milliseconds is longer than a frame, every frame, for a panel nobody is dragging. So the
shrinking happens on the GPU: `Compositor.sample` blits the drawing buffer into a small framebuffer
and reads that back, and the panel measures ten times a second rather than sixty. Ten hertz of 0.91 ms
is under one percent of one core, and while the strip is closed nothing is read back at all.

**The blit is NEAREST, and that is the whole difference between a measurement and a picture.**
Averaging four neighbours invents values no pixel had: a single clipped highlight in a dark field
averages down into a midtone and the scope stops reporting the one thing it exists to report.
Sampling may miss such a pixel; it may never soften it into one that was not there. The pixel harness
shrinks a 32-pixel frame carrying exactly two levels to thirteen and checks that exactly two come
back — thirteen and not sixteen, because at a whole ratio a bilinear read lands on texel centres and
gives the same answer nearest does.

`ponytail:` the read is still synchronous, so it waits for the GPU. A `PIXEL_PACK_BUFFER` with a
fence, read a frame late, would not wait at all — worth it if a scope ever has to keep up with
playback rather than with a person looking at it.

Three other things the instruments are careful about:

- **Premultiplied, like everything downstream of the clip shader.** A scope is about the colour and
  not about the coverage, so each pixel is divided back out by its own alpha. Read as if it were
  straight, a half-transparent white reads as a mid grey.
- **A pixel with no coverage has no colour to report** and is left out entirely rather than counted as
  black. Counting it as black is what makes an empty frame look like a perfectly exposed one with the
  lens cap on. An empty frame therefore produces an empty reading, and the panel says so in words
  rather than dividing by a count of nought.
- **The graticule comes out of the same transform the measurement does.** The six boxes are the
  colour bars at three-quarter amplitude, computed rather than remembered, so the plot and the boxes
  it is read against cannot drift apart.

## The colour space, and what it means for grading

The frame arrives as BT.709 with a limited range far more often than not, and the browser converts it
on upload from the frame's own `VideoColorSpace` — `BROWSER_DEFAULT_WEBGL`. Converting it again in a
shader of our own would compete with a conversion that knows the metadata, and two conversions are
worse than the one that does.

What comes out of that is **non-linear sRGB**, and everything downstream mixes in it. For most of the
library that is the ordinary compromise every editor makes. For colour correction it is a real
limitation, and it is worth naming rather than passing over:

- **A gamma move is not an exposure move.** Opening up by a stop is a multiplication in linear light;
  here it is a multiplication of already-encoded values, which lifts the shadows more than the
  highlights. It looks like what people expect from an editor, because every editor does this, and it
  is not what a light meter would say.
- **Saturation and the brightness curve are luma, not luminance.** The Rec. 709 weights are applied to
  the encoded values, so a strong desaturation shifts perceived brightness slightly. The waveform
  reads the same quantity, which at least means the instrument and the effect agree with each other.
- **A cross dissolve halfway is not half the light.** Mixing encoded values darkens the middle of
  every dissolve relative to a linear mix. Visible on a dissolve between a bright and a dark shot.
- **A wide-gamut or HDR source is tone-mapped by the browser on the way in** and there is nothing here
  that can undo that. This pipeline grades an SDR picture.

`ponytail:` the fix is a pipeline change and not a shader change: sRGB texture formats, an sRGB draw
buffer and a half-float intermediate target, so the chain carries linear light and the encoding
happens once at the end. Every clamp to `[0, a]` in this library would have to become a clamp against
a larger range, and every measured number on this page would move.

## Transitions

A transition is an effect with two inputs, not a second subsystem. `u_second` is the picture the
frame already holds when the incoming clip's turn comes, `u_source` is that clip after its own
effects, and `progress` runs from nothing to everything across the transition's window.

| Transition | Parameters | What it does |
|---|---|---|
| Cross dissolve | — | a plain mix of the two |
| Wipe | `angle` 0–360, `softness` 0–1 | an edge travels across the frame |
| Slide | `angle` 0–360, `push` 0–1 | the incoming clip comes in; `push` is how much of the outgoing one it shoves out |
| Iris | `centerX`, `centerY`, `softness` | a circle opens onto the incoming clip |
| Zoom | `from` 0.05–4 | the incoming clip grows out of the middle |
| Blur dissolve | `amount` 0–48 | a dissolve that goes soft in the middle and sharp again at both ends |
| Dip to colour | `colour` | out through a colour of your choosing and back in |

A slide at `push` 1 shoves the outgoing picture out of the frame; at 0 it stands still and the
incoming one slides over it. Two shaders whose only difference is a multiplication by zero is two
shaders too many.

An iris measures its reach to the corner that is actually farthest from its centre, in a space
corrected for the frame's aspect. A fixed diagonal is right for a centred circle on a square frame
and wrong everywhere else — on 16:9, or from a centre pushed into a corner, it ends the transition
with wedges of the outgoing clip still standing.

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
  the points are placed by command rather than dragged on the preview. The manifest now has a
  parameter kind, so a `vec2` row is a smaller step than it was; what a path really wants is a handle
  on the picture rather than two more numbers in a panel.
- **Motion blur** needs more than one moment per output frame, which means more than one decoded
  frame per output frame. That is a change to the gather, not to a shader.
- **LUT import** is still missing, and the parameter kind is no longer what stands in the way — a
  manifest parameter now declares one, and a colour travels the whole path from the project file to
  a `vec4` uniform. What is left is the other three quarters of it: a `.cube` parser, somewhere to
  keep a table far too large to sit in a project file, and a third texture unit bound through the
  compositor, the preview and the export worker alike. That is a change to the frame graph rather
  than to a manifest.
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
SwiftShader and checks real pixels, including every claim on this page about a colour and every tile
in the browser. No Playwright,
no browser download; set `CHROME_PATH` if the executable is somewhere unusual.
