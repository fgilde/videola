# Schneiden

Diese Seite beschreibt, was die Oberfläche heute kann. Was hier nicht steht, gibt es noch nicht —
es gibt keinen Export in der Anwendung.

![Der Editor mit einem dekodierten Bild in der Vorschau](/editor-desktop.webp)

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
| Klick auf einen Clip | wählt ihn aus, und die ganze Gruppe, wenn er in einer ist |
| Strg/Cmd- oder Umschalt-Klick | nimmt einen Clip in die Auswahl auf oder wieder heraus |
| Ziehen in der Clipmitte | verschiebt die ganze Auswahl, bei einem Clip auch über Spuren hinweg |
| Ziehen an einer Clipkante | trimmt diese Kante |
| Ziehen im Lineal | scrubbt |
| Zwei Zeiger | zoomen über die Abstandsänderung |
| Langes Drücken, rechte Maustaste | öffnet das Kontextmenü des Clips oder des Markers darunter |

Ein Druck innerhalb einer mehrteiligen Auswahl behält sie — sonst hätte der Druck, der den Zug
beginnt, gerade das weggeworfen, was er gleich bewegen soll. Loslassen ohne Zug engt auf den einen
Clip ein.

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

### Kanten- und Zugmodus

Zwei Listen in der Werkzeugleiste entscheiden, welches Kommando ein Zug schickt. Listen statt
Modifikatortasten, weil ein Finger keine Modifikatoren hat und weil der Modus **vor** dem Zug
lesbar sein muss, nicht aus dem erschlossen, was er gerade angerichtet hat.

| Kante ziehen | Was sich bewegt |
|---|---|
| **Trimmen** | diese Kante, sonst nichts |
| **Ripple** | diese Kante, und jeder spätere Clip derselben Spur um denselben Schritt |
| **Roll** | der Schnitt, den diese Kante mit dem Nachbarn teilt: das Paar behält seine Gesamtlänge |

| Clip ziehen | Was sich bewegt |
|---|---|
| **Verschieben** | der Clip, entlang der Spur und über Spuren hinweg |
| **Slip** | das Material hinter dem Clip; der Clip bleibt liegen und behält seine Länge |
| **Slide** | der Clip entlang der Spur, wobei die anliegenden Clips den Schritt aufnehmen |

Roll lehnt ab, wo kein Clip an dieser Kante liegt, und alle lehnen einen Schritt ab, der einen Clip
leeren oder vor dem Anfang des Materials lesen würde. Eine Ablehnung während eines Zugs ist
gewöhnlich: die Bearbeitung findet einfach nicht statt, und gemeldet wird dafür nichts.

Ein Ripple am **Kopf** sieht befremdlich aus, bis man ihn benutzt: der Clip bleibt liegen und sein
Material wandert, denn genau darum geht es beim Ripple — der Clip bleibt an dem kleben, was vor ihm
liegt. Was der Zeiger dort ändert, ist die Länge, nicht die Position.

### Löschen, ausschneiden, einfügen

| Taste | Wirkung |
|---|---|
| <kbd>Entf</kbd> | entfernt die Auswahl und lässt die Lücke stehen |
| <kbd>Umschalt</kbd>+<kbd>Entf</kbd> | entfernt sie und schließt die Lücke: jeder spätere Clip der Spur rückt auf |
| <kbd>Strg</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd> | kopieren, ausschneiden, am Playhead einfügen |
| <kbd>Strg</kbd>+<kbd>G</kbd> / <kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>G</kbd> | gruppieren, Gruppierung aufheben |
| <kbd>N</kbd> | fasst die Auswahl zu einem Compound-Clip zusammen |
| <kbd>M</kbd> | setzt einen Marker am Playhead |

Alles steht auch im Kontextmenü des Clips, und ein Eintrag, der nichts bewirken kann — Einfügen
ohne Zwischenablage, Gruppieren mit einem einzigen Clip — ist deaktiviert, statt ein Kommando zu
schicken, das der Kern ablehnen würde.

Ripple-Delete bewegt nur, was am Ende des gelöschten Clips oder danach beginnt. Ein Clip, der über
dieses Ende hinwegreicht, bleibt liegen: das Schließen einer Lücke darf keine Überlappung erzeugen,
die niemand gebaut hat.

