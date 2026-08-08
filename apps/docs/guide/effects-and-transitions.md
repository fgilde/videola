# Effects and transitions

**Eight effects, five transitions and a text engine.** Every colour on this page was measured against
a real driver rather than asserted — `pnpm --filter @videola/engine test:gpu` runs 188 pixel checks
through headless Chrome, and each claim below is one of them.

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

There is no separate monochrome effect: it would be the saturation shader with the slider nailed to
zero.

A chroma key ignores greys on purpose. A grey has no meaningful hue and the arithmetic hands back
zero for it, so without a floor on saturation a key set to red would erase every grey in the picture.

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

- **Masks and motion paths.** Cropping gives a rectangular mask and the vignette a radial one, but a
  shaped or tracked mask needs paths, and paths need the draw list to read `Clip::keyframes` — which
  it does not. That is the same gap as the one below.
- **Keyframes exist on effect parameters and nowhere else.** `Clip::keyframes` is in the model and
  the draw list reads `clip.transform` statically, so a keyframe on a clip property is data no
  picture sees. Everything animated in this milestone is either an effect parameter or a title's
  declarative preset.
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
