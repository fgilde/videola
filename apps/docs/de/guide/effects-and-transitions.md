# Effekte und Übergänge

**Acht Effekte, fünf Übergänge und eine Textmaschine.** Jede Farbe auf dieser Seite ist an einem
echten Treiber gemessen und nicht behauptet — `pnpm --filter @videola/engine test:gpu` fährt 188
Pixelprüfungen durch headless Chrome, und jede Aussage hier unten ist eine davon.

## Ein Effekt ist ein Manifest und ein Fragment-Shader

Eine Datei pro Effekt unter `packages/engine/src/effects`, die ein Manifest exportiert:

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
| `in vec2 v_uv` | die Stelle im Bild, **y läuft nach oben** |
| `uniform sampler2D u_source` | die Kette bis hierher, premultipliziert |
| `uniform sampler2D u_second` | der zweite Eingang, premultipliziert, nur bei `inputs` gleich 2 |
| `uniform float u_<key>` | einer je deklariertem Parameter |
| `uniform float u_pass` | welcher Durchgang das ist, nur bei `passes` gleich 2 |
| `textureSize(u_source, 0)` | die Texelgröße, für jeden Kern, der eine braucht |

### Die y-Achse ist das Einzige hier, das nicht frei wählbar ist

Ein Durchgang zeichnet dasselbe Viereck, das er abtastet, also muss `v_uv` auf dem Ziel die Identität
sein — und ein Ziel liegt so, wie GL es ablegt, erste Zeile unten. Der eigene Shader des Clips, vor
der Kette, läuft y andersherum.

Jeder symmetrische Effekt verdeckt das. Aufgefallen ist es, als der Wischer zum ersten Mal auf 90°
stand und von unten kam. Ein Effekt, dem die Richtung wichtig ist, rechnet um statt anzunehmen: eine
Richtung, die auf dem Schirm im Uhrzeigersinn lesen soll — dieselbe Konvention wie die Drehung der
Transformation — ist innerhalb eines Durchgangs `vec2(cos a, -sin a)`.

## Zwei Durchgänge für einen separablen Kern

Ein Manifest darf `passes: 2` deklarieren, dann läuft sein Shader zweimal, mit `u_pass` auf 0 und
dann 1. Das sind achtzehn Abtastungen für ein Weichzeichnen, für das ein einzelner Durchgang
einundachtzig bräuchte. Die Zeichenliste entfaltet das in zwei Einträge, damit die Regel des
Compositors bestehen bleibt: ein Eintrag, eine Zeichnung.

## Die Werte kommen aus dem Kern, nie aus TypeScript

Ein Parameter kann statisch oder keyframed sein, und `Effect::param_at` im Rust-Kern entscheidet,
welcher gewinnt und wie eine Keyframe-Spur interpoliert. Der Renderer fragt den Kern nach der
Antwort:

```ts
const params = doc.effectParamsAt(playhead);
```

Ein Aufruf pro Bild, nicht einer pro Effekt, weil die Vorschau in Anzeigerate fragt. Das Ergebnis ist
eine Abbildung von Effekt-Id auf eine Abbildung von Parameterschlüssel auf `ParamValue`, und sie deckt
jeden Effekt auf jedem Clip ab, den der Zeitpunkt berührt.

TypeScript macht damit zwei Dinge und sonst nichts: es packt den `ParamValue` aus und klemmt die Zahl
in den Bereich, den das Manifest deklariert. Ein Wert einer Art, die keine Zahl ist, einer außerhalb
des Bereichs oder ein `NaN` fällt auf die Vorgabe des Manifests zurück — alle drei reisen sonst
kommentarlos durch `uniform1f` und färben den Clip schwarz.

Die eigenen Parameter eines Übergangs kommen aus dem Modell statt aus diesem Stapel und gehen durch
dieselbe Klemme. Ein Winkel für einen Wischer, den eine Projektdatei ausgelassen hat, ist die Vorgabe
des Manifests und nicht die Null einer nie gesetzten Uniform — und für einen Wischer sind das zwei
verschiedene Richtungen.

