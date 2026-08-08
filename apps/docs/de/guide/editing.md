# Schneiden

Diese Seite beschreibt, was die Oberfläche heute kann. Was hier nicht steht, gibt es noch nicht —
es gibt keinen Export in der Anwendung.

![Der Editor mit einem dekodierten Bild in der Vorschau](/editor-preview.png)

## Medien hineinbekommen

Zwei Wege, die dasselbe tun:

- Eine oder mehrere Dateien irgendwo auf das Fenster ziehen.
- **Medien importieren** in der Kopfzeile drücken.

Die Bytes werden mit SHA-256 gehasht und unter diesem Hash nach OPFS geschrieben, **bevor**
irgendein Command abgeschickt wird — ein Medium liegt also auf der Platte, bevor das Projekt sich
darauf bezieht. Dieselbe Datei zweimal importiert wird einmal gespeichert. Der Clip landet auf der
ersten Videospur; hat das Projekt keine, wird eine angelegt.

Ein unberührtes Projekt übernimmt das Format seines ersten Mediums, damit ein 640×360-Clip nicht als
kleines Rechteck in der Ecke eines 1080p-Bildes sitzt. Danach ist das Format eine Entscheidung, die
jemand getroffen hat, und **Ins Bild einpassen** im Inspector holt einen späteren Clip darauf.

## Die Timeline

| Geste | Wirkung |
|---|---|
| Klick auf einen Clip | wählt ihn aus |
| Ziehen in der Clipmitte | verschiebt ihn, auch über Spuren hinweg |
| Ziehen an einer Clipkante | trimmt diese Kante |
| Ziehen im Lineal | scrubbt |
| Zwei Zeiger | zoomen über die Abstandsänderung |
| Langes Drücken | öffnet das Kontextmenü — am Playhead teilen, löschen |

Alles läuft über Pointer Events, damit Maus, Stift und Finger denselben Weg nehmen. Ist der Zeiger
keine Maus, wachsen die Trimm-Zonen auf 44 px — ein 4 px breites Ziel am Clipende ist mit dem
Finger nicht zu treffen.

Ein ganzer Zug über zweihundert Zeigerbewegungen ist **ein** Undo-Schritt. Die Commands tragen einen
Coalesce-Key, den `pointerdown` prägt; der nächste `pointerdown` prägt einen neuen. Die Schieber im
Inspector arbeiten genauso, und dieselbe Regel macht einen Schieberzug über einem gekeyframten
Parameter zu einem Eintrag im Verlauf statt zu zweihundert Keyframes an derselben Stelle.

### Einrasten

**Einrasten** in der Werkzeugleiste schaltet es um. Kandidaten sind der Playhead, jede Clipkante
jeder Spur, Marker und ein Raster. Der Fangradius wird in **Pixeln** gerechnet und in Flicks
umgerechnet, nie umgekehrt — so bleibt er auf jeder Zoomstufe gleich groß auf dem Schirm. Eine
gedrückte Modifikatortaste während des Zugs setzt ihn aus.

### Zoom

Zoom ist Flicks pro Pixel. Die Untergrenze steigt mit der Projektlänge: das Inhaltselement ist so
breit wie das ganze Projekt, und Browser halten Elementbreiten oberhalb von rund 33 Millionen Pixeln
nicht mehr ein — darüber würde die Timeline still abgeschnitten statt zu scrollen. Weit genug
herausgezoomt werden Läufe zu dünner Clips zu einem Kasten zusammengefasst; das hält die Knotenzahl
an der Fensterbreite statt am Material.

## Der Inspector

Ein ausgewählter Clip öffnet seine Eigenschaften neben dem Bild. Jede Bedienung schickt ein Command;
der Inspector hält keinen eigenen Zustand.

| Gruppe | Was sie kann |
|---|---|
| Transformation | Position, Größe, Drehung, Deckkraft und **Ins Bild einpassen** |
| Ton und Tempo | Clip-Lautstärke, Geschwindigkeit und ein Rückwärts-Schalter |
| Übergang | eine Überblendung an der eingehenden Kante des Clips samt Dauer |
| Effekte | einen Effekt hinzufügen, danach eine Zeile je Parameter |

`clip.setTransform` trägt die ganze Struktur, also liest eine Zeile die aktuelle Transformation,
ersetzt ihr eigenes Feld und schickt sie zurück. Ankerpunkt und Beschnitt haben keine Zeile: beides
sind Bruchteile der Quelle, für die es nichts zum Anfassen auf dem Bild gibt — sie warten auf einen
Griff im Bild statt auf einen Schieber, den niemand zielen kann.

