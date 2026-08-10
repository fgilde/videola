# Das `.videola`-Format

::: info Zusammenfassung
Das vollständige Kapitel gibt es nur auf Englisch: [The .videola format](/guide/videola-format). Es
beschreibt jeden Eintrag, jede Größenbegrenzung und jede Warnung im Detail. Diese Seite fasst es
zusammen.
:::

Eine `.videola`-Datei ist ein ZIP-Archiv. `unzip -l projekt.videola` listet es auf,
`unzip -p projekt.videola project.json` liefert das Modell, und man braucht Videola nicht, um
hineinzusehen. Leser, Schreiber und Migration liegen in `crates/videola-core/src/format`.

## Aufbau

Was der Schreiber heute erzeugt:

```
projekt.videola  (ZIP)
├─ videola.json          das Manifest
├─ project.json          das Modell
└─ media/<sha256>.<ext>  ein Eintrag je Bibliotheks-Asset
```

Die beiden JSON-Einträge sind deflate-komprimiert und eingerückt geschrieben, also direkt aus dem
Archiv lesbar. Medien werden **gespeichert, nicht komprimiert** — H.264, AAC und JPEG sind schon
komprimiert.

Vorgesehen, aber noch nicht geschrieben: `media/index.json`, `assets/fonts/`, `preview.jpg`,
`preview.mp4` und darunter, klar abgetrennt, das Regenerierbare — `proxies/`, `thumbs/`,
`cache/waveforms/` und `history.json`.

## Vertrag und Cache

Das ist die wichtige Unterscheidung im Aufbau. **Vertrag** sind Manifest, Modell, Medien, Fonts und
Vorschauen; wer davon etwas verliert, verliert Arbeit. **Cache** sind Proxies, Thumbnails, Peaks und
die optionale Historie — alles daraus ableitbar. Ein *Slim Save* lässt den Cache weg und erzeugt eine
kleine, teilbare Datei; ein *Full Save* behält ihn, damit das Öffnen sofort schnell ist. Beide öffnen
überall, und ein Leser darf niemals Vertragsinformationen aus einem Cache-Eintrag ableiten.

## `videola.json`

```json
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "projectId": "prj_…",
  "title": "Mein Projekt",
  "created": "2026-08-07T10:00:00Z",
  "modified": "2026-08-07T10:00:00Z",
  "locale": "de"
}
```

Das Manifest ist eine **Bequemlichkeitskopie**, damit ein Dateibrowser oder eine Galerie Titel und
Identität ohne Parsen des Modells lesen kann. `project.json` ist immer die einzige Wahrheit. Weichen
die beiden voneinander ab, meldet der Leser eine `manifestMismatch`-Warnung mit dem betroffenen Feld
und entscheidet nicht selbst, welcher Kopie zu glauben ist.

## Inhaltsadressierung

Ein Eintrag heißt `media/<64 Hex-Zeichen>.<Endung>`, wobei die Hex-Zeichen der SHA-256-Hash der
eigenen Bytes sind; die `MediaId` im Modell ist derselbe Hash mit dem Präfix `med_`. Die Endung wird
aus `originalName` abgeleitet und nur akzeptiert, wenn sie aus einem bis acht alphanumerischen
ASCII-Zeichen besteht, sonst wird sie zu `bin`. Weil der ganze Name abgeleitet und nie übernommen
wird, kann kein Wert aus der Datei einen Eintrag aus `media/` herauslenken.

## Laden

Ein defektes Archiv oder ein fehlendes, unlesbares oder zu großes `videola.json` beziehungsweise
`project.json` scheitert hart. Alles andere wird zur Warnung, damit ein beschädigtes Asset nur ein
Relink kostet und nicht das Projekt: `missingMedia`, `unreadableEntry`, `migrated` und
`manifestMismatch`. Clips ohne Medium behalten alle Parameter.

Drei Obergrenzen schützen den Lader, und sie sind so klein, weil die Crate auch als
`wasm32-unknown-unknown` läuft: 64 MiB je JSON-Eintrag, 512 MiB je Medien-Eintrag und 2 GiB für alle
Medien eines Ladevorgangs zusammen.

## Schema-Version

`SCHEMA_VERSION` ist derzeit `1`. Die Regeln: ein fehlendes `schemaVersion` bedeutet Version 1; ein
vorhandenes, aber nicht ganzzahliges ist ein Fehler; eine neuere Version als die eigene wird
abgelehnt statt geraten; eine ältere wird migriert und die Migration als Warnung gemeldet. Migriert
wird auf dem JSON-Baum, bevor das Modell deserialisiert wird — deshalb braucht keine alte
Struktur-Definition aufbewahrt zu werden.