In TypeScript zu interpolieren gäbe der Vorschau und dem Export zwei verschiedene Antworten auf
dasselbe Bild. Genau diese Abweichung soll der Rust-Kern verhindern, und deshalb ist dieser Weg eine
Abfrage und keine Rechnung.

**Keyframes werden auf Projektzeit gelesen.** Einen Clip rückwärts laufen zu lassen dreht um, welches
Bild dekodiert wird; es dreht nicht die Animation eines Effekts darauf um.

## Premultipliziertes Alpha, durchgängig

Der eigene Fragment-Shader des Clips premultipliziert einmal, auf dem Weg in die Kette. Alles danach —
jeder Durchgang, jedes Zwischenziel, das Bild auf dem Schirm — trägt premultiplizierte Farbe.

Auf welcher Seite dieser Linie ein Effekt liegt, entscheidet, wie er geschrieben wird:

| Operation | Linear in `a·c`? | Was das heißt |
|---|---|---|
| Helligkeit, Farbtemperatur, Vignettierung | ja | `rgb` skalieren, auf `a` klemmen |
| Sättigung, Weichzeichnen, Schärfen | ja | eine gewichtete Summe ist *der Grund* für premultipliziert |
| Überblendung, Wischen, Schieben | ja | ein schlichtes `mix` der beiden Eingänge |
| Kontrast | **nein** | durch `a` teilen, rechnen, zurück multiplizieren |
| Chroma-Keying | schreibt `a` | den ganzen `vec4` skalieren, Farbe und Alpha zusammen |

Zwei Folgerungen, die man kennen sollte, bevor man einen Shader schreibt:

- **Wer `rgb` skaliert, klemmt auf `a`.** Jenseits davon ist das Texel keine gültige premultiplizierte
  Farbe mehr, und der Über-Operator ließe einen halbdurchsichtigen Clip bei derselben Einstellung
  heller malen als einen deckenden.
- **Ein Weichzeichnen auf geradem Alpha zählt die Farbe eines durchsichtigen Texels so hoch wie die
  eines deckenden.** Das ist der dunkle Saum um jeden weichgezeichneten Freisteller, und
  premultipliziert ist, was ihn wegnimmt.

Kontrast ist der eine Effekt hier, der nicht linear ist, und der Unterschied ist nicht fein: derselbe
Regler auf einem halbdurchsichtigen Grau ergibt richtig gerechnet 97 und auf dem premultiplizierten
Wert 33. Keine Zusicherung über den Text des Shaders könnte die beiden unterscheiden — deshalb ist es
eine Pixelprüfung.

**Der Alphakanal ist nicht die Angelegenheit eines Blendmodus.** Der Compositor mischt Alpha in
`#draw` als schlichten Über-Operator, unabhängig von der Farbgleichung, also kann kein Modus ein
durchsichtiges Loch durchs Bild schlagen. Ein Chroma-Keying, das Transparenz erzeugt, ist etwas
völlig anderes — das passiert im Fragment-Shader, wo es hingehört.

## Die Bibliothek

Effekte laufen im **Bildraum, nach der Transformation**, auf dem Zwischenziel des Clips. Für einen
Effekt pro Pixel macht das keinen Unterschied. Für ein Weichzeichnen weicht es die Kanten des Clips
ins Bild hinein auf, und das ist richtig. Für eine Vignettierung heißt es, dass der Abfall eine
Eigenschaft der Aufnahme ist und nicht der Ebene — und genau das ist eine Vignettierung.

| Effekt | Kategorie | Parameter | Was er tut |
|---|---|---|---|
| Helligkeit | Farbe | `amount` 0–4 | eine Verstärkung; 1 unberührt, 0 schwarz |
| Kontrast | Farbe | `amount` 0–4 | eine Steigung um Mittelgrau; 0 flacht auf dieses Grau ab |
| Sättigung | Farbe | `amount` 0–2 | mischt zur Luma; **0 ist Schwarzweiß** |
| Farbtemperatur | Farbe | `amount` −1–1 | Rot gegen Blau, Grün verankert |
| Vignettierung | Farbe | `amount` 0–1, `size` 0–1,4 | dunkelt zu den Ecken hin ab |
| Weichzeichnen | Detail | `amount` 0–16 | separabler Gauß, Abstand in Bildpixeln |
| Schärfen | Detail | `amount` 0–4 | Unschärfemaske gegen die vier Nachbarn |
| Chroma-Keying | Stanze | `hue` 0–360, `tolerance`, `softness` | stanzt einen Farbton aus; 120 ist Greenscreen |

