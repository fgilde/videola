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

## Die Medienbibliothek

Alles, was im Projekt liegt, mit Länge, Maßen in Pixeln und Abtastrate. **Auf die Zeitleiste** setzt
ein Medium hinter das, was auf der ersten Spur seiner Art schon liegt — dieselbe Stelle, an der ein
Import landet. Ein Medium lässt sich so beliebig oft platzieren, ohne es erneut zu importieren.

Es gibt keine Vorschaubilder und keine Waveform. `packages/media` rechnet weder das eine noch das
andere, und ein graues Rechteck an der Stelle eines Bildes wäre ein Versprechen, das die Anwendung
nicht halten kann.

### Wenn die Bytes fehlen

Medien liegen in OPFS, und das gehört dem Browser und der Herkunft, nicht der Projektdatei. Ein
Projekt auf einem anderen Rechner geöffnet — oder in einem anderen Browser — hat seine
Bibliothekseinträge, aber nicht ihre Bytes. So ein Eintrag ist mit **Daten fehlen** markiert, lässt
sich nicht auf die Zeitleiste setzen und bietet **Neu verknüpfen** an.

Das Neuverknüpfen fragt nach der Datei und prüft sie: die Kennung eines Mediums **ist** der
SHA-256 seines Inhalts, also wird nur dieselbe Datei angenommen. Eine andere wäre ein anderes
Medium unter dem Namen dieses einen, und jeder Clip, der darauf zeigt, zeigte still das falsche
Bild.

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

## Auf dem Telefon

![Die Medienbibliothek auf einem Telefon, die Vorschau bleibt darüber stehen](/phone-library.png)

Unter 768 px wechselt der Editor in eine Spalte: Vorschau und Transport bleiben oben stehen, eine
Leiste darunter wechselt zwischen **Medien**, **Zeitleiste** und **Eigenschaften**. Das Bild muss
sichtbar bleiben, während man darunter arbeitet, und 390 px tragen Bibliothek, Vorschau und Timeline
nicht nebeneinander, ohne dass alle drei unbrauchbar werden.

Drei Bereiche, nicht die sechs aus dem Entwurf. Text, Ton und Export haben noch keine eigene Fläche;
ein Reiter, der nichts öffnet, ist schlimmer als ein Reiter, den es nicht gibt — jeder kommt an dem
Tag dazu, an dem seine Fläche kommt. **Eigenschaften** ist der dritte, weil dort Effekte, Keyframes,
Übergänge und Tempo liegen: als Streifen zwischen Transport und Reiterleiste hatte der Bereich ein
Drittel des Schirms und konnte trotzdem keinen einzigen Effekt zeigen, was das Telefon zum Betrachter
statt zum Werkzeug machte.

Der Bereich, der gerade nicht dran ist, wird ausgehängt statt versteckt. Die Timeline fenstert ihre
Clips nach der Breite, die sie misst, und ein `display: none`-Behälter misst null — sie käme leer
zurück.

Derselbe Pointer-Events-Pfad trägt Maus, Stift und Finger, die Trefferflächen sind 44 px.

### Die Kopfzeile

Die Kopfzeile trägt zehn Bedienelemente, und die passen bei 44 px nicht auf 390 px. Die
Projektaktionen — neu, Vorlage, öffnen, importieren, Spur hinzufügen — liegen hinter dem **☰** links,
auf dem Telefon zusätzlich Export, Speichern sowie Sprach- und Themenumschalter. Auf der Leiste
bleiben Rückgängig und Wiederholen, die beiden, nach denen ein Daumen ständig greift.

Es ist ein `<details>`-Element statt eines selbstgebauten Menüs: Offen-Zustand, Tastaturbedienung und
zugänglicher Name kommen mit.

Vorher scrollte die Leiste einfach seitwärts. Jeder Knopf blieb im Grundsatz erreichbar, und im
Ruhezustand stand die Hälfte davon außerhalb des Fensters — „Medien importie…“ am rechten Rand
abgeschnitten. Kein Test sah das, weil kein Test fragte, ob die Leiste ins Fenster passt. Jetzt tut
es einer: bei 390 px muss ihre `scrollWidth` gleich ihrer `clientWidth` sein.

### Kamera und Galerie

Auf Telefon und Tablet bietet die Bibliothek neben **Medien importieren** auch **Aufnehmen** und
**Aus der Galerie**. Beides sind gewöhnliche `<input type="file" accept="video/*">`; das erste trägt
zusätzlich `capture="environment"`, und genau das fragt ein Telefon nach seiner rückwärtigen Kamera
statt nach seinem Dateisystem.

Dieses Attribut ist das ganze Feature, und so weit reicht auch der Nachweis: ein headless Browser hat
weder Kamera noch Galerie. Die Harness prüft, dass das Feld da ist, mit dem richtigen `accept` und
`capture`, und dass es eine 44-px-Fläche ist. Was ein echtes Telefon daraus macht, ist nicht
beobachtet.

