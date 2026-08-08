# Effects and transitions

**Built, for two effects.** A brightness control and a cross dissolve. They are not a library —
they are the proof that the chain from registry through shader and keyframe evaluation into the
compositor holds. The library is a later milestone, and it adds files rather than machinery.

## An effect is a manifest and a fragment shader

One file per effect under `packages/engine/src/effects`, exporting a manifest:

```ts
export const brightness: EffectManifest = {
  id: "brightness",
  name: { de: "Helligkeit", en: "Brightness" },
  category: "color",
  inputs: 1,
  params: [{ key: "amount", default: 1, min: 0, max: 4 }],
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
| `in vec2 v_uv` | the fragment's place on the frame, running with the picture |
| `uniform sampler2D u_source` | the chain so far, premultiplied |
| `uniform sampler2D u_second` | the second input, premultiplied, only when `inputs` is 2 |
| `uniform float u_<key>` | one per declared parameter |

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

Interpolating in TypeScript would give the preview and the export two different answers for the same
frame. That is the divergence the Rust core exists to prevent, and it is why this path is a query
rather than a calculation.

## Premultiplied alpha, all the way down

The clip's own fragment shader premultiplies once, on the way into the chain. Everything after that
— every pass, every intermediate target, the picture on the screen — carries premultiplied colour.

Two consequences worth knowing before writing a shader:

- A cross dissolve is a plain `mix` of the two inputs. On straight alpha the same line would weight
  the colour of a nearly transparent pixel as if it were opaque.
- Brightness scales `rgb` and leaves `a` alone — but it has to clamp the result to `a`. Past that
  point the texel is no longer a valid premultiplied colour, and the over-operator would let a
  half-transparent clip paint brighter than an opaque one at the same setting.

## What happens for one clip

```
source texture
  → the clip's quad, transformed, into an intermediate target
  → one pass per enabled effect, the two targets taking turns
  → opacity, then the clip's blend mode, onto the picture
     or, while a transition runs, a mix with the picture the frame already holds
```

A clip with no effect and no running transition skips all of it and goes straight onto the picture.
That path is the common one and stays cheap: nothing is allocated and no pass is compiled until a
project actually carries an effect.

## Brightness

One parameter, `amount`, a gain: `1` is the picture as it arrived, `0` is black, and the ceiling is
`4`, about as far as an 8-bit source can be pushed before it is only noise.

Measured against a real driver, not asserted: a mid grey of 64 at a gain of two comes back as 128;
at a gain of zero the clip is black and still opaque; white at half alpha stays half transparent
however far it is pushed.

## Cross dissolve

A transition is an effect with two inputs, not a second subsystem. `u_second` is the picture the
frame already holds when the incoming clip's turn comes, `u_source` is that clip after its own
effects, and `progress` runs from nothing to everything across the transition's window.

To author one in this milestone: put the two clips so that they **overlap in time**, and give the
incoming clip a `transitionIn` of type `crossfade` aligned to `in`. Both clips then have a picture
for the length of the overlap, and the middle of the dissolve is half of each — a measurable colour,
and it is measured.

The incoming clip's opacity is carried in the same progress. A half-opaque clip halfway through its
transition is a quarter of the way over, not a half that is afterwards faded. Once the window is
behind the moment, the clip is composited the ordinary way again.

## What is not there yet, by name

- **No command creates a transition, and none creates a keyframe.** The model carries both and the
  renderer reads both, but the command catalogue has `effect.add` and `effect.setParam` and nothing
  else. Until `keyframe.add` and a transition command exist, both can only arrive in a `.videola`
  file written elsewhere.
- **A centred or trailing transition is half invisible.** Its window reaches back before the clip
  starts, where the clip is not drawn at all. Playing it out needs handles — material past the cut —
  and nothing in this milestone creates them.
- **Effects run in frame space, after the transform**, not on the source at its own resolution. For
  a per-pixel effect the two are the same; for a blur they are not, and the day a blur arrives this
  is the decision to revisit.
- **Adjustment tracks, track effects and master effects still paint nothing.** The seam is in the
  draw list; the machinery is the same chain, applied to a track's intermediate target.
- **`overlay` and `difference` still fall back to `normal`.** They need the destination as a
  texture, which the transition path now has — they are a small step rather than a missing piece.

## Where it is measured

`pnpm --filter @videola/engine test:gpu` runs the whole compositor against headless Chrome with
SwiftShader and checks real pixels, including every claim on this page about a colour. No Playwright,
no browser download; set `CHROME_PATH` if the executable is somewhere unusual.
