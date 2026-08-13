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
| Vorgabe | 1080p, 4K, 720p, hochkant 1080 × 1920, quadratisch 1080 — füllt die Größenfelder darunter |
| Format | MP4 (H.264 und AAC) oder WebM (VP9 und Opus), gefiltert nach dem, was kodiert |
| Breite, Höhe | Vorgabe aus dem Projekt; beide Kanten bleiben gerade, weil jeder Codec hier die Farbe halb so fein abtastet |
| Bilder pro Sekunde | Durchgehend rational — 30000/1001 steht als es selbst da, nie als 29,97 |
| Bitrate | In Mbit/s. Der Vorschlag folgt Auflösung und Bildrate, bis Sie selbst etwas eintragen |
| Bereich | Das ganze Projekt oder der ausgewählte Clip |

Eine Vorgabe trägt **nur Größen und Bildraten**, nie eine Bitrate: der Vorschlag wird aus Größe und
Rate gerechnet, eine Vorgabe mit eigener Bitrate wäre also eine zweite Meinung zur selben Frage — und
falsch wäre die, die nach dem Ändern der Größe niemand neu gerechnet hat. Eine Vorgabe gibt das
Bitratenfeld deshalb an diesen Vorschlag zurück, auch wenn dort schon eine Zahl stand: eine Bitrate für
720p ist nicht die Bitrate für 4K.

Die Bildrate des Projekts bleibt, solange eine Vorgabe nicht auf einer besteht. Einen 25er-Schnitt
stillschweigend auf 30 zu setzen ließe jedes fünfte Bild fallen oder doppelt sein, und im Wort „1080p"
stand davon nichts. Die Auswahl geht nach einem Griff auf ihre eigene Überschrift zurück, denn sie
benennt eine Handlung — der Zustand sind die Felder darunter.

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

## Den Schnitt an einen anderen Editor geben

Drei Dateien verlassen Videola, die kein Video sind: eine **EDL**, **FCPXML** und **Final Cut Pro 7
XML** — alle drei unter **Datei ▸ Weitergeben**. Ein hier gebauter Schnitt kann in DaVinci Resolve,
Premiere Pro oder Final Cut fertiggestellt werden: die Montage reist, die Farbe und die Effekte
entstehen dort.

Das ist mit Absicht ein Dialog und keine drei Menüzeilen. „EDL exportieren“ setzt voraus, dass man
weiß, was eine EDL ist, und wer das nicht weiß, wählt zwischen drei XML-ähnlichen Namen. Jede Karte
sagt in einem Satz, was die Datei ist, welches Programm sie öffnet und was sie nicht mitnimmt — und
derselbe Dialog trägt die zwei Exporte, die zum Projekt gehören statt zum Schnitt: die Untertitel und
den Ton für Audiola. Wo dieses Projekt nichts zu schreiben hat, ist die Karte abgeschaltet und sagt
warum.

Keine der drei trägt einen Effekt, einen Keyframe oder eine Farbkorrektur, und das ist keine Lücke,
die später geschlossen wird: es gibt keinen ehrlichen Weg, eine Videola-Weichzeichnung als eine von
Resolve zu schreiben. Was alle drei tragen, ist, wo jedes Stück Material sitzt — und das ist, was ein
Conform braucht.

| | EDL (CMX3600) | FCPXML 1.9 | Final Cut Pro 7 XML (`xmeml` 5) |
|---|---|---|---|
| Spuren | eine Bild-, eine Tonspur | jede Spur, auf Lanes | jede Spur, Bild und Ton getrennt |
| Namen | Relink über den Clipnamen | Relink über das Asset, nach Inhalts-Hash benannt | Relink über den Dateinamen |
| Gelesen von | praktisch allem | Resolve, Final Cut | **Premiere Pro**, Resolve |
| Zeiten | Timecode, `HH:MM:SS:FF` | exakte Brüche | ganze Bilder |

**Welche man nimmt.** FCPXML und `xmeml` sind zwei verschiedene Formate mit verwirrend ähnlichen
Namen, und welches ein Editor liest, ist keine Geschmacksfrage. Resolve öffnet FCPXML 1.x gut. Die
FCPXML-Unterstützung von Premiere Pro war immer nur teilweise da, während **Datei ▸ Importieren** eine
`xmeml`-Sequenz nimmt, seit Premiere beruflich Final-Cut-Projekte gelesen hat — das ist die Datei, die
als echte Sequenz mit echten Clips ankommt und nicht als Fehlerliste. Also: Resolve → FCPXML,
Premiere → Final Cut Pro 7 XML, und Videola schreibt beides, statt zu raten. Gespeichert wird als
`.xml`, denn das ist die Endung, die der Importdialog von Premiere anbietet.

`xmeml` zählt in ganzen Bildern, das ist die Entscheidung des Formats und der eine Punkt, in dem es
sich überall zugleich von FCPXML unterscheidet: jeder Zeitpunkt wird eine Bildnummer, kaufmännisch
gerundet, ein Schnitt landet also auf dem Bild, auf dem er gesetzt wurde. `start` und `end` sagen, wo
ein Clip liegt, `in` und `out`, welchen Teil der Datei er zeigt, und `end` ist exklusiv. Eine Datei
wird einmal deklariert und danach über ihre Kennung referenziert, ein viermal benutztes Medium ist also
ein Eintrag im Projektfenster. Ein Lücken-Element hat das Format nicht, ein Clip ohne Material — ein
Titel, eine Farbfläche — bleibt daher weg statt als Clip zu reisen, der auf nichts zeigt.

Die EDL sagt in einem Kommentar, welche Spuren sie nicht mitnehmen konnte, statt zwei Ebenen
stillschweigend fallen zu lassen. Ihr Timecode ist immer Non-Drop, und wo das Projekt auf einer
gebrochenen Rate läuft — 30000/1001 — sagt ein Kommentar das, denn eine von Hand an dieser Uhr
abgelesene Dauer fällt etwas zu kurz aus.

FCPXML rundet nichts. Eine Zeit steht als `Wert/Zeitskala s` mit dem Zähler der Bildrate als
Zeitskala, und weil ein Flick 705.600.000 pro Sekunde ist und sich ohne Rest durch jede gebräuchliche
Rate teilt, ist jeder Zeitpunkt eines Projekts eine ganze Zahl von Ticks. Ein Clip ohne Medium
dahinter — ein Titel, eine Farbe, ein verschachtelter Clip — reist als Lücke der richtigen Länge und
nicht als Asset, das auf nichts zeigt; letzteres öffnet im anderen System als Offline-Clip, den jemand
suchen muss.

Alle drei entstehen im Rust-Kern, neben dem Leser und dem Schreiber und aus demselben Grund: ein
Timecode ist Ganzzahl-Arithmetik über eine gebrochene Rate, und eine zweite Umsetzung in TypeScript
wäre eine zweite Antwort auf dieselbe Frage. `project_handOff` bietet alle drei einem Agenten an — und lehnt ein
Format ab, das es nicht schreibt, statt auf eines auszuweichen: nach AAF zu fragen und FCPXML zu
bekommen ist die schlechteste der drei möglichen Antworten.

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
