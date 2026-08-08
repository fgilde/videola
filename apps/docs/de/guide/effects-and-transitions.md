# Effekte und Übergänge

**Gebaut, für zwei Effekte.** Eine Helligkeitsregelung und eine Überblendung. Sie sind keine
Bibliothek — sie sind der Nachweis, dass die Kette von der Registry über Shader und
Keyframe-Auswertung bis in den Compositor trägt. Die Bibliothek ist ein späterer Meilenstein, und
sie fügt Dateien hinzu, keine Mechanik.

## Ein Effekt ist ein Manifest und ein Fragment-Shader

Eine Datei pro Effekt unter `packages/engine/src/effects`, die ein Manifest exportiert:

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

Die Registry bildet den `effectType` aus dem Modell auf dieses Manifest ab. Ein Typ, den niemand
umgesetzt hat, kommt als `undefined` zurück und der Effekt wird übersprungen — ein Projekt aus einer
späteren Version spielt weiter, abzüglich dessen, was diese Version nicht zeichnen kann.

Die Namen trägt das Manifest zweisprachig, nicht die i18n-Kataloge. Einen Effekt hinzuzufügen ist
damit eine Datei, und der Inspector muss über keinen einzelnen Effekt etwas wissen, um ihn zu
beschriften.

## GLSL statt WGSL, vorerst

Der Entwurf sieht eine WGSL-Quelle pro Effekt vor, geteilt zwischen Browser und einem nativen
`wgpu`-Compositor. Diesen Compositor gibt es noch nicht, also hätte eine geteilte Quelle genau einen
Abnehmer und einen Übersetzungsschritt, von dem nichts abhängt. Die Shader sind deshalb GLSL für
WebGL2 — und das Manifest ist der Teil, der den Wechsel überlebt.

Worauf eine Fragment-Quelle sich verlassen darf:

| Name | Was es ist |
|---|---|
| `in vec2 v_uv` | die Stelle im Bild, mitlaufend mit dem Bild |
| `uniform sampler2D u_source` | die Kette bis hierher, premultipliziert |
| `uniform sampler2D u_second` | der zweite Eingang, premultipliziert, nur bei `inputs` gleich 2 |
| `uniform float u_<key>` | einer je deklariertem Parameter |

## Die Werte kommen aus dem Kern, nie aus TypeScript

Ein Parameter kann statisch oder keyframegesteuert sein, und `Effect::param_at` im Rust-Kern
entscheidet, welcher gewinnt und wie eine Keyframe-Spur interpoliert. Der Renderer fragt den Kern
nach der Antwort:

```ts
const params = doc.effectParamsAt(playhead);
```

Ein Aufruf pro Bild, nicht einer pro Effekt, weil die Vorschau mit Anzeigerate fragt. Das Ergebnis
ist eine Abbildung von Effekt-Id auf eine Abbildung von Parameterschlüssel auf `ParamValue`, und sie
deckt jeden Effekt jedes Clips ab, den der Zeitpunkt berührt.

TypeScript tut mit diesem Wert zweierlei und sonst nichts: es packt den `ParamValue` aus und klemmt
die Zahl in den Bereich, den das Manifest deklariert. Ein Wert einer Art, die keine Zahl ist, einer
außerhalb des Bereichs oder ein `NaN` fällt auf den Vorgabewert zurück — alle drei reisen sonst
kommentarlos durch `uniform1f` und färben den Clip schwarz.

In TypeScript zu interpolieren gäbe Vorschau und Export zwei verschiedene Antworten für dasselbe
Bild. Genau dieses Auseinanderlaufen verhindert der Rust-Kern, und deshalb ist dieser Weg eine
Abfrage und keine Rechnung.

## Premultipliziertes Alpha, durchgängig

Der Fragment-Shader des Clips premultipliziert einmal, auf dem Weg in die Kette. Alles danach —
jeder Pass, jedes Zwischenziel, das Bild auf dem Schirm — trägt premultiplizierte Farbe.

Zwei Folgen, die man kennen sollte, bevor man einen Shader schreibt:

- Eine Überblendung ist ein schlichtes `mix` der beiden Eingänge. Bei geradem Alpha würde dieselbe
  Zeile die Farbe eines fast durchsichtigen Pixels gewichten, als wäre es undurchsichtig.
- Helligkeit skaliert `rgb` und lässt `a` in Ruhe — muss das Ergebnis aber auf `a` klemmen. Darüber
  hinaus ist der Texel keine gültige premultiplizierte Farbe mehr, und der Über-Operator ließe einen
  halbdurchsichtigen Clip heller malen als einen undurchsichtigen bei derselben Einstellung.

## Was für einen Clip geschieht

