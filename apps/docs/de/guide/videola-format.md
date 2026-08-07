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
