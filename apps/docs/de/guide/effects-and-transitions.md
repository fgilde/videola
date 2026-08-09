# Effekte und Übergänge

**Zwölf Effekte, sieben Übergänge, zwei Masken, drei Messgeräte und eine Textmaschine — ausgewählt
in einer Bibliothek, die jeden einzelnen bei der Arbeit zeigt.** Jede Farbe auf dieser Seite ist an
einem echten Treiber gemessen und nicht behauptet: `pnpm --filter @videola/engine test:gpu` fährt 349
Pixelprüfungen durch headless Chrome, und jede Aussage hier unten ist eine davon.

## Ein Effekt ist ein Manifest und ein Fragment-Shader

Eine Datei pro Effekt unter `packages/engine/src/effects`, die ein Manifest exportiert:

```ts
export const contrast: EffectManifest = {
  id: "contrast",
  name: { de: "Kontrast", en: "Contrast" },
  blurb: { de: "Spreizt oder staucht …", en: "Spreads or flattens …" },
  category: "color",
  inputs: 1,
  // Womit die Kachel der Bibliothek gezeichnet wird -- nie mit den Vorgaben, siehe unten.
  preview: { amount: 2.4 },
  params: [{ key: "amount", name: { de: "Stärke", en: "Amount" }, default: 1, min: 0, max: 4 }],
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

### Ein Parameter ist eine Fließkommazahl, eine Farbe oder eine Kurve

Bis vor kurzem trug jedes Manifest ausschließlich Fließkommazahlen, und genau daran war
eine LUT gescheitert. `ParamValue` im Rust-Kern trägt `Color`, `Int`, `Bool`, `Vec2` und `Choice`,
seit das Modell geschrieben wurde; was fehlte, war irgendetwas zwischen Projektdatei und Uniform,
das hätte sagen können, welche Sorte ein Parameter ist.

Ein Manifestparameter nennt jetzt seine `kind`. Sie ist optional und steht standardmäßig auf
`"float"`, damit jedes Manifest, das vor der zweiten Sorte geschrieben wurde, weiterhin lesbar ist —
auch die des Tons, hinter denen ein `AudioParam` steht und die nie etwas anderes sein können.

```ts
{ kind: "color", key: "colour", name: { de: "Farbe", en: "Colour" }, default: [0, 0, 0, 1] }
```

Eine Farbe wird **gerade** verfasst, jeder Kanal 0 bis 1, und auf dem Weg zur Uniform
premultipliziert — dieselbe Naht, über die auch der Projekthintergrund gelesen wird, und aus
demselben Grund. `clampColor` ist die Schranke, und sie erzwingt den Vertrag, auf dem die ganze
Kette ruht: kein Kanal über seinem eigenen Alpha. Die Prüfung, die dort einen Fehler fängt, füttert
nicht 1,4 — das klemmt ein RGBA8-Ziel von allein und beweist nichts. Sie füttert einen Kanal *über
Alpha und unter Eins*, und dort hört ein Texel auf, eine gültige premultiplizierte Farbe zu sein,
ohne dass irgendetwas dahinter es bemerkt.

In der Oberfläche ist eine Farbe die Auswahl des Browsers selbst. `input[type=color]` bringt
Pipette, Farbkreis, zuletzt benutzte Farben und den Systemdialog mit, den man ohnehin kennt; was
eine eigene Auswahl hinzufügte, wäre ein zweiter Satz Fehler.

`ponytail:` die Auswahl kennt kein Alpha, sie ändert also rgb und trägt weiter, welches Alpha das
Modell hielt — und ein Farbparameter bekommt keinen Keyframe-Schalter, obwohl `ParamValue::lerp`
einen bereits interpolieren kann.

```ts
{ kind: "curve", key: "luma", name: { de: "Helligkeit", en: "Brightness" }, default: IDENTITY_CURVE }
```

Eine Kurve ist eine **Liste von Stützpunkten**, `[Eingang, Ausgang]` mit beidem in 0 bis 1 und
aufsteigendem Eingang — die Punkte, die jemand zieht, und nicht die Tabelle, die ein Shader liest.
Dieser Unterschied ist die ganze Entwurfsentscheidung, und sie fiel aus einem Grund so: aus Punkten
lässt sich eine Tabelle ableiten, aus einer Tabelle keine Punkte. Eine abgetastet gespeicherte Kurve
ließe sich rendern und nie wieder bearbeiten, und ein Keyframe zwischen zwei Tabellen ist kein
Keyframe zwischen zwei Kurven — er ist einer zwischen zwei ihrer Schatten. `ParamValue::Curve` trägt
darum die Punkte, und `ParamValue::lerp` interpoliert sie paarweise in beiden Koordinaten, damit ein
keyframetes Knie auch seitlich wandert und nicht nur hoch. Zwei Kurven mit verschiedener Punktzahl
haben überhaupt keine Paarung und interpolieren nicht; der Kern hält dann den früheren Keyframe,
genau wie bei einem `Bool`.

**Als Uniform-Feld in den Shader, nicht als Textur.** `clampCurve` tastet die Punkte auf 32
gleichmäßig verteilte Ausgänge ab, `uniform1fv` füllt ein `float[32]`, und der Shader mischt zwischen
benachbarten Einträgen. Eine LUT-Textur war der andere Kandidat und hätte eine Textureinheit, einen
Upload-Pfad und eine Lebensdauer in der Compositor-Verwaltung gekostet — die drei Dinge, die lecken —
und dafür nichts gebracht: eine keyframete Kurve hat in jedem Bild andere Punkte, die Textur wäre
also ohnehin aus eben diesen Punkten neu gebaut worden. Was eine Textur *brächte*, wäre Interpolation
in Hardware und eine Tabelle, die lang genug ist, damit die Interpolation nicht zählt; gemessen zählt
sie auch bei 32 nicht. Der Fehler, den ein linearer Zwischenwert gegenüber der Kurve selbst lässt,
bleibt unter einer halben 8-Bit-Stufe, und `curve.test.ts` ist die Prüfung, die das sagt.

Diese Wahl brauchte eine zusätzliche Regel in `setUniforms`, und die ist vollständig statt glücklich:
**ein Feld mit mehr als sechzehn Komponenten kann kein Vektor und keine Matrix sein**, denn GLSL ES
kennt nichts Breiteres als eine `mat4`. Unter siebzehn bleibt die Form mehrdeutig und wird weiterhin
abgelehnt.

Zwischen den Punkten ist die Kurve ein **monoton kubischer Spline** — Fritsch–Carlson — und kein
gewöhnlicher. Ein gewöhnlicher Spline durch drei Punkte, die ein Kolorist wirklich setzt, schießt
zwischen ihnen über, und ein Überschwinger auf einer Tonwertkurve ist ein heller Saum an jeder Kante
im Bild, die diesen Tonwert kreuzt. Die monotone Begrenzung gibt etwas Glätte auf und kann dafür nie
aus dem Kasten heraus, den zwei benachbarte Punkte aufspannen. Außerhalb der äußersten Punkte läuft
die Kurve flach weiter statt extrapoliert: ein Stützpunkt bei 0,2 sagt, was bei 0,2 geschieht, und
eine Steigung jenseits des Gezeichneten zu raten ist, wie eine im Editor zahm aussehende Kurve die
Schatten abschneidet.

Der Abtaster liegt in `@videola/core` und nicht in der Engine, obwohl Pixelarithmetik dort natürlich
hingehörte. Zwei sehr verschiedene Verbraucher brauchen genau dieselbe Antwort daraus: der Renderer
tastet sie in die Tabelle des Shaders ab, und das Kurvenfeld zeichnet die Linie unter dem Finger. Eine
zweite Umsetzung auf der Zeichenseite wäre eine Kurve, die so aussieht und anders korrigiert — der
eine Fehler, den ein Kurvenwerkzeug nicht haben darf. Keyframe-Auflösung ist das nicht: *welche*
Punkte die Kurve zu einem Zeitpunkt hat, bleibt die Antwort des Kerns und kommt aus Rust.

An der Oberfläche ist eine Kurve ein quadratisches Feld mit den Punkten als echten Schaltflächen über
einer SVG-Zeichnung. Punkt ziehen verschiebt ihn, Tippen ins Feld setzt einen neuen dorthin, Tippen
auf einen Punkt nimmt ihn weg; die beiden Enden bleiben. Schaltflächen statt Kreise in der Zeichnung,
weil drei Dinge dadurch geschenkt sind, die in SVG keins davon sind: die Plattform fokussiert sie und
erreicht sie mit der Tastatur, das Fingerziel kommt aus demselben `--v-touch-target` wie jedes andere
Bedienelement, und eine Browserprüfung kann das Rechteck messen, das ein Finger treffen muss. Ein
Kreis in einer skalierten `viewBox` hat einen Radius in Nutzereinheiten, und vierundvierzig Pixel
sind keine feste Anzahl davon.


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
| Kontrast, Kurven, Farbräder | **nein** | durch `a` teilen, rechnen, zurück multiplizieren |
| Chroma-Keying | schreibt `a` | den ganzen `vec4` skalieren, Farbe und Alpha zusammen |
| Masken | schreibt `a` | den ganzen `vec4` skalieren; `m` liegt in [0, 1], also klemmt nichts |

Zwei Folgerungen, die man kennen sollte, bevor man einen Shader schreibt:

- **Wer `rgb` skaliert, klemmt auf `a`.** Jenseits davon ist das Texel keine gültige premultiplizierte
  Farbe mehr, und der Über-Operator ließe einen halbdurchsichtigen Clip bei derselben Einstellung
  heller malen als einen deckenden.
- **Ein Weichzeichnen auf geradem Alpha zählt die Farbe eines durchsichtigen Texels so hoch wie die
  eines deckenden.** Das ist der dunkle Saum um jeden weichgezeichneten Freisteller, und
  premultipliziert ist, was ihn wegnimmt.

Kontrast war der erste Effekt hier, der nicht linear ist, und der Unterschied ist nicht fein: derselbe
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
| Kurven | Farbe | `luma`, `red`, `green`, `blue`, je eine Punktliste | zieht einzelne Tonwerte hoch oder herunter |
| Farbräder | Farbe | `liftTint`/`liftAmount`, `gammaTint`/`gammaAmount`, `gainTint`/`gainAmount` | Schwarzpunkt, Mitten und Weißpunkt |
| Vignettierung | Farbe | `amount` 0–1, `size` 0–1,4 | dunkelt zu den Ecken hin ab |
| Weichzeichnen | Detail | `amount` 0–16 | separabler Gauß, Abstand in Bildpixeln |
| Schärfen | Detail | `amount` 0–4 | Unschärfemaske gegen die vier Nachbarn |
| Chroma-Keying | Stanze | `hue` 0–360, `tolerance`, `softness` | stanzt einen Farbton aus; 120 ist Greenscreen |
| Maske (Rechteck) | Stanze | `centerX`, `centerY`, `width`, `height`, `feather`, `invert` | behält ein Rechteck, lässt den Rest fallen |
| Maske (Ellipse) | Stanze | dieselben sechs | behält die einbeschriebene Ellipse |

Es gibt keinen eigenen Schwarzweiß-Effekt: er wäre der Sättigungs-Shader mit festgenageltem Regler.

Ein Chroma-Keying übergeht Graustufen mit Absicht. Ein Grau hat keinen sinnvollen Farbton und die
Rechnung liefert dafür Null zurück — ohne eine Untergrenze für die Sättigung würde eine auf Rot
gestellte Stanze also jedes Grau im Bild wegradieren.

### Vier Kurven, nicht drei

Die drei Kanalkurven sind die gewöhnlichen: Rot hinein, Rot heraus. Die vierte ist nicht diese drei
auf dieselbe Form gestellt, und genau deshalb gibt es sie. Sie liest das Rec.-709-Luma des Pixels,
fragt die Kurve, was aus diesem Tonwert werden soll, und skaliert alle drei Kanäle mit dem Verhältnis
— das Verhältnis zwischen ihnen und damit Farbton und Sättigung kommen also genau so heraus, wie sie
hineingingen. Gemessen an einem Pixel 180, 90, 30 durch dieselbe S-Kurve: die Helligkeitskurve gibt
146, 73, 24, weiterhin genau zwei zu eins; dieselbe Form durch die drei Kanalkurven gibt 217, 60, 8,
und das ist eine Sättigungsänderung, um die niemand gebeten hat.

Was ein Verhältnis nicht kann, ist etwas anheben, das schon schwarz ist. Den Fuß der
Helligkeitskurve anzuheben öffnet die Schatten und lässt echtes Schwarz stehen — dafür ist Lift an
den Farbrädern da, dessen ganze Aufgabe das Addieren statt des Skalierens ist.

### Lift, Gamma und Gain sind ein Effekt

Sie sind eine Gerade. Lift sagt, wohin Schwarz geht, Gain sagt, wohin Weiß geht — zusammen legen sie
eine Gerade durch den Tonwertbereich —, und Gamma biegt, was dazwischen liegt, ohne eines der beiden
Enden mitzunehmen. In drei Effekte zerlegt liefe die Kette drei Runden
Unpremultiplizieren/Premultiplizieren und drei Klemmungen für eine Gerade, und die mittlere klemmte
ein Bild, das die letzte gleich wieder streckt.

Jedes Rad ist ein **Farbstich und eine Stärke**, und genau das sind die zwei Bedienelemente an einem
echten Pult: das Rad schiebt die drei Kanäle auseinander, der Ring bewegt alle drei zusammen. Ein
Farbstich ist als Farbe gespeichert, Mittelgrau ist also gar kein Stich, und der Abstand zu
Mittelgrau ist der Schub. Er kommt premultipliziert an wie jede Farbe, die hier einen Shader
erreicht, und wird zurückgeteilt — Alpha ist Deckung, und ein Farbstich deckt nichts.

Auseinanderhalten lassen sich die drei auf Schwarz, und nur dort. Ein Mittelgrau kann es nicht: ein
Lift von 0,25 und ein Gain von 0,25 setzen es beide auf 160. Auf Schwarz gibt Lift 64 und die anderen
beiden geben 0.

### Eine Maske ist ein Effekt, kein Feld am Clip

Alles, was eine Maske braucht, gab es für Effekte schon: Parameter, die der Rust-Kern auflöst und
keyframet, eine Kette mit Zwischenzielen, das Klemmen, das einen Wert aus einer Projektdatei als
Uniform brauchbar macht, `Project::normalize` als Ladeschranke, die Kommandos `effect.*` und
`keyframe.*` und einen Inspektor, der für jeden Parameter eines Manifests eine Zeile zeigt. Ein Feld
`clip.mask` hätte einen Modelltyp gebraucht, einen Arm in `normalize`, eigene Kommandos und
MCP-Werkzeuge, eine Stapelabfrage über die WASM-Grenze und Code im Inspektor — alles nur, um
*multipliziere die Deckung mit einer Form* auszudrücken.

Zwei Dinge fallen dabei umsonst ab. **Masken setzen sich zusammen**: ein Rechteck und eine Ellipse
in einer Kette schneiden sich, weil jede die Deckung skaliert, die die vorige übrig ließ. Und eine
Maske ist mit denselben Kommandos **keyframebar** wie jeder andere Parameter — das macht eine
wandernde Aufdeckung zu einem gewöhnlichen Schnitt.

Der Preis: eine Maske wird im **Bildraum, nach der Transformation** gemessen, an derselben Stelle
wie eine Vignettierung. Ein Clip, der unter einer stehenden Maske wandert, ist die Aufdeckung, die
das einbringt; eine Maske, die *mit* ihrem Clip mitläuft, bräuchte die Kette im Clipraum. Zwei
Masken derselben Form auf einem Clip gehen auch nicht: `effect.add` behandelt einen wiederholten Typ
als Nichtstun, ein zweites Rechteck bräuchte also eine Kette nach Effekt-Id statt nach Typ.

Sechs Parameter, alle als Anteile des Bildes, damit sie bei jeder Ausgabegröße dasselbe bedeuten:
`centerX`/`centerY` von der linken oberen Ecke, `width`/`height` als **volle** Ausdehnung und nicht
als halbe, `feather` mittig auf der Kante, damit ein Vergrößern die Grenze nicht verschiebt, und
`invert` als Blende zum Gegenteil statt als Schalter — die Enden sind die zwei Einstellungen, die
jemand will, und die Mitte ist eine glatte Hälfte.

Zwei Verträge, die eine Maske nicht verfehlen darf, beide gemessen:

- **Sie skaliert alle vier Kanäle, nicht nur Alpha.** Auf premultiplizierter Farbe ist `(rgb·a, a)`
  mal `m` dieselbe Farbe bei geringerer Deckung. Der Reflex vom geraden Alpha — nur `a` anfassen —
  lässt `rgb` auf voller Helligkeit stehen, und der Über-Operator addiert dann ein ganzes Weiß auf
  den Hintergrund statt eines Drittels. Die Pixelprüfung liest richtig gerechnet 81 und falsch 255.
- **`y` wird gespiegelt.** `v_uv` läuft im Durchgang *nach oben*, jede Messung im Modell nach unten.
  Eine Maske mit Mitte 0,25 gehört ins obere Viertel und landet ohne die Spiegelung im unteren. Ein
  Rechteck ist nicht symmetrisch zur mittleren Zeile — genau deshalb fällt das hier auf und ist bei
  den y-symmetrischen Effekten davor nie aufgefallen.

## Ein Bewegungspfad ist eine Keyframe-Spur

Ein Clip kann über eine Kurve laufen statt über zwei unabhängige Rampen auf `x` und `y`. Die Spur
heißt `position`, sie ist der eine Keyframe-Schlüssel, der ein `vec2` trägt statt eines `float`, und
sie wird mit demselben `keyframe.add` geschrieben wie ein Effektparameter — ein Kommando je Punkt.

Die Kurve ist ein Catmull-Rom-Spline durch die Punkte, aufgelöst im Rust-Kern von `transform_at` und
an den Renderer gereicht über dieselbe Stapelabfrage `transformsAt`, auf der jede andere Platzierung
reist. Das ist Absicht: läge die Interpolation in TypeScript, rechnete der Export einen anderen Pfad
als die Vorschau.

Drei Eigenschaften, die man kennen sollte:

- **Zwei Punkte ergeben exakt die Gerade zwischen ihnen.** Der gedachte Punkt jenseits eines Endes
  ist sein Nachbar, an ihm gespiegelt, und damit ist die Endtangente die Sehne selbst. Ohne diese
  Spiegelung bauchte ein Pfad aus zwei Punkten aus, und ein Pfad wäre keine Obermenge eines Paares
  von `x`/`y`-Spuren mehr.
- **Ein dritter Punkt formt das Stück davor um.** Das ist der ganze Unterschied zwischen einem Pfad
  und einem Streckenzug, und es ist das, was getrennte `x`- und `y`-Spuren nicht ausdrücken können —
  sie interpolieren Wert gegen Zeit und können sich nur in einer Ecke treffen.
- **`interp` führt weiterhin die Zeit und sonst nichts.** Halten, Weichlauf und die Bezier-Anfasser
  entscheiden, wie schnell der Clip die Kurve entlangläuft, nie wohin die Kurve läuft. Damit behält
  die Interpolation eines Schlüssels ihre eine Bedeutung.

Eine `position`-Spur sticht `x` und `y` beide. Die beiden über die Reihenfolge entscheiden zu lassen
hieße, die Antwort dem Alphabet einer `BTreeMap` zu überlassen, und wo ein Clip steht, ist keine
Frage der Schreibweise.

`ponytail:` die Parametrisierung ist gleichförmig statt zentripetal, also ziehen Punkte, die im Raum
weit und in der Zeit nah beieinander liegen, die Kurve in einen Überschwinger — sie lehnt sich vor
einer kommenden Ecke von ihr weg, bevor sie einbiegt. Zentripetales Catmull-Rom nimmt dieselben vier
Punkte und teilt durch die Sehnenlängen; das ist der Tausch für den Tag, an dem ein Pfad sichtbar
über einen Schlüssel hinausschleift.

## Die Bibliothek, und woher ihre Bilder kommen

Dreizehn Namen in einem Auswahlfeld sind eine Liste. Was sie ersetzt hat, ist ein Regal: nach
Kategorien geordnet, durchsuchbar über beide Sprachen und über den Satz unter jedem Namen — und
**jeder Eintrag zeigt, was er tut**.

Eine Kachel ist keine Illustration des Effekts. Sie ist der Fragment-Shader dieses Effekts selbst,
über einem echten Bild, durch dasselbe Bildschirmviereck und dieselbe Uniform-Konvention wie in der
Zeitleiste — `EffectPreview` in `packages/engine/src/render/preview.ts`, das sich
`SCREEN_VERTEX_SOURCE` mit dem Compositor teilt, damit `v_uv` nicht im Editor so und in der Kachel,
die ihn zeigen will, andersherum läuft.

**Das Bild ist das, was der Editor gerade zeigt.** Die Vorschau-Leinwand wird lesbar angelegt und
trägt das komponierte Bild am Abspielkopf bereits, die Quelle für das ganze Raster kostet also ein
`drawImage` in eine 192x108-Kladde und keinen Dekoder. Das ist die Entscheidung, die klar gesagt
gehört, denn die naheliegende Alternative ist ein Dekodiervorgang je Kachel — und ein Dekodiervorgang
je Kachel, um einen Dialog zu füllen, ist genau das, was eine Bibliothek kaputt wirken lässt.
Die Durchgänge selbst sind nicht das Teure: eine Kachel zu 192x108 sind zwanzigtausend Fragmente, die
siebzehn der heutigen Bibliothek zusammen ein Sechstel eines einzigen 1080p-Bildes. Darum wird hier
nichts träge geladen und nichts zwischen zwei Öffnungen aufbewahrt — ein Zwischenspeicher zeigte das Bild von
dort, wo der Abspielkopf einmal stand.

Wo die Zeitleiste kein Bild hergibt — ein leeres Projekt oder ein Abspielkopf in einer Lücke —
fallen die Kacheln auf ein **erzeugtes Referenzbild** zurück: ein Farbtonverlauf quer, ein
Helligkeitsabfall nach unten, harte senkrechte Balken für die beiden Kerne und ein sattes Grün für
das Chroma-Keying. Es ist immer noch die Ausgabe des Effekts selbst; nur das Material ist von uns.
Es ist zugleich das, wogegen die Pixelprüfungen messen — denn ein Bild, das jedem Effekt etwas zu
tun gibt, ist das einzige, bei dem eine Kachel, die nichts zeigt, dem Effekt anzulasten ist und
nicht dem Material.

Zwei Folgen daraus, dass aus dem echten Bild gezeichnet wird, beide ehrlich und beide wissenswert:

- **Die Kachel des Chroma-Keyings tut nichts an Material, das nie vor einer Wand gedreht wurde.**
  Genau das täte der Effekt an diesem Material, und eine Kachel, die etwas anderes vorgäbe, wäre das
  Versprechen ohne die Deckung.
- **Helligkeit und Kontrast sehen an einem gesättigten Testbild ähnlich aus**, weil Balken, die
  schon am Anschlag sind, nicht heller werden können. An echtem Material tun sie es.

### Ein Manifest nennt seine eigene sprechende Einstellung

Die Kachel aus den Vorgabewerten zu zeichnen wäre die Falle gewesen: ein Faktor von 1 und eine Wärme
von 0 sind das unangetastete Bild, das halbe Regal hätte also einen Effekt versprochen und einen
gezeigt, der nichts tut. Jedes Manifest trägt darum ein `preview` — die eine Einstellung, die seinen
Punkt macht. Die der Sättigung ist die Null und keine Anhebung, weil Schwarzweiß die eine
Einstellung ist, die niemand für das Original hält. Die einer Blende über Farbe ist **nicht** die
Mitte, denn in der Mitte ist eine solche Blende nichts als ein flaches Rechteck der Farbe, durch die
sie blendet, und sagt nichts über den Effekt, der es erzeugt hat.

Die Pixelprüfung dahinter ist die, auf der diese ganze Funktion ruht: Die Kachel jedes Manifests
muss sich von dem Bild, aus dem sie gezeichnet wurde, um mehr als acht Stufen unterscheiden,
gemittelt über jeden Kanal jedes Pixels. Eine Kachel, die zurückkam, ist nichts wert; eine Kachel,
die *verändert* zurückkam, ist die Aussage.

## Anpassungsspuren

Eine Spur der Art **adjustment** trägt kein eigenes Bild. Sie trägt Clips, und die Effektkette eines
Clips auf ihr läuft über **alles, was darunter gezeichnet wird**, solange dieser Clip dauert.
`tracks[0]` ist unten im Stapel, eine Ebene bedeckt also jede Spur mit kleinerem Index und lässt jede
darüber in Ruhe — das ist alles, was eine Anpassungsebene ausmacht, und der Grund, fünf Einstellungen
auf einmal zu graden, statt denselben Effekt auf fünf Clips zu legen.

Der Clip auf der Ebene ist ein gewöhnlicher Clip. Seine Spanne ist die Spanne, über die das Grading
wirkt, seine Effekte werden im Inspector gebaut wie alle anderen, und ihn auf null zu blenden
schaltet die Ebene ab. Die Spur zu verbergen tut dasselbe. Eine Ebene innerhalb eines Compound-Clips
bedeckt, was in diesem Compound liegt, und hört an der Faltung auf; eine Ebene außerhalb reicht
hinein und gradet jeden Clip darin.

Zwei oder mehr Ebenen stapeln sich von unten nach oben, und die eigenen Effekte eines Clips laufen
immer zuerst: ein Grading wirkt auf das Bild, wie der Clip am Ende aussieht, nicht auf das Bild,
bevor seine eigenen Effekte es angefasst haben.

Nachweisbar ist das an genau einer Stelle, und das sind Pixel. Die GPU-Prüfstrecke stellt ein Bild
unter eine Ebene und ein zweites daneben und liest beide zurück: das darunter muss sich ändern, das
daneben nicht — und eine verborgene Ebene, eine Ebene ohne Clip und eine Ebene, deren Clip anderswo
in der Zeit liegt, dürfen keines von beiden ändern.

Die Durchgänge laufen **einmal über das zusammengesetzte Bild**, nicht einmal je Clip. Alles unter
der Ebene wird zuerst auf eine eigene Fläche komponiert, und die Kette trifft danach dieses eine
Bild — ein Weichzeichner sieht also die Naht zwischen zwei Clips statt jeden für sich, und ein Effekt
auf fünf Einstellungen ist der Effekt einmal auf das, was die fünf zusammen ergeben. Die Prüfstrecke
misst den Unterschied: zwei Clips, die Kante an Kante unter einer weichgezeichneten Ebene stehen,
halten Rot und Grün über die Fuge hinweg auf volle 255 — zeichnet man sie einzeln weich, fällt
dieselbe Summe auf 194 und der Hintergrund scheint zwischen ihnen durch.

Eine Ebene, die nichts bedeckt, kostet nichts: die Fläche wird nur dort angefordert, wo eine Ebene
wirklich über etwas steht, und überall sonst bleibt der Zeichenpuffer die Fläche.

## Die Messgeräte

Ohne Messgerät ist jede Farbentscheidung eine Vermutung über einen Monitor. Drei davon lesen die
Vorschau: eine **Wellenform**, ein **Vektorskop** und ein **Histogramm**, in einer Leiste unter dem
Bild, die der Schalter in der Transportleiste öffnet.

Sie lesen die Vorschau, weil die Vorschau die eine Fläche in dieser Anwendung ist, von der überhaupt
jemand ein Pixel zurückverlangt — `createContext(canvas, { readable: true })`, also
`preserveDrawingBuffer`. Die Pixel liegen also schon da.

**Was das kostet, gemessen bevor es entschieden wurde.** Auf dem Software-Rasterisierer, auf dem die
Prüfstände laufen, bei 1080p:

| | pro Messung |
|---|---|
| `readPixels` des ganzen Zeichenpuffers, 8,3 MB | 3,4 ms |
| dasselbe, dann zwei Millionen Pixel gezählt | **33,6 ms** |
| `sample(256, 144)` — ein Blit, dann ein Lesen von 147 kB | 0,22 ms |
| dasselbe, dann 36 864 Pixel gezählt | **0,91 ms** |

Dreiunddreißig Millisekunden sind länger als ein Bild, in jedem Bild, für eine Anzeige, an der
niemand zieht. Das Verkleinern geschieht deshalb auf der GPU: `Compositor.sample` blittet den
Zeichenpuffer in einen kleinen Framebuffer und liest den zurück, und die Anzeige misst zehnmal in der
Sekunde statt sechzigmal. Zehn Hertz von 0,91 ms sind unter einem Prozent eines Kerns, und solange
die Leiste zu ist, wird gar nichts zurückgelesen.

**Der Blit ist NEAREST, und darin liegt der ganze Unterschied zwischen einer Messung und einem
Bild.** Vier Nachbarn zu mitteln erfindet Werte, die kein Pixel hatte: ein einzelnes ausgefressenes
Licht in einem dunklen Feld mittelt sich zu einem Mittelton herunter, und das Messgerät berichtet
genau das nicht mehr, wofür es da ist. Abtasten darf so ein Pixel verfehlen; es darf es nie zu einem
weichzeichnen, das es nie gab. Der Pixelprüfstand verkleinert ein 32er-Bild mit genau zwei Stufen auf
dreizehn und prüft, dass genau zwei zurückkommen — dreizehn und nicht sechzehn, weil ein bilineares
Lesen bei ganzzahligem Verhältnis auf Texelmitten fällt und dieselbe Antwort gäbe wie NEAREST.

`ponytail:` das Lesen ist weiterhin synchron und wartet damit auf die GPU. Ein `PIXEL_PACK_BUFFER`
mit einem Fence, ein Bild später gelesen, würde gar nicht warten — lohnt sich, sobald ein Messgerät
der Wiedergabe folgen muss statt einem Menschen, der es ansieht.

Drei weitere Dinge, bei denen die Messgeräte genau sind:

- **Premultipliziert, wie alles hinter dem Clip-Shader.** Ein Messgerät geht über die Farbe und nicht
  über die Deckung, jedes Pixel wird also durch sein eigenes Alpha zurückgeteilt. Als gerades Alpha
  gelesen, liest sich ein halbdurchsichtiges Weiß als Mittelgrau.
- **Ein Pixel ohne Deckung hat keine Farbe zu melden** und fällt ganz heraus, statt als Schwarz
  gezählt zu werden. Als Schwarz gezählt sieht ein leeres Bild aus wie ein perfekt belichtetes mit
  Objektivdeckel. Ein leeres Bild ergibt darum eine leere Messung, und die Anzeige sagt das in
  Worten, statt durch eine Anzahl von null zu teilen.
- **Das Raster kommt aus derselben Umrechnung wie die Messung.** Die sechs Kästchen sind die
  Farbbalken bei drei Vierteln Amplitude, gerechnet statt erinnert, damit Punktwolke und Kästchen
  nicht auseinanderlaufen können.

## Der Farbraum, und was er für die Farbkorrektur bedeutet

Das Bild kommt weit häufiger als nicht als BT.709 mit begrenztem Wertebereich, und der Browser
rechnet es beim Hochladen aus dem `VideoColorSpace` des Bildes um — `BROWSER_DEFAULT_WEBGL`. Es in
einem eigenen Shader noch einmal umzurechnen, würde mit einer Umrechnung konkurrieren, welche die
Metadaten kennt, und zwei Umrechnungen sind schlechter als die eine, die es weiß.

Heraus kommt **nicht-lineares sRGB**, und alles dahinter mischt darin. Für den größten Teil der
Bibliothek ist das der übliche Kompromiss, den jedes Schnittprogramm eingeht. Für die Farbkorrektur
ist es eine echte Einschränkung, und die gehört benannt statt übergangen:

- **Ein Gammazug ist kein Belichtungszug.** Eine Blende aufmachen ist im linearen Licht eine
  Multiplikation; hier ist es eine Multiplikation bereits codierter Werte, die die Schatten stärker
  anhebt als die Lichter. Es sieht aus, wie Leute es von einem Schnittprogramm erwarten, weil jedes
  Schnittprogramm es so macht, und es ist nicht, was ein Belichtungsmesser sagen würde.
- **Sättigung und Helligkeitskurve rechnen Luma, nicht Leuchtdichte.** Die Rec.-709-Gewichte liegen
  auf den codierten Werten, eine kräftige Entsättigung verschiebt also die empfundene Helligkeit ein
  wenig. Die Wellenform misst dieselbe Größe, immerhin sind Messgerät und Effekt damit untereinander
  einig.
- **Eine Überblendung auf halbem Weg ist nicht das halbe Licht.** Codierte Werte zu mischen verdunkelt
  die Mitte jeder Blende gegenüber einer linearen Mischung. Sichtbar bei einer Blende zwischen einer
  hellen und einer dunklen Einstellung.
- **Eine Quelle mit großem Farbraum oder HDR wird vom Browser beim Hereinkommen tone-gemappt**, und
  nichts hier kann das rückgängig machen. Diese Kette korrigiert ein SDR-Bild.

`ponytail:` die Abhilfe ist eine Änderung der Kette und nicht eines Shaders: sRGB-Texturformate, ein
sRGB-Zeichenpuffer und ein Zwischenziel in Half-Float, damit die Kette lineares Licht trägt und die
Codierung einmal am Ende geschieht. Jede Klemmung auf `[0, a]` in dieser Bibliothek müsste dann gegen
einen größeren Bereich klemmen, und jede gemessene Zahl auf dieser Seite würde sich verschieben.

## Übergänge

Ein Übergang ist ein Effekt mit zwei Eingängen, kein zweites Teilsystem. `u_second` ist das Bild, das
der Frame schon trägt, wenn der ankommende Clip an der Reihe ist, `u_source` ist dieser Clip nach
seinen eigenen Effekten, und `progress` läuft über das Fenster des Übergangs von nichts bis alles.

| Übergang | Parameter | Was er tut |
|---|---|---|
| Überblendung | — | ein schlichtes Mischen der beiden |
| Wischen | `angle` 0–360, `softness` 0–1 | eine Kante zieht übers Bild |
| Schieben | `angle` 0–360, `push` 0–1 | der ankommende Clip kommt herein; `push` sagt, wie weit er den abgehenden vor sich her schiebt |
| Kreisblende | `centerX`, `centerY`, `softness` | ein Kreis öffnet sich auf den ankommenden Clip |
| Zoomen | `from` 0,05–4 | der ankommende Clip wächst aus der Mitte |
| Weichzeichnen-Blende | `amount` 0–48 | eine Überblendung, die in der Mitte weich wird und an beiden Enden wieder scharf |
| Blende über Farbe | `colour` | hinaus durch eine frei gewählte Farbe und wieder herein |

Ein Schieben mit `push` 1 schiebt das abgehende Bild aus dem Rahmen, mit 0 bleibt es stehen und das
ankommende schiebt sich darüber. Zwei Shader, deren einziger Unterschied eine Multiplikation mit
null ist, sind zwei Shader zu viel.

Eine Kreisblende misst ihre Reichweite zu der Ecke, die von ihrer Mitte tatsächlich am weitesten
entfernt ist, in einem um das Seitenverhältnis korrigierten Raum. Eine feste Diagonale stimmt für
einen mittigen Kreis auf einem quadratischen Bild und sonst nirgends — bei 16:9 oder von einer in
die Ecke geschobenen Mitte endet der Übergang, während noch Zwickel des abgehenden Clips stehen.

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

- **Masken sind nur rechteckig und elliptisch.** Eine gezeichnete oder mitlaufende Maske braucht ein
  Polygon im Modell und einen Shader, der es abtastet, und Mitlaufen braucht etwas zum Verfolgen.
  Die zwei Formen hier schneiden sich in einer Kette, was mehr abdeckt, als die Zahl vermuten lässt
  — aber eine um ein Motiv gezogene Form ist eine andere Funktion.
- **Eine Maske läuft im Bildraum, nicht mit ihrem Clip.** Sie wird nach der Transformation gemessen,
  ein bewegter Clip zieht das Bild also unter einer stehenden Maske durch. Eine an ihre Ebene
  geheftete Maske will die Kette im Clipraum, und das ist eine Änderung am Bildgraphen, nicht an
  einem Shader.
- **Eine Maske je Form und Clip.** `effect.add` behandelt einen wiederholten Typ als Nichtstun, ein
  zweites Rechteck braucht also die Kette nach Effekt-Id statt nach Effekttyp.
- **Noch kein Editor für einen Bewegungspfad.** Der Kern löst die Kurve auf und der Renderer
  zeichnet sie, aber die Punkte werden per Kommando gesetzt statt in der Vorschau gezogen. Das
  Manifest kennt jetzt eine Parametersorte, eine `vec2`-Zeile ist also ein kleinerer Schritt als
  vorher; was ein Pfad eigentlich will, ist ein Griff im Bild und nicht zwei weitere Zahlen in einer
  Leiste.
- **Bewegungsunschärfe** braucht mehr als einen Zeitpunkt je Ausgabebild, also mehr als ein
  dekodiertes Bild je Ausgabebild. Das ist eine Änderung am Einsammeln, nicht an einem Shader.
- **LUT-Import** fehlt weiterhin, und die Parametersorte ist nicht mehr das, was im Weg steht: ein
  Manifestparameter nennt jetzt eine, und eine Farbe legt den ganzen Weg von der Projektdatei bis zu
  einer `vec4`-Uniform zurück. Übrig sind die anderen drei Viertel — ein `.cube`-Parser, ein Ort für
  eine Tabelle, die für eine Projektdatei bei weitem zu groß ist, und eine dritte Textureinheit,
  gebunden durch Compositor, Vorschau und Export-Worker gleichermaßen. Das ist eine Änderung am
  Bildgraphen, nicht an einem Manifest.
- **Form- und Countdown-Generatoren malen nichts.** Sie stehen im Modell, sie stehen nicht im Menü,
  und ein Clip, dessen Generator dieser Renderer nicht malen kann, fällt aus der Zeichenliste, statt
  als leeres Rechteck gezeichnet zu werden.
- **Ein zentrierter oder nachlaufender Übergang ist zur Hälfte unsichtbar.** Sein Fenster reicht vor
  den Anfang des Clips zurück, wo der Clip gar nicht gezeichnet wird. Ihn auszuspielen braucht
  Handles — Material über den Schnitt hinaus — und nichts erzeugt sie.
- **`transitionOut` wird nie gelesen.** Ein Schnitt zwischen zwei Clips wird als `transitionIn` des
  ankommenden Clips verfasst, weil der abgehende Clip zuerst gezeichnet wird und sich nicht mit dem
  mischen kann, was danach kommt.
- **Spureffekte und Master-Effekte malen weiterhin nichts.** Die Naht sitzt in der Zeichenliste;
  die Mechanik ist dieselbe Kette über einer eigenen Fläche der Spur — und genau die fahren eine
  Anpassungsebene und ein Compound-Clip bereits.
- **`overlay` und `difference` fallen weiterhin auf `normal` zurück.** Sie brauchen das Ziel als
  Textur, was der Übergangsweg hat — ein kleiner Schritt statt eines fehlenden Stücks.
- **Fonts im Export-Worker sind, was der Worker auflösen kann.** Eine generische Familie geht immer;
  ein von der Seite geladener Webfont ist dort nicht automatisch geladen.

## Wo es gemessen wird

`pnpm --filter @videola/engine test:gpu` fährt den ganzen Compositor gegen headless Chrome mit
SwiftShader und prüft echte Pixel, einschließlich jeder Farbaussage auf dieser Seite und jeder
Kachel der Bibliothek. Kein Playwright,
kein Browser-Download; `CHROME_PATH` setzen, wenn die ausführbare Datei woanders liegt.