Es gibt keinen eigenen Schwarzweiß-Effekt: er wäre der Sättigungs-Shader mit festgenageltem Regler.

Ein Chroma-Keying übergeht Graustufen mit Absicht. Ein Grau hat keinen sinnvollen Farbton und die
Rechnung liefert dafür Null zurück — ohne eine Untergrenze für die Sättigung würde eine auf Rot
gestellte Stanze also jedes Grau im Bild wegradieren.

## Übergänge

Ein Übergang ist ein Effekt mit zwei Eingängen, kein zweites Teilsystem. `u_second` ist das Bild, das
der Frame schon trägt, wenn der ankommende Clip an der Reihe ist, `u_source` ist dieser Clip nach
seinen eigenen Effekten, und `progress` läuft über das Fenster des Übergangs von nichts bis alles.

| Übergang | Parameter | Was er tut |
|---|---|---|
| Überblendung | — | ein schlichtes Mischen der beiden |
| Wischen | `angle` 0–360, `softness` 0–1 | eine Kante zieht übers Bild |
| Schieben | `angle` 0–360 | der ankommende Clip schiebt den abgehenden hinaus |
| Zoomen | `from` 0,05–4 | der ankommende Clip wächst aus der Mitte |
| Schwarzblende | `level` 0–1 | hinaus durch eine flache Farbe und wieder herein |

Winkel sind Grad im Uhrzeigersinn auf dem Schirm: 0 kommt von links, 90 von oben.

So legt man einen an: die beiden Clips **zeitlich überlappen** lassen und den Übergang auf den
ankommenden Clip setzen, auf `in` ausgerichtet — die einzige Ausrichtung, die dieser Meilenstein
ausspielen kann. Dann haben beide Clips für die Länge der Überlappung ein Bild.

Die Deckkraft des ankommenden Clips steckt im selben Fortschritt. Ein halbdeckender Clip auf halbem
Weg durch seinen Übergang ist zu einem Viertel hinüber, nicht zur Hälfte und danach abgeblendet.
Sobald das Fenster hinter dem Zeitpunkt liegt, wird der Clip wieder auf gewöhnlichem Weg komponiert.

### Zoomen komponiert, es mischt nicht

Wo das ankommende Bild verkleinert wurde, ist außen herum nichts, und `mix` gewichtet beide Seiten —
es hätte also die Deckkraft dessen halbiert, was schon im Bild stand. In einer premultiplizierten
Leinwand ist das ein durchsichtiges Loch um das geschrumpfte Bild herum, und ein durchsichtiges Loch
ist die Seite, die durchs Bild scheint. Ein Über-Operator addiert nur. Die Prüfung, die das fängt,
liest die Ecke des Bildes durch eine farbige Seite.

## Titel

Ein Generator-Clip hat kein Medium hinter sich. Sein Bild wird gemalt statt dekodiert, und es füllt
den Frame — das ist die einzige Größe, die er hat.

**Text wird zu Pixeln über Canvas 2D in eine Textur**, nicht über Glyphenumrisse in Geometrie. Der
Browser hat Shaper, Font-Fallbackkette und Hinting-Maschine schon; jedes davon nachzubauen ist ein
Projekt und kein Meilenstein. Der Preis ist, dass ein Titel ein Raster in der Projektauflösung ist —
deshalb ist **jedes Maß in einem Textstil ein Bruchteil des Bildes** und nie eine Pixelzahl. Ein bei
720p verfasstes Projekt rastert seine Titel beim 4K-Export neu, und das ist die richtige Richtung.