## Unbekannte Felder überleben

`Project`, `Timeline`, `Clip` und `Effect` haben je eine `#[serde(flatten)]`-Sammelkarte. Was der
Leser nicht kennt, wird beim Laden aufgefangen und beim Speichern zurückgeschrieben. Das ist, was
eine ältere Videola-Version davon abhält, eine neuere Datei zu beschädigen.

## `.audiola`: das Werkzeug nebenan

[Audiola](https://www.audiola.de) ist das Audio-Werkzeug aus derselben Werkstatt, und seine
Projektdatei hat dieselbe Form wie diese: ein ZIP mit einem Manifest neben einem `media/`-Ordner.
Videola liest eine und schreibt eine — eine dort gebaute Mischung landet auf dieser Zeitleiste, und
ein hier gebauter Schnitt kann dort fertiggemischt werden.

**Lesen.** Eine `.audiola` auf das Fenster ziehen. Jede ihrer Spuren wird eine Tonspur mit Namen,
Farbe, Pegel, Panorama, Stumm und Solo; jeder Clip wird ein Clip mit seiner Lage auf der Zeitleiste,
seiner Lage in der Datei, seiner Länge, seinem Pegel und seinen zwei Blenden. Die Medien landen in
derselben Ablage unter demselben Inhalts-Hash wie jedes andere Medium, eine Datei, die schon hier ist,
wird also nicht zweimal gespeichert. Sie wird hinzugefügt und nicht geöffnet — eine Mischung kommt in
einen bestehenden Schnitt — und der ganze Import ist ein Schritt in der Historie.

**Schreiben.** Jeder Clip mit Ton dahinter geht mit: eine Tonspur, und eine Bildspur, deren Material
eine Tonspur hat — genau das, was jemand zu einem Mischpult mitnehmen würde. Die Medien werden so
abgelegt, wie Audiola sie ablegt, `media/<Index>_<Name>`, und der Pfad jedes Clips wird darauf
umgeschrieben: genau das sucht Audiolas eigener Leser.

**Was in keine Richtung mitreist.** Audiolas Mastering-Kette, sein EQ und sein Spatial-Layout haben im
Modell eines Video-Editors kein Gegenstück; Videolas Effekte, Übergänge und Keyframes haben in dem
eines Mischpults keines. Eines als das andere zu schreiben hieße, eine Bedeutung zu erfinden, der
keines der beiden Werkzeuge zugestimmt hat. Der Leser **benennt**, was er zurückgelassen hat —
„Mastering stays in Audiola" — und der Schreiber zählt es, denn ein stiller Verlust ist das eine
Ergebnis, das es auszuschließen lohnt. Und jedes Feld des Manifests, für das diese Seite keine
Verwendung hat, wird unangetastet durchgereicht: eine Datei, die dorthin geht, hierher kommt und
zurückgeht, behält ihre Mischung.

**Zwei Umrechnungen und wo sie etwas verlieren können.** Audiola zählt in `double`-Sekunden, Videola
in ganzzahligen Flicks: eine Sekunde wird eine genaue Anzahl Flicks, weil ein Flick 705.600.000 pro
Sekunde ist, und der Weg zurück verliert nur, was ein `double` ohnehin nicht hält. Und ein Pegel in
Dezibel ist hier ein Faktor — −6 dB sind die halbe Amplitude — geklemmt auf dieselben 0..4, auf die der
Kern eine Lautstärke klemmt: eine Datei, die +40 dB behauptet, kommt als das Lauteste an, was Videola
erlaubt, und nicht als Zahl, die die Kommandoschicht ablehnen würde. Ein geschlossener Regler wird als
−120 dB geschrieben, denn Stille hat keinen Dezibelwert, und eine Null dort läse sich zurück als
Verstärkung eins.

**Die Feldnamen sind Audiolas.** Sein C# schreibt mit `System.Text.Json` ohne Namensregel, das
Manifest ist also PascalCase, und es liest seine eigene Datei mit Beachtung der Groß- und
Kleinschreibung: `Media`, nicht `media`. Ein Test hält das fest, denn ein camelCase-Manifest wäre eine
Datei, die Audiola öffnet und leer findet.