## Auf dem Tablet

![Der Editor auf einem Tablet, zwei Medien auf zwei Spuren](/tablet.png)

Zwischen 768 px und 1280 px — und auf allem ohne feinen Zeiger, gleich welcher Breite — legt der
Editor sich in zwei Spalten: die Medienbibliothek links, Bild, Transport und Eigenschaften
übereinander rechts, die Zeitleiste über die ganze Breite unten.

Zwei Spalten statt der drei vom Schreibtisch, weil ein Tablet im Hochformat knapp an Breite und
reichlich an Höhe ist. Bei 834 px ließen drei Flächen nebeneinander der mittleren rund 330 px —
schmaler als der Transport selbst, und die Zeitanzeige brach mitten in der Ziffer ab.

Bibliothek und Zeitleiste sind gleichzeitig sichtbar, und das ist der Sinn des Modus: nur so lässt
sich **ein Medium aus der Bibliothek auf eine Spur ziehen**, was das Telefon nicht anbieten kann,
weil beide dort nie zusammen zu sehen sind. Eintrag drücken, über die Zeitleiste führen — die
Zielspur leuchtet auf und eine Linie zeigt, wo der Clip beginnen würde — und loslassen. Ein Kommando,
also ein Undo-Schritt. Der Knopf **Auf die Zeitleiste** bleibt daneben bestehen: ein Zug ist nicht
mit der Tastatur bedienbar und wäre sonst der einzige Weg auf die Zeitleiste.

## Speichern

**Speichern** schreibt eine `.videola`-Datei: ein ZIP mit einem Manifest, `project.json` und jedem
referenzierten Medium, benannt nach dem Hash seiner eigenen Bytes. **Öffnen** liest sie zurück. Die
Medien kommen aus OPFS, ein gespeichertes Projekt trägt sein Material also mit sich, statt auf Pfade
auf deinem Rechner zu zeigen.

## Was geprüft ist und was nicht

Der Compositor wird gegen echte Pixel in headless Chrome geprüft, Timeline und Inspector gegen
echtes Browser-Layout, die Anwendung selbst gegen ein wirklich hineingezogenes Video und der Export
gegen ffprobe und ffmpeg — vier Harnessen, die ohne Playwright laufen.

Die Kette vom Keyframe zum Bild wird in der letzten davon durchgehend gemessen: Helligkeit kommt
über die Oberfläche auf den Clip, zwei Keyframes werden über die Oberfläche gesetzt, danach wird der
Zeichenpuffer an drei Zeitpunkten ausgelesen. Gegen dieselben drei Bilder ohne den Effekt kommt das
Bild am ersten Keyframe auf 0 zurück, in der Mitte auf die Hälfte und am zweiten Keyframe auf die
ursprüngliche Helligkeit — die Interpolation ist die des Kerns, die Pixel sind die des Compositors,
und beide Hälften laufen in einem Durchgang.

Das Phone-Layout wird auf einem echten 390×844-Viewport bei doppelter Pixeldichte gefahren, das
Tablet auf 834×1112, beides über das Devtools-Protokoll mit eingeschalteter Berührung: Chrome unter
Windows verweigert ein Fenster schmaler als 500 CSS-Pixel und beschneidet das Schirmbild, statt es zu
skalieren — mit `--window-size` allein hätte man also ein kleines Tablet vermessen und Telefon dazu
gesagt. Auf dem Telefon werden Import, ein Fingerzug, Rückgängig, jeder Reiter, ein auf einen Clip
gelegter Effekt und die Wiedergabe geprüft; auf dem Tablet zwei Medien auf zwei Spuren, der Zug aus
der Bibliothek auf eine Spur, und dass Bild, Transport und Flächen jeweils eine Box im Fenster
bekommen. Die Schirmbilder oben stammen aus diesen Läufen.

Vorschaubilder werden als Bilder geprüft, nicht als Elemente: das `<img>` muss eine `naturalWidth`
ungleich null bei 160×90 melden, die beiden Medien im Tablet-Lauf müssen sich voneinander
unterscheiden, und ein Standbild darf keine einzelne Fläche einer Farbe sein — ein Platzhalter, ein
schwarzes Bild und ein fehlgeschlagenes Dekodieren fallen daran alle durch.

Nicht geprüft: Lippensynchronität, weil headless Chrome keine Tonausgabe hat; die dauerhafte
Bildrate bei 1080p; was eine echte Kamera oder Galerie mit `capture` tut, weil ein headless Browser
beides nicht hat; das Zurücklesen der Pixel in Telefongröße — der Zeichenpuffer ist fort, sobald die
Seite ihn komponiert hat, und der Telefonlauf braucht die Wanduhr, damit sein Layout verlässlich ist,
der Screenshot ist also der Beleg, dass die Vorschau auch dort dekodiert; und ein über den Inspector
gesetzter Übergang ist nie gezeichnet worden, weil eine Überblendung zwei überlappende Clips über
demselben Schnitt braucht.
