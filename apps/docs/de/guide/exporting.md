# Exportieren

**Gebaut.** Ein Projekt lässt sich als MP4 mit H.264 und AAC schreiben, oder als WebM mit VP9 und
Opus, wenn der Browser kein H.264 kodieren kann. Alles läuft im Browser: kein Server, kein FFmpeg
irgendwo auf dem Weg.

## Was tatsächlich läuft

Der Export rendert die Timeline offline, Bild für Bild, durch **dieselbe Compositor-Klasse, die
auch die Vorschau benutzt**. Genau darum geht es bei dieser Anordnung — ein zweiter Renderpfad ist
der eine Weg, auf dem eine fertige Datei von dem abweichen kann, was beim Schneiden auf dem Schirm
stand.

Für jedes Ausgabebild:

1. Der Kern wird gefragt, wo jeder sichtbare Clip zu diesem Zeitpunkt liest.
2. Die Dekoder liefern die Bilder dieser Quellzeitpunkte.
3. Der Compositor zeichnet sie in ein `OffscreenCanvas` in der Exportauflösung.
4. `VideoEncoder` kodiert das Canvas über [mediabunny](https://mediabunny.dev), und der Muxer hängt
   das Ergebnis an.

Der Ton wird getrennt in einem Durchgang von einem `OfflineAudioContext` gerendert, mit demselben
Audiograph wie die Wiedergabe, und geht als eine Spur an den Encoder.

## Er läuft in einem Worker

Ein Export über einige Minuten sind einige Minuten durchgehendes Dekodieren und Kodieren. Auf dem
Hauptthread ist das ein eingefrorenes Fenster, also lebt der Lauf in einem eigenen Worker
(`packages/engine/src/export/worker.ts`) mit eigenem WebGL2-Kontext auf einem `OffscreenCanvas`.

Ein Teil bleibt zurück und kann nicht mitkommen: **Web Audio ist eine Window-API.**
`OfflineAudioContext` gibt es im Worker nicht — in Chrome gemessen, nicht vermutet —, also wird der
Ton auf dem Hauptthread gerendert und werden seine Samples in den Worker übergeben. Offline-Rendern
läuft nicht in Echtzeit und blockiert die Oberfläche nicht.

Ebenfalls zurück bleibt die Frage „wo liest dieser Clip gerade?“. Der Rust-Kern liegt auf dem
Hauptthread, und `WasmDocument` lässt sich aus einer `.videola`-Datei oder aus nichts bauen,
niemals aus einem `Project`. Die Antwort für jedes Ausgabebild wird deshalb vor dem Lauf eingesammelt
und reist mit dem Auftrag mit.

## Zeitstempel kommen aus dem Modell

Jedes Ausgabebild liegt auf dem Lineal des Projekts: Bereichsanfang plus ganze Bilddauern in
[Flicks](/de/guide/architecture#zeit-ist-eine-ganzzahl). Nichts liest einen Zeitstempel aus einem
Dekoder zurück.

Das ist keine Erbsenzählerei. `EncodedPacket.microsecondTimestamp` schneidet ab: Bild 10 einer
NTSC-Datei liegt bei 333.666,67 µs und reist als 333.666. Eine Datei, deren Bilder aus diesen Zahlen
platziert wurden, läuft alle dreiunddreißig Sekunden um ein ganzes Bild aus dem Tritt.

## Das Formatmenü bietet nur an, was auch kodiert

Welche Codecs ein Browser *kodieren* kann, ist nicht dieselbe Frage wie welche er abspielt, und die
Antwort unterscheidet sich zwischen Chromium, Firefox und Safari — und zwischen Rechnern, denn ein
4K-H.264-Encode kann abgelehnt werden, wo 1080p mühelos läuft. Der Dialog fragt deshalb
`VideoEncoder.isConfigSupported` und `AudioEncoder.isConfigSupported` mit genau der Größe und dem
Tonformat, die der Lauf wirklich benutzt, und bietet nur an, was ja gesagt hat.

Ist H.264 nicht verfügbar, sagt der Dialog das in Ihrer Sprache und bietet stattdessen WebM mit VP9
an. Fehlt der Audio-Codec, sagt er, dass der Export stumm bleibt, statt auf halbem Weg zu scheitern.

## Der Dialog

| Einstellung | Anmerkung |
|---|---|
| Format | MP4 (H.264 und AAC) oder WebM (VP9 und Opus), gefiltert nach dem, was kodiert |
| Breite, Höhe | Vorgabe aus dem Projekt; beide Kanten bleiben gerade, weil jeder Codec hier die Farbe halb so fein abtastet |
| Bilder pro Sekunde | Durchgehend rational — 30000/1001 steht als es selbst da, nie als 29,97 |
| Bitrate | In Mbit/s. Der Vorschlag folgt Auflösung und Bildrate, bis Sie selbst etwas eintragen |
| Bereich | Das ganze Projekt oder der ausgewählte Clip |

Der Fortschritt zählt Ausgabebilder und erreicht auf dem letzten hundert Prozent. **Abbrechen hält
wirklich an**: der Worker wird beendet, und weil die Datei ausschließlich in dessen Speicher
existiert, bleibt nichts halb Geschriebenes zurück.

## Woher wir wissen, dass es funktioniert

Ein grüner Unit-Test beweist nichts über eine Videodatei.
`pnpm --filter @videola/engine test:export` fährt deshalb die echte Kette in einem headless Chrome:

- kodiert eine farbcodierte H.264-Datei und einen Ton, importiert beide über den echten Importweg
  nach OPFS und in den echten Rust-Kern,
- exportiert eine Sekunde des entstandenen Projekts durch den echten Worker,
- liest die Datei mit dem Demuxer zurück und prüft Auflösung, Bildrate, Länge, Bildzahl,
  Bildreihenfolge und die Farbe einzelner Bilder,
- schreibt die Datei auf die Platte und gibt sie an **ffprobe und ffmpeg**, die mit nichts in diesem
  Repository Code teilen, zur Bestätigung von Codec, Auflösung, Bildrate, Bildzahl, Länge,
  Tonspur — und dass jedes Bild dekodiert,
- dekodiert den Ton zurück und misst, dass der Ton herauskommt, der hineinging.

## Was noch fehlt

- **Kein FFmpeg, kein natives und kein serverseitiges Rendern.** Der Export läuft ausschließlich über
  WebCodecs; die Tauri-Hülle hostet das Web-Bundle und nimmt denselben Weg.
- **Effekte und Übergänge sind noch nicht im Bild**, weil die Effektkette selbst es nicht ist. Was
  der Compositor heute zeichnet, ist das, was der Export schreibt.
- **Rückwärts laufende Clips bleiben stumm**, wie in der Wiedergabe: ein `AudioBufferSourceNode`
  kennt keine negative Abspielrate.
- **Der Ton des ganzen Bereichs wird auf einmal gerendert und gehalten.** Eine Stunde Stereo sind
  etwa 1,4 GB an Samples. Ein Planungsfenster wäre der Ausweg und ist nicht gebaut.
- **Die Quellzeitpunkte des ganzen Bereichs werden vor dem Lauf eingesammelt.** Bei 30 fps sind das
  für eine Stunde 108.000 Aufrufe über die WASM-Grenze, rund eine Sekunde Arbeit vor dem Start.