Für die Ton-Blenden gibt es keine Zeile. Das Modell trägt sie und der Tongraph spielt sie, aber kein
Command setzt sie — ein Schieber dort würde nichts schreiben.

### Keyframes

Eine Parameterzeile eines **Effekts** trägt einen Keyframe-Schalter, Pfeile zum vorherigen und
nächsten Keyframe und — wo einer unter dem Playhead sitzt — eine Auswahl für den Verlauf danach:
linear, halten oder weich. Der Schalter setzt am Playhead einen Keyframe oder löscht den dortigen.

Der Wert in der Zeile ist der, den `Effect::param_at` für diesen Zeitpunkt liefert, erfragt über
`doc.effectParamsAt`, nie eine eigene Rechnung. Eine Interpolation in TypeScript gäbe Vorschau und
Export zwei verschiedene Antworten auf dieselbe Frage.

Sobald ein Parameter gekeyframed ist, schreibt der Schieber Keyframes statt des statischen Werts,
und zwar am Playhead. `keyframe.add` ist ein Upsert, und genau das macht einen Zug zu einem
Undo-Schritt. Steht der Playhead außerhalb des Clips, sind die Keyframe-Bedienelemente gesperrt: ein
dort geschriebener Keyframe wird für diesen Clip nie ausgewertet, der Schalter würde also einen
Zustand melden, den kein Bild je zeigt.

**Den Schalter gibt es nur auf Effektparametern.** `Clip::keyframes` existiert im Modell, aber
niemand wertet es aus — die Zeichenliste liest `clip.transform` statisch. Ein Schalter auf
Transformation oder Lautstärke würde Daten schreiben, die kein Bild je zu sehen bekommt. Ihn dort
hinzustellen heißt, `clip.transform` durch dieselbe Auswertung zu schicken wie einen
Effektparameter, und das ist Arbeit im Kern und in der Engine, nicht in der Oberfläche.

## Wiedergabe

Der Transport bietet Anfang, Bild zurück, Abspielen/Pause, Bild vor, Ende und einen Timecode aus der
Bildrate des Projekts. <kbd>Leertaste</kbd> schaltet die Wiedergabe um, die Pfeiltasten springen
einzelne Bilder; beide lauschen am Fenster und funktionieren daher auch, wenn der Fokus in der
Timeline steht.

Der Ton führt und das Bild folgt, weil Audio-Drift hörbar ist und ein ausgelassenes Bild nicht.
Bildraten bleiben bis zur letzten Division rational — 30000/1001 ist nicht 29,97, und ein
Bildschritt aus der Dezimalzahl läuft schon nach wenigen hundert Bildern vom Lineal weg.

Browser starten einen `AudioContext` angehalten und lassen ihn erst nach einer Nutzergeste
fortsetzen; der erste Druck auf Abspielen tut deshalb etwas mehr als die folgenden.

## Speichern

**Speichern** schreibt eine `.videola`-Datei: ein ZIP mit einem Manifest, `project.json` und jedem
referenzierten Medium, benannt nach dem Hash seiner eigenen Bytes. **Öffnen** liest sie zurück. Die
Medien kommen aus OPFS, ein gespeichertes Projekt trägt sein Material also mit sich, statt auf Pfade
auf deinem Rechner zu zeigen.

## Was geprüft ist und was nicht

Der Compositor wird gegen echte Pixel in headless Chrome geprüft, Timeline und Inspector gegen
echtes Browser-Layout, und die Anwendung selbst gegen ein wirklich hineingezogenes Video — 182
Prüfungen in drei Harnessen, die ohne Playwright laufen.

Die Kette vom Keyframe zum Bild wird in der letzten davon durchgehend gemessen: Helligkeit kommt
über die Oberfläche auf den Clip, zwei Keyframes werden über die Oberfläche gesetzt, danach wird der
Zeichenpuffer an drei Zeitpunkten ausgelesen. Gegen dieselben drei Bilder ohne den Effekt kommt das
Bild am ersten Keyframe auf 0 zurück, in der Mitte auf die Hälfte und am zweiten Keyframe auf die
ursprüngliche Helligkeit — die Interpolation ist die des Kerns, die Pixel sind die des Compositors,
und beide Hälften laufen in einem Durchgang.

Nicht geprüft: Lippensynchronität, weil headless Chrome keine Tonausgabe hat; die dauerhafte
Bildrate bei 1080p; das Phone-Layout mit laufender Vorschau; und ein über den Inspector gesetzter
Übergang ist nie gezeichnet worden, weil eine Überblendung zwei überlappende Clips braucht und die
Harness eine Datei ablegt.