`Generator::Text` trägt ein freies `style`-Objekt, also brauchte nichts davon eine Änderung am
Rust-Modell. Es braucht dafür eine Vertrauensgrenze: der Stil kommt aus einer Projektdatei, einer
Vorlage oder von einem Agenten, und auf einer Leinwand lässt eine unlesbare Farbe `fillStyle` stehen,
wo es stand, während eine unlesbare Fontzeichenkette `ctx.font` auf 10px sans-serif lässt. Beides
still, beides katastrophal. Jedes Feld ist begrenzt, jede Farbe ist hexadezimal oder die Vorgabe, und
ein Familienname ist auf das gekürzt, was eine CSS-Kurzschreibweise halten kann.

| Schlüssel | Vorgabe | Was es ist |
|---|---|---|
| `fontFamily` | `sans-serif` | eine generische Familie wird immer angehängt |
| `fontSize` | `0.09` | Bruchteil der Bildhöhe |
| `fontWeight` | `700` | 100–900 |
| `italic` | `false` | |
| `color` | `#ffffff` | hexadezimal, 3/4/6/8 Stellen |
| `align` | `center` | wie Zeilen relativ zu `x` sitzen |
| `lineHeight` | `1.25` | Vielfaches der Schriftgröße |
| `letterSpacing` | `0` | Bruchteil der Schriftgröße |
| `x`, `y` | `0.5`, `0.5` | der Anker des Blocks, als Bruchteil des Bildes |
| `maxWidth` | `0.8` | wo Zeilen umbrechen, Bruchteil der Bildbreite |
| `strokeWidth`, `strokeColor` | `0`, `#000000` | Bruchteil der Schriftgröße |
| `shadowBlur`, `shadowX`, `shadowY`, `shadowColor` | `0`, `0`, `0.05`, `#00000080` | Bruchteile der Schriftgröße |
| `background`, `padding` | `""`, `0.3` | ein Kasten hinter dem Text; leer heißt keiner |

Harte Umbrüche im Inhalt werden beachtet, der Rest wird auf `maxWidth` umgebrochen. Ein einzelnes
Wort, das nicht passt, bleibt lang statt gebrochen — Silbentrennung braucht ein Wörterbuch, und ein an
beliebiger Stelle geschnittenes Wort liest sich schlechter als eines, das übersteht.

Flächen- und Verlaufsgeneratoren werden über denselben Weg gemalt. Ein Verlauf spannt sich im eigenen
Winkel übers Bild, im Uhrzeigersinn auf dem Schirm.

### Die Animation eines Titels ist eine Transformation, kein Neuzeichnen

| Schlüssel | Werte |
|---|---|
| `animateIn`, `animateOut` | `none`, `fade`, `rise`, `fall`, `grow` |
| `animateInSeconds`, `animateOutSeconds` | `0.5` |
| `loop`, `loopSeconds` | `none` oder `pulse`, `2` |

Die Glyphen werden einmal gerastert, und bewegt wird das Viereck, auf dem sie sitzen. Ein pulsierender
Titel kostet damit eine Matrix pro Bild statt eines Textumbruchs pro Bild, und das
zwischengespeicherte Bild bleibt gültig, solange die Wörter es sind.

Beide Enden laufen durch dieselbe Funktion, also heißt `rise`, dass der Titel unterhalb seines
Platzes ist, solange er nicht darauf ist: er kommt herauf beim Hereinkommen und geht wieder hinunter
beim Hinausgehen. Zwei Tabellen für die zwei Enden sind, wie sie sich widersprechen.

Das sind bewusst **keine Keyframes**. Ein Keyframe wird im Rust-Kern aufgelöst, und eine zweite
Interpolation daneben wäre genau die Abweichung zwischen Vorschau und Export, die der Kern verhindern
soll. Das hier ist eine deklarative Vorlage ohne verfasste Zwischenwerte, ausgewertet in der
Zeichenliste — der einen Stelle, durch die Vorschau und Export beide gehen.