Die Zwischenablage hält ganze Clips, keine Verweise — Geschwindigkeit, Transformation, Effekte,
Keyframes und der Materialversatz reisen mit. Ein Einfügen setzt den frühesten auf den Playhead und
behält die Abstände der übrigen, auf der Spur, von der jeder kam, sofern es sie noch gibt. Die Ids
vergibt der Kern, ein zweimal eingefügter Clip ist also zweimal ein Clip und nicht einmal ein Clip
mit zwei Erwähnungen.

Gruppierte Clips werden zusammen ausgewählt und zusammen gezogen, und eine Gruppe überlebt alles
außer **Gruppierung aufheben**. Eine eingefügte Kopie tritt keiner Gruppe bei: sie trägt Material
und Aussehen des Originals, nicht seine Mitgliedschaft.

### Verschachteln

**Verschachteln** oder <kbd>N</kbd> faltet die ausgewählten Clips zu einem einzigen *Compound*-Clip.
Der Compound überdeckt die Spanne, die sie eingenommen haben, und landet auf der untersten Spur, auf
der einer von ihnen lag; drinnen behalten sie ihre Lage zueinander und je eine verschachtelte Spur
pro Spur, von der sie kamen — Spur eins ist dort unten im Stapel, genau wie hier draußen.

Das Zusammenfassen ändert nichts am Bild und nichts am Ton. Zwei Clips verschachteln und das Ergebnis
abspielen gibt genau die Frames und die Samples zurück, die die beiden vorher gaben; die Pixel- und
Tonprüfungen vergleichen gegen die Ausgabe *vor* dem Zusammenfassen.

Von da an ist der Compound ein gewöhnlicher Clip: verschieben, trimmen, Geschwindigkeit geben, einen
Effekt darauflegen. Ihn zu trimmen schneidet, was drinnen liegt — sein In-Punkt und seine Dauer
entscheiden, wie viel der verschachtelten Zeitachse er verbraucht — und eine Geschwindigkeit auf ihm
retimt alles darin, rückwärts eingeschlossen. Acht Ebenen tief darf verschachtelt werden; eine neunte
wird abgelehnt, statt gespeichert und dann still nicht gezeichnet zu werden.

Vier Dinge kann ein Compound noch nicht, weil alle vier die verschachtelte Zeitachse zuerst auf eine
eigene Fläche gezeichnet brauchen: seine Deckkraft wirkt auf jeden Clip darin statt auf das fertige
Bild (sichtbar nur dort, wo zwei sich überlappen), seine Effekte laufen einmal pro verschachteltem
Clip statt einmal über die Gruppe, sein Blendmodus erreicht nur Clips ohne eigenen, und ein Zuschnitt
auf ihm wird ignoriert. Ein Übergang auf einem Compound wird rundheraus abgelehnt — er würde das Bild
darunter einmal pro verschachteltem Clip mitmischen, und eine Blende, die still das Falsche tut, ist
schlimmer als eine, die sich nicht anlegen lässt.

Ein **Auflösen** gibt es nicht: <kbd>Strg</kbd>+<kbd>Z</kbd> nimmt das Zusammenfassen zurück, und ein
aus einer Datei wieder geöffneter Compound bleibt einer.

### Marker

**Marker setzen** in der Werkzeugleiste oder <kbd>M</kbd> setzt einen am Playhead. Ein Klick auf
einen Marker springt mit dem Playhead dorthin; sein eigenes Kontextmenü löscht ihn. Marker sind
Fangkandidaten, und dafür sind sie vor allem da — `marker.rename` gibt es als Kommando für die API
und den MCP-Server, ein Textfeld dafür hat die Oberfläche noch nicht.

### Zur magnetischen Timeline

Videola hat keinen magnetischen Modus, und das ist eine Entscheidung und keine Lücke. Die nützliche
Hälfte davon — die Lücke schließen, die eine Bearbeitung hinterlässt — liegt bereits als
**Ripple-Delete** und **Ripple-Trim** vor, pro Bearbeitung und pro Spur, wo man sieht, was sich
bewegt hat. Die andere Hälfte ist eine andere Überlappungsregel für das ganze Modell: in einer
magnetischen Timeline können Clips sich nicht überlappen, also schiebt jede Bewegung ihre Nachbarn,
und ein Übergang braucht einen Platz, den das Modell reserviert, statt einer Überlappung, die der
Autor baut. Videolas Modell erlaubt Überlappung mit Absicht — daraus bestehen ein Übergang, ein Bild
im Bild und eine Blende —, und das zu ändern hieße zu ändern, was jedes bestehende Projekt bedeutet.
Wenn es je kommt, dann als Modus, den man einschaltet, und nicht als Regel, die unter einem
aufgetaucht ist.

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