```
Quelltextur
  → das transformierte Viereck des Clips in ein Zwischenziel
  → ein Pass je aktivem Effekt, die zwei Ziele im Wechsel
  → Deckkraft, dann der Blendmodus des Clips, auf das Bild
     oder, solange ein Übergang läuft, eine Mischung mit dem Bild, das der Frame schon trägt
```

Ein Clip ohne Effekt und ohne laufenden Übergang überspringt das alles und geht direkt auf das Bild.
Dieser Weg ist der gewöhnliche und bleibt billig: nichts wird belegt und kein Pass übersetzt, solange
ein Projekt keinen Effekt trägt.

## Helligkeit

Ein Parameter, `amount`, eine Verstärkung: `1` ist das Bild, wie es ankam, `0` ist schwarz, und die
Obergrenze ist `4` — etwa so weit, wie eine 8-Bit-Quelle sich treiben lässt, bevor nur noch Rauschen
übrig ist.

Gegen einen echten Treiber gemessen, nicht behauptet: ein mittleres Grau von 64 kommt bei
Verstärkung zwei als 128 zurück; bei Verstärkung null ist der Clip schwarz und weiterhin
undurchsichtig; Weiß bei halbem Alpha bleibt halb durchsichtig, wie weit man es auch treibt.

## Überblendung

Ein Übergang ist ein Effekt mit zwei Eingängen, kein zweites Subsystem. `u_second` ist das Bild, das
der Frame schon trägt, wenn der eingehende Clip an der Reihe ist, `u_source` ist dieser Clip nach
seinen eigenen Effekten, und `progress` läuft über das Fenster des Übergangs von nichts nach allem.

So legt man einen an: die beiden Clips **zeitlich überlappen** lassen und im Inspector unter
Übergang die Überblendung wählen. Sie landet an der eingehenden Kante mit Ausrichtung `in`, der
einzigen, die M1 ausspielen kann. Dann haben beide Clips über die Länge der Überlappung ein Bild,
und die Mitte der Überblendung ist die Hälfte von jedem — eine messbare Farbe, und sie wird
gemessen.

Die Deckkraft des eingehenden Clips steckt im selben Fortschritt. Ein halb deckender Clip auf halber
Strecke seines Übergangs ist zu einem Viertel herüber, nicht zur Hälfte und danach noch einmal
abgeblendet. Sobald das Fenster hinter dem Zeitpunkt liegt, wird der Clip wieder auf gewöhnlichem
Weg zusammengesetzt.

## Was noch fehlt, beim Namen genannt

- **Ein über den Inspector gesetzter Übergang ist nie in einem Test gezeichnet worden.** Eine
  Überblendung braucht zwei überlappende Clips, und die Anwendungs-Harness legt eine Datei ab. Dass
  das Feld unverändert ankommt, ist gemessen, und dass der Renderer es mischt, ist gemessen — nur
  nie in einem Durchgang.
- **Keyframes gibt es auf Effektparametern und sonst nirgends.** `Clip::keyframes` steht im Modell,
  aber `Effect::param_at` ist die einzige Auswertung im Repo und die Zeichenliste liest
  `clip.transform` statisch — ein Keyframe auf einer Clip-Eigenschaft wären Daten, die kein Bild
  sieht.
- **Ein zentrierter oder nachlaufender Übergang ist zur Hälfte unsichtbar.** Sein Fenster reicht vor
  den Anfang des Clips zurück, wo der Clip gar nicht gezeichnet wird. Ihn auszuspielen braucht
  Handles — Material über den Schnitt hinaus — und die legt in diesem Meilenstein nichts an.
- **Effekte laufen im Bildraum, nach der Transformation**, nicht auf der Quelle in deren eigener
  Auflösung. Für einen Effekt pro Pixel ist das dasselbe; für eine Unschärfe nicht, und an dem Tag,
  an dem eine Unschärfe kommt, gehört diese Entscheidung noch einmal geprüft.
- **Adjustment-Spuren, Spur-Effekte und Master-Effekte zeichnen weiterhin nichts.** Die Naht liegt in
  der Zeichenliste; die Mechanik ist dieselbe Kette, angewandt auf das Zwischenziel einer Spur.
- **`overlay` und `difference` fallen weiterhin auf `normal` zurück.** Sie brauchen das Ziel als
  Textur, und die hat der Übergangspfad jetzt — sie sind ein kleiner Schritt, kein fehlendes Stück.

## Wo es gemessen wird

`pnpm --filter @videola/engine test:gpu` fährt den ganzen Compositor gegen headless Chrome mit
SwiftShader und prüft echte Pixel, jede Farbaussage dieser Seite eingeschlossen. Kein Playwright,
kein Browser-Download; `CHROME_PATH` setzen, falls die ausführbare Datei an einer ungewöhnlichen
Stelle liegt.