Der erste Augenblick einer Einblendung ist ein Clip mit Deckkraft null, und ein Clip mit Deckkraft
null steht gar nicht erst in der Zeichenliste. Das ist auch ein Bild, das niemand malen muss.

## Was für einen Clip passiert

```
Quelltextur, dekodiert oder gemalt
  → das Viereck des Clips, transformiert, in ein Zwischenziel
  → ein Durchgang je aktivem Effekt, zwei bei einem separablen, die Ziele wechseln sich ab
  → Deckkraft, dann der Blendmodus des Clips, aufs Bild
     oder, während ein Übergang läuft, eine Mischung mit dem Bild, das der Frame schon trägt
```

Ein Clip ohne Effekt und ohne laufenden Übergang überspringt das alles und geht direkt aufs Bild.
Dieser Weg ist der häufige und bleibt billig: nichts wird belegt und kein Durchgang übersetzt, bis ein
Projekt wirklich einen Effekt trägt.

## Was es noch nicht gibt, beim Namen

- **Masken und Bewegungspfade.** Beschnitt gibt eine rechteckige Maske und die Vignettierung eine
  radiale, aber eine geformte oder mitlaufende Maske braucht Pfade, und Pfade brauchen, dass die
  Zeichenliste `Clip::keyframes` liest — was sie nicht tut. Das ist dieselbe Lücke wie die nächste.
- **Keyframes gibt es auf Effektparametern und sonst nirgends.** `Clip::keyframes` steht im Modell,
  und die Zeichenliste liest `clip.transform` statisch, also ist ein Keyframe auf einer
  Clip-Eigenschaft ein Datum, das kein Bild sieht. Alles Animierte in diesem Meilenstein ist entweder
  ein Effektparameter oder die deklarative Vorlage eines Titels.
- **Bewegungsunschärfe** braucht mehr als einen Zeitpunkt je Ausgabebild, also mehr als ein
  dekodiertes Bild je Ausgabebild. Das ist eine Änderung am Einsammeln, nicht an einem Shader.
- **LUT-Import** braucht einen Dateiimport, eine 3D-Textur und einen Parameter, der kein Float ist.
  Das Manifest hat noch kein `type`-Feld; dort gehörte es hin.
- **Form- und Countdown-Generatoren malen nichts.** Sie stehen im Modell, sie stehen nicht im Menü,
  und ein Clip, dessen Generator dieser Renderer nicht malen kann, fällt aus der Zeichenliste, statt
  als leeres Rechteck gezeichnet zu werden.
- **Ein zentrierter oder nachlaufender Übergang ist zur Hälfte unsichtbar.** Sein Fenster reicht vor
  den Anfang des Clips zurück, wo der Clip gar nicht gezeichnet wird. Ihn auszuspielen braucht
  Handles — Material über den Schnitt hinaus — und nichts erzeugt sie.
- **`transitionOut` wird nie gelesen.** Ein Schnitt zwischen zwei Clips wird als `transitionIn` des
  ankommenden Clips verfasst, weil der abgehende Clip zuerst gezeichnet wird und sich nicht mit dem
  mischen kann, was danach kommt.
- **Anpassungsspuren, Spureffekte und Master-Effekte malen weiterhin nichts.** Die Naht sitzt in der
  Zeichenliste; die Mechanik ist dieselbe Kette, angewandt auf das Zwischenziel einer Spur.
- **`overlay` und `difference` fallen weiterhin auf `normal` zurück.** Sie brauchen das Ziel als
  Textur, was der Übergangsweg hat — ein kleiner Schritt statt eines fehlenden Stücks.
- **Fonts im Export-Worker sind, was der Worker auflösen kann.** Eine generische Familie geht immer;
  ein von der Seite geladener Webfont ist dort nicht automatisch geladen.

## Wo es gemessen wird

`pnpm --filter @videola/engine test:gpu` fährt den ganzen Compositor gegen headless Chrome mit
SwiftShader und prüft echte Pixel, einschließlich jeder Farbaussage auf dieser Seite. Kein Playwright,
kein Browser-Download; `CHROME_PATH` setzen, wenn die ausführbare Datei woanders liegt.