**Die Transformation lässt sich ebenfalls keyframen, der Inspector bietet es nur noch nicht an.**
Der Kern löst `Clip::keyframes` auf, und die Zeichenliste platziert das Bild aus dem aufgelösten
Wert — der Schalter schriebe also Daten, die ein Bild wirklich zeigt. Es fehlt die Oberfläche: eine
Zeile je Transformationsfeld mit demselben Schalter, den eine Effektparameterzeile trägt. Die
Lautstärke bleibt unanimiert, dort fehlt tatsächlich noch die Auswertung.

## Geschwindigkeitsrampen

Die Geschwindigkeit eines Clips ist keine einzelne Zahl mehr. `Speed { rate, reverse }` ist weiterhin
das, was ein Clip laeuft, solange nichts animiert ist — aber ein Clip kann eine **Ratenspur** tragen:
Keyframes unter dem Schluessel `speed`, im selben Faktor, den `rate` verwendet. Dann ist die
Geschwindigkeit eine Kurve ueber die Zeit.

Das aendert die Arithmetik darunter, statt eine Funktion danebenzustellen. Wo die Abbildung von
Projektzeit auf Quellzeit frueher

```
Quelle = in_point + (t - start) * rate
```

war, ist sie jetzt die **Flaeche unter der Geschwindigkeitskurve**:

```
Quelle = in_point + ∫ von start bis t ueber rate(u) du
```

Ein Clip, der in zwei Sekunden von halber auf doppelte Geschwindigkeit laeuft, hat nach einer Sekunde
0,875 s seines Materials verbraucht, nicht 1,25 s. Jede proportionale Lesart dieses Moments — die Rate
im Augenblick, die mittlere Rate, die statische Rate — gibt eine andere Antwort, und alle sind falsch.

`Clip::consumed_source()` ist bewusst dasselbe Integral, nur fuer den ganzen Clip gefragt: die Summe
und jeder Anfang davon kommen aus einer Funktion und koennen deshalb nicht auseinanderlaufen. Ein
rueckwaerts laufender Clip liest `in_point + consumed − Flaeche`, und sobald diese beiden getrennt
gerechnet wuerden, faellt sein erstes Bild aus dem Bereich heraus, den ein Dekoder lesen darf.

**Der Ton folgt derselben Kurve, nicht einer Kopie davon.** Ein `AudioBufferSourceNode` liest seinen
Puffer am laufenden Integral von `playbackRate` — genau diesem Integral. Der Audiograph uebergibt der
Plattform die Ratenkurve als Automation. Bild und Ton sind also nicht zwei Umsetzungen, die sich einig
werden muessen, sondern eine Abbildung, zweimal gerechnet von zwei Maschinen, die beide integrieren
koennen.

### Was ein Ratenkeyframe sein darf

| | |
|---|---|
| Wert | eine Zahl von 0 bis 100 |
| Interpolation | `linear`, `hold` oder `ease` |
| Null | erlaubt, und sie bedeutet ein Standbild |
| `bezier` | abgelehnt |
| Auf einem Verbundclip | abgelehnt |
| Auf einem Clip, den man danach verschachtelt | abgelehnt |

`bezier` wird abgelehnt, weil seine Zeitverzerrung in der Spurzeit keine elementare Stammfunktion hat
und eine ungenaue Flaeche die eine Eigenschaft braeche, auf der alles ruht: dass die Flaeche ueber
einer Spanne die Summe der Flaechen ueber ihren Teilen ist. Verbundclips werden in beide Richtungen
abgelehnt, weil das Ein- und Ausfalten einer verschachtelten Timeline die aeussere Rate durch Division
umkehrt — und das geht nur, solange diese Rate eine Zahl ist. Also: Rampe aufloesen, oder erst
verschachteln und dann rampen.

`Project::normalize()` lehnt das alles beim Laden ab, und die `keyframe.*`-Befehle lehnen dieselben
Formen durch dieselbe Funktion ab. Eine Rampe, die der eine Weg annimmt, ist also nie eine, die der
andere nicht mehr oeffnet.

## Voreinstellungen

