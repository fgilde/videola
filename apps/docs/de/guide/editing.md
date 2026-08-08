# Schneiden

Diese Seite beschreibt, was die Oberfläche heute kann. Was hier nicht steht, gibt es noch nicht —
es gibt keine Effekte, keine Keyframes, keinen Inspector und keinen Export in der Anwendung.

![Der Editor mit einem dekodierten Bild in der Vorschau](/editor-preview.png)

## Medien hineinbekommen

Zwei Wege, die dasselbe tun:

- Eine oder mehrere Dateien irgendwo auf das Fenster ziehen.
- **Medien importieren** in der Kopfzeile drücken.

Die Bytes werden mit SHA-256 gehasht und unter diesem Hash nach OPFS geschrieben, **bevor**
irgendein Command abgeschickt wird — ein Medium liegt also auf der Platte, bevor das Projekt sich
darauf bezieht. Dieselbe Datei zweimal importiert wird einmal gespeichert. Der Clip landet auf der
ersten Videospur; hat das Projekt keine, wird eine angelegt.

Ein unberührtes Projekt übernimmt das Format seines ersten Mediums, weil M1 kein Command hat, das
eine Clip-Transformation setzt — ein 640×360-Clip säße sonst als kleines Rechteck in der Ecke eines
1080p-Bildes.

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
Coalesce-Key, den `pointerdown` setzt und `pointerup` wegfallen lässt.

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
Leiste darunter wechselt zwischen **Medien** und **Zeitleiste**. Das Bild muss sichtbar bleiben,
während man darunter arbeitet, und 390 px tragen Bibliothek, Vorschau und Timeline nicht
nebeneinander, ohne dass alle drei unbrauchbar werden.

Zwei Bereiche, nicht die sechs aus dem Entwurf. Effekte, Text, Ton und Export haben noch keine
Fläche; ein Reiter, der nichts öffnet, ist schlimmer als ein Reiter, den es nicht gibt — jeder
kommt an dem Tag dazu, an dem seine Fläche kommt.

Der Bereich, der gerade nicht dran ist, wird ausgehängt statt versteckt. Die Timeline fenstert ihre
Clips nach der Breite, die sie misst, und ein `display: none`-Behälter misst null — sie käme leer
zurück.

Sonst ändert sich nichts. Derselbe Pointer-Events-Pfad trägt Maus, Stift und Finger, die
Trefferflächen waren schon 44 px, und alles, was am Schreibtisch erreichbar ist, ist es auch hier.

## Speichern

**Speichern** schreibt eine `.videola`-Datei: ein ZIP mit einem Manifest, `project.json` und jedem
referenzierten Medium, benannt nach dem Hash seiner eigenen Bytes. **Öffnen** liest sie zurück. Die
Medien kommen aus OPFS, ein gespeichertes Projekt trägt sein Material also mit sich, statt auf Pfade
auf deinem Rechner zu zeigen.

## Was geprüft ist und was nicht

Der Compositor wird gegen echte Pixel in headless Chrome geprüft, die Timeline gegen echtes
Browser-Layout, und die Anwendung selbst gegen ein wirklich hineingezogenes Video — 173 Prüfungen in
drei Harnessen, die ohne Playwright laufen.

Das Phone-Layout wird auf einem echten 390×844-Viewport bei doppelter Pixeldichte gefahren, über das
Devtools-Protokoll: Chrome unter Windows verweigert ein Fenster schmaler als 500 CSS-Pixel, mit
`--window-size` allein hätte man also ein kleines Tablet vermessen und Telefon dazu gesagt. Import,
ein Fingerzug, Rückgängig, beide Bereiche und die Wiedergabe werden dort geprüft, und die
Schirmbilder oben stammen aus diesem Lauf.

Nicht geprüft: Lippensynchronität, weil headless Chrome keine Tonausgabe hat; die dauerhafte
Bildrate bei 1080p; und das Zurücklesen der Pixel in Telefongröße — der Zeichenpuffer ist fort,
sobald die Seite ihn komponiert hat, und der Telefonlauf braucht die Wanduhr, damit sein Layout
verlässlich ist. Der Screenshot ist der Beleg, dass die Vorschau auch dort dekodiert.