Eine Voreinstellung ist eine Liste von Befehlen unter einem gemeinsamen Sammelschluessel. Sie ist kein
eigenes Ding in der Projektdatei, und das ist der Punkt: `Dispatch.coalesceKey` fasst eine Liste
bereits zu einem Rueckgaengig-Schritt zusammen, Patch und Umkehrung kommen bereits aus
`json_patch::diff`, die Befehlsschicht lehnt bereits jedes Feld ab, das eine Voreinstellung sonst
selbst pruefen muesste, und `POST /api/projects/:id/commands` traegt bereits eine Liste unter einem
Schluessel. Eine Voreinstellung im Modell braeuchte eine eigene Ladeschranke, ein eigenes Rueckgaengig
und ein eigenes Drahtformat — und waere eine zweite Instanz, die entscheidet, was ein viertelgrosses
Bild in der Ecke heisst. Eine, der die Befehle dann widersprechen koennten.

Jede Voreinstellung unten ist also fuer einen Agenten erreichbar, indem er dieselben Befehle schickt.
Die Bauteile liegen in `packages/core/src/presets.ts`.

| Voreinstellung | Was sie schickt |
|---|---|
| Standbild ab hier | zwei Schluessel auf der Ratenspur: die eigene Rate, gehalten, dann null |
| Langsamer Anfang / Ende / Mitte | zwei oder drei weiche Schluessel auf der Ratenspur |
| Ken-Burns-Fahrt hinein / heraus | je zwei Schluessel auf `scaleX` und `scaleY`, dazu ein Bewegungspfad aus zwei Punkten |
| Bild im Bild | ein `clip.setTransform`, dazu ein `clip.move`, wenn eine Spur darueber liegt |
| Geteilter Bildschirm | ein `clip.setTransform` je Clip, jeder auf seine Haelfte beschnitten |

**Standbild ab hier** ist eine Rate von null und sonst nichts — kein Standbildclip, keine zweite
Quellenart, kein Zweig irgendwo dahinter. Das Bild, auf dem es stehenbleibt, ist das, welches der
Abspielkopf gerade zeigte, und der Ton bleibt ueber dieselbe Spur mit stehen. Auf einem rueckwaerts
laufenden Clip wird es abgelehnt: rueckwaerts liest ein Clip `in_point + consumed − Flaeche`, eine
Rate von null verkuerzt also `consumed` und verschiebt das Bild, an dem der Clip *verankert* ist,
statt jenes, auf dem er stehenbleibt. Der Knopf ist ausgegraut statt falsch.

**Ken Burns** beginnt bei der Skalierung, bei der das Material das Bildformat gerade fuellt — so
oeffnen sich an keinem Ende der Fahrt die Ecken auf den Hintergrund.

**Geteilter Bildschirm** beschneidet jeden Clip auf die Haelfte, in der er steht, statt ihn zu
stauchen; beide behalten damit ihre Proportionen.

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

![Die Medienbibliothek auf einem Telefon, die Vorschau bleibt darüber stehen](/editor-phone-library.webp)

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

![Der Editor auf einem Tablet, zwei Medien auf zwei Spuren](/editor-tablet.webp)

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

### Die gesicherte Sitzung

Alle dreißig Sekunden schreibt der Editor den Projektzustand von sich aus in den Browserspeicher.
Keine `.videola`: ein Schnappschuss jede halbe Minute, der jedes Medium einsammelt, hasht und zippt,
wären Gigabytes an Kopiererei, um sich zu merken, wo ein Clip sitzt. Die Medien liegen ohnehin unter
ihrem Inhaltshash in OPFS, und von dort lesen Renderer, Dekoder und Export sie — ein Schnappschuss,
der sie benennt, ist einer, der sich wiederherstellen lässt.

Wer den Editor nach einem Absturz öffnet, bekommt ein Band mit dem Zeitpunkt des Schnappschusses.
Angeboten, nicht genommen: über einen absichtlich geöffneten Tab wiederherzustellen ist dieselbe
Überraschung wie der Verlust der Arbeit, von der anderen Seite gesehen. **Verwerfen** räumt ihn weg.

Ein leeres Projekt wird nie geschrieben, ein frischer Tab kann den Stand, den er gerade anbietet,
also nicht überschreiben. Ein Schnappschuss, der beim Absturz halb geschrieben war, gilt als keiner,
und einer, dessen Projekt der Lader ablehnen würde, wird auch auf dem Rückweg abgelehnt — eine
Sicherung, um die niemand gebeten hat, darf nicht der Grund sein, dass der Editor nicht startet. Ein
Schnappschuss, dessen Medien inzwischen aus OPFS verschwunden sind, kommt mit demselben Band über
fehlende Medien zurück wie eine geöffnete Datei.

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
