# Schneiden

Diese Seite beschreibt, was die Oberfläche heute kann. Was hier nicht steht, gibt es noch nicht.

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

Jeder Eintrag trägt ein Vorschaubild, das aus der Datei selbst dekodiert wurde, und Tonclips zeichnen
ihre Waveform aus den Puffern, die der Graph ohnehin dekodiert hat — kein zweites Dekodieren, und ein
rückwärts laufender Clip zeigt sich so, wie er klingt.

### Wenn die Bytes fehlen

Medien liegen in OPFS, und das gehört dem Browser und der Herkunft, nicht der Projektdatei. Ein
Projekt auf einem anderen Rechner geöffnet — oder in einem anderen Browser — hat seine
Bibliothekseinträge, aber nicht ihre Bytes. So ein Eintrag ist mit **Daten fehlen** markiert, lässt
sich nicht auf die Zeitleiste setzen und bietet **Neu verknüpfen** an.

Das Neuverknüpfen fragt nach der Datei und prüft sie: die Kennung eines Mediums **ist** der
SHA-256 seines Inhalts, also wird nur dieselbe Datei angenommen. Eine andere wäre ein anderes
Medium unter dem Namen dieses einen, und jeder Clip, der darauf zeigt, zeigte still das falsche
Bild.

### Proxies

Material, das höher als 720 Pixel ist, wird einmal in einem eigenen Worker in eine kleinere Kopie
umgewandelt, die die Vorschau statt des Originals dekodiert. Der Eintrag sagt **Proxy wird erzeugt**,
solange das läuft, und danach **Proxy**. Immer nur ein Medium auf einmal: drei gleichzeitig
bräuchten dreimal so lange bis zum ersten, und auf das erste wartet jemand.

Die Kopie ist 720 Pixel hoch, H.264, mit einem Keyframe pro Sekunde, und trägt keinen Ton. Jede
dieser Zahlen hat einen Grund und ist keine Einstellung:

| Entscheidung | Warum |
|---|---|
| 720 Pixel hoch | Ein dekodiertes Bild kostet Breite × Höhe × 4 Bytes, ganz gleich, worauf die Datei komprimiert war. Der 256-MiB-Bildpuffer hält 8 Bilder in 4K, 32 in 1080p und 72 in 720p — ein Schritt zurück findet das Bild also im Speicher, statt eine ganze Bildgruppe erneut zu dekodieren. |
| H.264 | Der eine Codec, den jede Maschine, auf der ein Browser läuft, in Hardware dekodiert. Eine Maschine, die ihn nicht *kodieren* kann, bekommt schlicht keinen Proxy. |
| Ein Keyframe pro Sekunde | Die Wiedergabe setzt am Keyframe vor dem gefragten Augenblick neu an. Eine Kameradatei mit 250 Bildern zwischen zwei Keyframes kostet 250 Dekodierungen für einen Schritt zurück; das hier kostet höchstens eine Sekunde davon, was auch immer die Kamera getan hat. |
| Keine Tonspur | Der Ton kommt immer aus dem Original, Ton zu dekodieren war nie das Teure, und ohne ihn ist der Proxy schneller erzeugt und kleiner. |

Bildrate und Länge bleiben bewusst unangetastet. Ein Proxy auf einer anderen Zeitachse würde jede
Quellzeit, die die Zeitleiste ausgibt, auf das falsche Bild legen.

**Der Export liest nie einen Proxy.** Ein Standbild auch nicht, und nichts anderes, was eine Datei
erzeugt: geschrieben wird, was aus dem Original in voller Auflösung dekodiert wurde, ganz gleich,
was beim Schneiden auf dem Schirm stand. Das wird an einer echt geschriebenen Datei mit `ffprobe`
und `ffmpeg` geprüft, während ein absichtlich falscher Proxy auf der Platte liegt.

Ein Proxy liegt in OPFS neben dem Original, unter dessen eigenem Inhalts-Hash, und kommt nie in die
Bibliothek: er hat keine Medienkennung, wird nie in eine `.videola` geschrieben und lässt sich nicht
neu verknüpfen. Ein Medium, dessen Proxy fehlt, verhält sich genau wie eines, das nie einen hatte —
das Original wird dekodiert, und nur die Geschwindigkeit ist weg.

**Originale benutzen** in der Werkzeugleiste der Bibliothek schaltet die Vorschau zurück auf das
Material. Der Schalter ändert, was dekodiert wird, nicht, was angezeigt wird: jeder offene Dekoder
wird geschlossen und auf der Datei wieder geöffnet, die der Schalter jetzt nennt.

## In- und Out-Punkte

Der klassische Schnitt hat drei Punkte: wo das Material anfängt, wo es aufhört, und wo auf der
Zeitleiste es hin soll. Die **Schere** neben einem Bibliothekseintrag rüstet dieses Medium und
öffnet die **Quellzeile** unter dem Transport.

| Taste | Wirkung |
|---|---|
| <kbd>I</kbd> | setzt den In-Punkt an die Stelle in der Quelle |
| <kbd>O</kbd> | setzt dort den Out-Punkt |
| <kbd>,</kbd> | fügt den markierten Bereich am Playhead ein |
| <kbd>.</kbd> | schreibt ihn am Playhead darüber |

Die vier Tasten lauschen am Fenster wie die des Transports und wirken daher auch, wenn der Fokus in
der Zeitleiste steht. Zu allen vieren gibt es Schaltflächen: ein Finger hat keine Tastatur, und ein
mit der Scrubleiste markierter und mit zwei Knöpfen gesetzter Bereich ist derselbe Schnitt.

Nichts markiert heißt das ganze Medium — das ist ein Clip, den noch niemand getrimmt hat. Ein
Out-Punkt auf oder vor dem In-Punkt ist kein Bereich, und dann sind beide Knöpfe abgeschaltet: die
Oberfläche sieht das selbst und schickt kein Kommando, das der Kern ablehnen und das Banner melden
müsste.

Der Bereich landet auf der Spur, auf der der gewählte Clip liegt. Ist nichts gewählt, landet er auf
der ersten Spur, auf die das Material gehört — dieselbe Regel, der ein Import schon folgt —, und gibt
es keine solche Spur, wird eine angelegt. Der Playhead rückt ans Ende des Gesetzten, damit eine Folge
von Schnitten sich aneinanderreiht, statt jede Aufnahme über die vorige zu legen.

Die Quellzeile hat kein Bild. Eine Quelle zu scrubben braucht einen Dekoder je Stelle und einen
zweiten Compositor neben dem, der die Zeitleiste zeichnet — das ist ein Monitor und kein
Bedienelement. Was hier steht, ist der Timecode, und das Vorschaubild der Bibliothek sagt, zu
welchem Medium er gehört.

### Was Einfügen und Überschreiben jeweils versprechen

**Einfügen** öffnet am Playhead eine Lücke in der Länge des Bereichs und schiebt alles ab dort um
genau so viel nach hinten — auf **jeder** Spur, nicht nur auf der bearbeiteten. Das ist das eine, was
ein Einfügen niemals falsch machen darf: Ton und Bild liegen auf getrennten Spuren, und eine Lücke,
die sich nur auf einer von beiden öffnet, bringt die Zeitleiste ab dort für den Rest des Films aus
dem Takt. Ein Clip, der über die Einfügestelle reicht, wird vorher zweigeteilt, und die hintere
Hälfte liest dort weiter, wo die vordere aufgehört hat — nimmt man das Material wieder heraus, bleibt
ein Schnitt, den niemand sieht. Gruppen wandern ganz, auch über Spuren hinweg.

**Überschreiben** setzt den Bereich an den Playhead und lässt ihn ersetzen, was diese Spanne
belegte — auf der einen genannten Spur. Nichts verschiebt sich, die Zeitleiste behält also ihre
Länge, sofern das Material nicht über das alte Ende hinausreicht. Ein Clip, in den die Spanne ganz
hineinfällt, bleibt als Kopf und als Schwanz stehen; ein Clip, den sie nur anschneidet, wird auf die
Kante zurückgenommen; ein Clip, den sie ganz bedeckt, ist weg — und sein Übergang geht mit: eine
Blende gehört zu der Kante, auf der sie gebaut wurde, und die gibt es nicht mehr.

Beides ist **ein** Command und damit je ein Schritt auf dem Undo-Stapel, wie viele Clips sich auch
bewegt haben. Ein Einfügen über drei Spuren und ein Dutzend Clips ist ein einziges
<kbd>Strg</kbd>+<kbd>Z</kbd>.

Eines tun sie nicht: Marker rippeln nicht mit. Sie behalten ihre absoluten Positionen.

Eine gesperrte Spur weist beide rundheraus ab, gleich welche Spur genannt wurde. Ein Einfügen öffnet
die Lücke auf **jeder** Spur; die gesperrte auszulassen hieße, das Bild unter seinem eigenen Ton
wegzuziehen — genau das, was diese Operation verhindern soll. Die ehrliche Antwort ist die
Ablehnung: Spur entsperren und schneiden, oder sie in Ruhe lassen.

## Attribute einfügen

Einen Clip kopieren, andere auswählen, **Attribute einfügen**: der Blick des ersten liegt auf allen
anderen — Geometrie (Position, Skalierung, Drehung, Anker, Deckkraft und Zuschnitt, mit den Keys, die
davon etwas animieren), die Effektkette mit ihren Parametern und Keys, sowie Lautstärke und
Geschwindigkeitsrampe.

Vorbild ist der Clip in der Zwischenablage, den das Kopieren dort schon abgelegt hat. Ein zweiter
Speicher für „der Clip, dessen Blick ich will" wäre eine zweite Sache, die mit der ersten Schritt
halten muss, und die Frage „welcher Clip ist das Vorbild" hat eine ehrliche Antwort: der kopierte.

Effekte werden nach Typ hinzugefügt und dann Parameter für Parameter gesetzt, denn mehr bietet der
Command-Bus nicht — es gibt kein „ersetze diese Kette", und eines zu erfinden setzte neben
`effect.add` eine zweite Autorität darüber, was in einer Kette stehen darf. Ein Typ, den das Ziel
schon trägt, bleibt, wo er ist, und seine Parameter werden erneut darüber geschrieben: `effect.add`
behandelt einen wiederholten Typ als Nichtstun, zweimal einfügen kann also keine zweite Helligkeit
erzeugen.

Keys reisen mit dem mit, was sie animieren, samt Verlauf und Anfassern — ein Einfügen, das den
Verlauf fallen ließe, gäbe eine Bewegung zurück, die an der richtigen Stelle ankommt und falsch
dorthin gelangt. Der ganze Tastendruck ist ein Schritt in der Historie, gleich wie viele Clips er
berührt hat.

## An den Markern schneiden

Die Markerliste hat eine eigene Aktion: jeden Clip schneiden, durch den ein Marker läuft. Mit den
Beats einer Musikspur markiert ist das „auf den Schlag schneiden“ in einem Tastendruck — und ein
Schritt in der Historie, gleich wie viele Schnitte daraus wurden.

Angewendet wird Schnitt für Schnitt am lebenden Dokument, denn eine vorab gebaute Liste von Commands
kann nicht stimmen: ein Schnitt macht aus einem Clip zwei, der zweite Schnitt durch denselben Clip
nennte also eine Id, die der erste bereits ausrangiert hat. Jeder Clip wird unmittelbar vor seinem
Schnitt neu über seine Lage gefunden.

Ein Marker, der genau auf einem bestehenden Schnitt sitzt, hat nichts zu tun und wird übergangen
statt gefragt — und eine gesperrte Spur ebenso: der Kern lehnte sie ohnehin ab, und eine gesperrte
Spur darf die anderen fünf nicht mitnehmen.

## Das Bild ist ein Bedienelement

Einen Clip auswählen, und auf dem Bild erscheint ein Rahmen mit einem Griff an jeder Ecke und einem
zum Drehen. Ziehen im Rahmen verschiebt die Einstellung, eine Ecke skaliert sie, der Griff über der
Oberkante dreht sie — auf dem Bild, denn dort steht die Antwort: eine Zahl im Bedienfeld sagt 1,4,
und nur das Bild sagt, ob das Gesicht noch drauf ist.

Die Ecken sind keine Näherung. `clipQuad` in der Engine und `quadMatrix` — die Matrix, die der
Compositor der GPU übergibt — werden gegeneinander geprüft, über Verschiebung, ungleiche Skalierung,
Drehung, versetzten Ankerpunkt und jede Kombination mit einem Zuschnitt. Die Griffe sitzen also auf
dem Bild und nicht daneben.

| Geste | Wirkung |
|---|---|
| Ziehen im Rahmen | verschiebt den Clip, in Projektpixeln, gleich wie groß der Bereich gerade ist |
| Ziehen an einer Ecke | skaliert ihn, die gegenüberliegende Ecke bleibt genau stehen |
| Ziehen an einer Ecke mit <kbd>Umschalt</kbd> | skaliert jede Achse für sich statt das Seitenverhältnis zu halten |
| Ziehen am Griff über der Oberkante | dreht ihn um die Bildmitte |
| Drehen mit <kbd>Umschalt</kbd> | rastet in ganzen 15°-Schritten ein |

Die Ecke eines gedrehten Clips wächst entlang seiner eigenen Kante und nicht entlang des
Bildschirms, und eine Drehung ist der Winkel zwischen dem Griff beim Zupacken und dem Zeiger jetzt —
kein aufsummierter Zuwachs. Ein Zeiger, der das Fenster verlässt und zurückkommt, landet dort, wo er
ist.

Der ganze Zug ist ein Schritt in der Historie, dieselbe Abmachung wie bei den Zügen in der
Zeitleiste: der Coalescing-Schlüssel wird beim Drücken erzeugt und beim Loslassen fallen gelassen,
also sind hundert Zeigerbewegungen ein <kbd>Strg</kbd>+<kbd>Z</kbd>. Jede davon läuft über
`clip.setTransform`, also wandern die Felder im Eigenschaften-Bereich mit dem Rahmen mit, und ein
Keyframe von der einen wie von der anderen Seite bedeutet dasselbe.

### Die Bahn, die er nimmt

`Position X` oder `Position Y` an zwei Zeitpunkten auf die Uhr setzen, und die Bahn erscheint als
gestrichelte Linie auf dem Bild, mit einem Griff auf jedem Key. Einen Griff ziehen, und der Clip
steht zu diesem Zeitpunkt woanders — und sonst nirgends. Genau das macht es zu einer Bahn und nicht
zu einer zweiten Art, die Transformation zu setzen.

Die Linie ist **abgetastet**, nicht aus den Keys gezeichnet: achtundvierzig Zeitpunkte über den
Clip, jeder beim Kern erfragt. Was ein Abschnitt zwischen zwei Keys tut, ist die Antwort des Kerns —
eine Glättung, die Anfasser einer Bezierkurve, ein Halten — und eine Linie von Ecke zu Ecke wäre
eine zweite, hübschere Behauptung darüber, wohin der Clip geht. Die Griffe sitzen aus demselben
Grund auf der Linie: der Ort eines Keys ist, wo der Clip zu seinem Zeitpunkt steht, und das ist
dieselbe Frage, aus der die Linie abgetastet ist.

Drei Spuren können einen Clip bewegen, und jede zeichnet eine Bahn: die `position`-Spur, die eine
Vorlage als eine Form anlegt, sowie die `x`- und `y`-Spuren, die der Eigenschaften-Bereich schreibt.
Ein Key wird in die Spur zurückgeschrieben, aus der er kam — ein `vec2` für die erste, ein `x` und
ein `y` für die anderen, denn nur eines von beiden zu bewegen zöge den Clip zur Seite, wenn der
Zeiger diagonal ging.

`keyframe.add` auf einem Zeitpunkt, auf dem schon ein Key sitzt, ersetzt ihn, statt einen zweiten
danebenzusetzen: ein Zug über das Bild ist also ein Key, der seinen Wert ändert, gleich wie weit er
wandert — in einem echten Browser an einem echten Zug gegen die Zahl geprüft, die der
Eigenschaften-Bereich danach liest.

## Gesperrte Spuren

Das Schloss neben dem Spurnamen ist ein Versprechen: auf dieser Spur bewegt sich nichts, bis sie
wieder entsperrt ist. Durchgesetzt wird es im Kern, in einer Schranke vor der gesamten
Kommandoverteilung statt in jedem der zwanzig Handler, die einen Clip ändern könnten — eine Sperre,
die nur die Hälfte der Commands achtet, wäre schlimmer als keine, und das nächste hinzugefügte
Command wäre ein Loch, das niemandem auffällt.

Sie umfasst die Zeitleiste: die Clips der Spur, ihre Trims, ihr Tempo, ihre Transformationen, ihre
Effekte und Keyframes, die Effektkette der Spur selbst und die Spur als Ganzes. Sie lässt in Ruhe:
das Mischpult und den Namen — eine gesperrte Spur wird weiterhin geregelt, panoramiert, stumm- und
solo-geschaltet — und die Schalter selbst, denn darüber wird wieder entsperrt.

Die Zeitleiste wartet diese Ablehnung nicht ab. Ein Clip auf einer gesperrten Zeile ist gar kein
Ziel für eine Zieh-Geste, kommt also nie unter dem Zeiger weg und springt zurück; die Zeile ist
schraffiert, und das Schloss neben ihrem Namen sagt warum.

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

Ein Compound ist **isoliert**: seine Clips werden auf eine eigene Fläche komponiert, und Deckkraft,
Blendmodus, Effektkette, Zuschnitt und Übergang treffen danach dieses eine fertige Bild. Blendet man
einen Compound mit zwei überlappenden Clips auf die Hälfte, liest die Überlappung genau das, was der
Rest liest — 128 über Schwarz, während das getrennte Blenden jedes Clips den gemeinsamen Streifen auf
191 brachte und eine Naht dazwischen zog. Ein Blendmodus läuft einmal statt einmal je Clip, ein
Zuschnitt ist ein Schnitt durch die Gruppe statt etwas, das im Bild eines einzelnen Clips gar keine
Bedeutung hat, und eine Blende mischt das Bild darunter einmal mit — weshalb ein Übergang auf einem
Compound überhaupt erst anlegbar ist.

Die Fläche kostet je Isolierungsebene ein volles Bild an Speicher — 8,3 MB bei 1080p, also 66 MB für
ein Projekt, das so tief verschachtelt ist, wie es darf, und das Doppelte, wenn auf jeder Ebene auch
noch eine Effektkette oder eine Blende sitzt — und sie bleibt bis zum Abbau der Vorschau belegt.
Ein Compound, der nichts blendet, nichts überlagert, nichts gradet, nichts zuschneidet und
nichts überblendet, wird deshalb weiter flach gezeichnet: die Fläche gäbe genau zurück, was auf sie
kam, und flach zu zeichnen ist das, was *Verschachteln ändert kein Pixel* byteweise wahr hält statt
beinahe.

Ein **Auflösen** gibt es nicht: <kbd>Strg</kbd>+<kbd>Z</kbd> nimmt das Zusammenfassen zurück, und ein
aus einer Datei wieder geöffneter Compound bleibt einer.

### Marker

**Marker setzen** in der Werkzeugleiste oder <kbd>M</kbd> setzt einen am Playhead. Ein Klick auf
einen Marker im Lineal springt mit dem Playhead dorthin; sein eigenes Kontextmenü löscht ihn. Marker
sind Fangkandidaten, und das ist die eine Hälfte dessen, wofür sie da sind.

**Marker (n)** daneben öffnet die Liste, und zwar über den Spuren statt über ihnen — das Bild ist der
größte Bereich dieses Bildschirms, und eine Liste, die niemand geöffnet hat, darf ihm keine Zeile
wegnehmen. Jeder Marker ist eine Zeile: eine Farbe, der Timecode als Knopf, der dorthin springt, ein
Name und eine Notiz.

Die Farbe kommt aus dem Farbwähler des Betriebssystems und zurück als das `#rrggbb`, das der Kern
ohnehin annimmt. Der Name ist das, was das Lineal zeigen könnte; die Notiz ist der längere Text, und
an ihr liest man eine Liste von dreißig Markern. Tippen ist je Feld und je Marker ein Undo-Schritt
und nicht einer je Buchstabe.

<kbd>Umschalt</kbd>+<kbd>→</kbd> und <kbd>Umschalt</kbd>+<kbd>←</kbd> springen zum nächsten Marker in
dieser Richtung. Genau auf einem zu stehen zählt nicht als davor, damit die Taste weitergeht statt
wieder auf demselben Marker zu landen.

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

Jede Parameterzeile — die eines **Effektparameters** wie die jedes **Transformationsfelds** — trägt
einen Keyframe-Schalter, Pfeile zum vorherigen und nächsten Keyframe und, wo einer unter dem
Playhead sitzt, eine Auswahl für den Verlauf danach: linear, halten oder weich. Der Schalter setzt
am Playhead einen Keyframe oder löscht den dortigen. Eine Zeile, deren Parameter irgendwo auf der
Zeitleiste Keyframes hat, trägt eine Raute neben der Beschriftung: die drei Schalter melden immer
nur den Playhead, und eine anderswo animierte Zeile sah aus wie eine nirgends animierte.

Der Wert in der Zeile ist der, den der Kern für diesen Zeitpunkt liefert — `Effect::param_at` über
`doc.effectParamsAt`, `Clip::transform_at` über `doc.transformsAt` —, nie eine eigene Rechnung. Eine
Interpolation in TypeScript gäbe Vorschau und Export zwei verschiedene Antworten auf dieselbe Frage.
Welchen Befehl eine Transformationszeile schickt, steht unter [Eine Transformation
keyframen](./commands-and-undo.md#eine-transformation-keyframen).

Sobald ein Parameter gekeyframed ist, schreibt der Schieber Keyframes statt des statischen Werts,
und zwar am Playhead. `keyframe.add` ist ein Upsert, und genau das macht einen Zug zu einem
Undo-Schritt; es ersetzt Wert und Verlauf des dortigen Keyframes und lässt dessen Bezier-Anfasser
stehen, denn kein Befehl trägt ein Anfasserpaar, und es zu zerstören wäre das Einzige, was ein
Upsert damit sonst tun könnte. Steht der Playhead außerhalb des Clips, sind die
Keyframe-Bedienelemente gesperrt: ein dort geschriebener Keyframe wird für diesen Clip nie
ausgewertet, der Schalter würde also einen Zustand melden, den kein Bild je zeigt.

Zwei Zeilen tragen gar keinen Schalter. Wo ein Clip einen **Bewegungspfad** hat, löst der Kern `x`
und `y` aus ihm auf und ignoriert, was die beiden Felder halten — ein dort geschriebener Keyframe
würde gespeichert, gesichert und wieder geladen, ohne je ein Pixel zu erreichen. Aus demselben Grund
ist **Ins Bild einpassen** stillgelegt, solange die Platzierung, die es schriebe — `x`, `y`, eine
der beiden Skalierungen oder der Pfad —, auf der Uhr ist.

Die Lautstärke bleibt unanimiert, dort fehlt tatsächlich noch die Auswertung.

### Die Keyframe-Spur

Unter den Spuren, innerhalb des scrollenden Bereichs der Zeitleiste, liegt eine Spur mit den
Keyframes des ausgewählten Clips: eine Zeile je Keyframe-Spur, benannt wie die Eigenschaften sie
benennen, mit einem Punkt je Keyframe und dem Abstand zwischen zwei Punkten in der Form des
Verlaufs, der ihn zeitlich steuert — durchgezogen für linear, unterbrochen für halten, an beiden
Enden verblassend für weich.

Sie sitzt in der Zeitleiste und nicht in den Eigenschaften, damit es in der ganzen Anwendung eine
Umrechnung zwischen Pixeln und Zeit gibt und nicht zwei. Spur, Lineal, Clips und Playhead werden
alle von `timeToX` aus demselben `flicksPerPixel` und demselben Scroll-Versatz gesetzt, ein Keyframe
steht also bauartbedingt auf dem Lineal-Strich seiner eigenen Zeit und nicht per Absprache. Eine
Spur in den Eigenschaften bräuchte eine zweite Achse über die Breite des Bereichs, einen eigenen
Scroll und einen eigenen Playhead — zwei Antworten auf „wo ist jetzt", und das ist das Einzige, was
sich ein Keyframe-Editor nicht leisten kann. Keyframe-Zeiten sind im Modell absolute
Zeitleistenzeit, dieselben Zeitpunkte, die der Playhead meldet; zwischen beiden Enden wird nichts
umgerechnet.

Ein Druck wählt einen Punkt aus, ein Zug verschiebt ihn. Es ist derselbe Zeigerpfad, den Clips
benutzen — er funktioniert also mit Maus und Finger ohne zweiten Codepfad, das Einrasten gilt (mit
<kbd>Alt</kbd> ausgesetzt), und ein Zug ist ein Eintrag im Verlauf. Ein Zug klemmt an den Kanten des
Clips, weil ein Keyframe außerhalb des Clips für ihn nie ausgewertet wird — und weil die Klemme den
Kern davon abhält, einmal pro Zeigerbewegung abzulehnen, woraus ein an seiner Grenze gehaltener
Trimm einmal neun rote Banner in einem einzigen Zug gemacht hat.

Über der Spur steht, solange ein Keyframe ausgewählt ist, eine Leiste mit dem, worauf dieser
Keyframe eingestellt ist: der Name seines Parameters, der Verlauf des bei ihm beginnenden Abschnitts
und ein Löschknopf. Die Leiste sitzt außerhalb des scrollenden Bereichs, damit sie bei einem langen
Projekt erreichbar bleibt, und der Knopf ist da, weil ein Finger keine <kbd>Entf</kbd>-Taste hat.
Mit ausgewähltem Keyframe löscht <kbd>Entf</kbd> diesen Keyframe und nicht den Clip darunter.

Zeilen, die ein Bewegungspfad übernommen hat, sind durchgestrichen und mit *vom Pfad überschrieben*
gekennzeichnet. Versteckt werden sie nicht: die Keyframes stehen weiterhin in der Datei, und die
Spur ist dazu da, zu zeigen, was gespeichert ist.

### Das Kurvenfeld

Neben dem Verlauf trägt die Leiste ein Klappfeld **Kurve**. Es öffnet über den Spuren, so wie die
Markerliste es tut, und zeigt den einen Abschnitt, der beim gewählten Keyframe beginnt: ein
quadratisches Feld, in dem der Weg von 0 beim linken Schlüssel bis 1 beim rechten aufgetragen ist,
mit der gleichmäßigen Diagonalen gestrichelt dahinter, damit die Form als Abweichung von ihr lesbar
wird — und, sobald der Schlüssel auf `bezier` steht, den beiden Anfassern, die sie formen, jeder an
das Ende des Abschnitts angebunden, das er steuert.

**Warum nicht in der Spur.** Die Keyframe-Spur fährt auf der Zeitachse der Zeitleiste; genau das
lässt einen Keyframe mit dem Lineal und dem Abspielkopf fluchten, ohne dass sich irgendetwas
darüber einigen müsste, wo *jetzt* ist. Eine Kurve braucht eine Wertachse, die die Spur nicht hat,
und eine 26 px hohe Zeile (44 px am Finger) hat keinen Platz dafür. Sie braucht auch Platz in die
Breite: ein Abschnitt ist meist der Bruchteil einer Sekunde, bei Normalzoom also rund fünfzig Pixel
— weniger als ein Fingerziel, ein Anfasser darauf wäre ohne Hineinzoomen der ganzen Zeitleiste
nicht zu ziehen. Die x-Achse des Feldes ist auch gar keine zweite Zeitachse: sie ist die eigene
0..1 des Abschnitts, das Einheitsquadrat, in dem ein Anfasserpaar ohnehin gespeichert wird — genau
so, wie CSS `cubic-bezier` es schreibt.

**Die Linie kommt aus dem Kern.** Das Feld fragt `keyframe::segment_shape` nach seinen Abtastwerten
— dieselbe Funktion, die `interpolate` auf die Werte anwendet. Ein zweites Easing in TypeScript
bestünde jede Prüfung an den Enden und wäre in der Mitte falsch, und eine Kurve, die anders
aussieht, als sie wirkt, ist der eine Fehler, den ein Kurveneditor nicht haben darf.

Das Ziehen eines Anfassers schickt `keyframe.setHandles`, eine Sendung je Zeigerbewegung unter einem
Coalesce-Key: ein Zug ist ein Undo-Schritt. Jede Schreibung trägt das ganze Paar, das der Keyframe
hält — nur den einen unter der Hand zu senden würde den anderen auf die Voreinstellung
zurücksetzen. `handle_out` gehört zum gewählten Schlüssel, `handle_in` zum nächsten, deshalb hat der
letzte Keyframe einer Spur kein eigenes Feld — sein ankommender Anfasser wird über das Feld des
Schlüssels davor erreicht. Die drei Voreinstellungen bleiben ein Klick; die Kurve ist der vierte
Eintrag daneben, kein Modus, der sie ablöst.

Zwei Regeln zeigt das Feld, statt sie nur zu befolgen. Eine Zeile, die ein Bewegungspfad übernommen
hat, sagt das auch im Feld und nicht nur in der Zeilenüberschrift — die Kurve ist echt und ändert
trotzdem kein Bild. Und einer **Ratenspur wird `bezier` gar nicht erst angeboten**:
`keyframe::integrate` hat unter einer Bezier keine exakte Fläche, mit ihr fiele die Additivität, auf
der `consumed_source` steht, und der Kern lehnt die Änderung ab. Ein Eintrag, der nur eine Absage
erzeugen kann, ist schlechter als ein Eintrag, den es nicht gibt.

**Das Feld reicht über das Einheitsquadrat hinaus**, um je ein Drittel nach oben und unten, und
genau das macht einen Abprall herstellbar: ein Anfasser, dessen y über dem Ziel der Bewegung liegt,
schickt den Wert über sein Ziel hinaus und zurück. Zwei kräftigere Linien markieren, wo die Bewegung
losgeht und wo sie ankommt, damit das Überschwingen etwas hat, was es überschwingt — und das
Einheitsquadrat bleibt quadratisch: das Feld ist um genau dieses Drittel je Ende höher als breit,
also ist die gestrichelte Diagonale eine Diagonale und die gleichmäßige Bewegung, für die sie steht,
liest sich als eine.

**Eine Form für die ganze Bewegung.** Unter dem Feld steht, sobald die Spur mehr als zwei Keys hat,
die Antwort auf „diese Kurve kopieren": der Verlauf des gewählten Abschnitts auf jedem anderen Key
derselben Spur. Eine Form, an der jemand eine Minute gesessen hat, ist eine Form für die Bewegung und
nicht für einen ihrer Abschnitte, und sie Key für Key erneut zu setzen ist dieselbe Minute wieder und
wieder. Der Verlauf reist mit dem Anfasserpaar mit, denn Anfasser an einem Key auf `linear` werden
gespeichert und ignoriert — eine Kopie nur des Paares wäre ein Tastendruck, der nichts ändert. Ein
Druck ist ein Schritt in der Historie.

Es gilt für die Spur eines Parameters und endet dort. Über zwei Parameter hinweg müssten die Keys der
zweiten Spur zu denen der ersten passen, und nichts im Modell sagt, dass sie das tun.

Ein Zug wird an dem gehalten, was das Feld zeigt, und dahinter endet er: ein Anfasser, der oben
hinausgezogen wird, wäre eine Form, die kein Zug zurückholt. `x` bleibt auf 0..1 geklemmt, und diese
Klemme ist die des Kerns — `cubic_bezier_y_at` bisektiert auf x und braucht es steigend über die
Spanne, dieselbe Klemme antwortet also für ein handgeschriebenes Projekt und für einen hier
gezogenen Anfasser.

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

## Untertitel

Videola liest und schreibt **SRT** und **WebVTT**. Lass eine `.srt` oder `.vtt` auf den Editor
fallen, oder nimm **Untertitel importieren** im Projektmenue: jede Marke wird zu einem Clip auf einer
eigenen Untertitelspur. **Untertitel exportieren** schreibt die Spur als SRT neben das Projekt
zurueck.

Ein Untertitel ist ein gewoehnlicher Clip mit einem Textgenerator darin. Alles, was die Zeitleiste
mit einem Clip kann, kann sie deshalb auch mit einem Untertitel: ziehen, an beiden Kanten trimmen,
am Abspielkopf teilen. Zwei Dinge gehoeren den Untertiteln allein. **Mit naechstem Untertitel
verbinden** im Clipmenue faltet einen Untertitel in den folgenden -- die Woerter auf eigenen Zeilen
verbunden, die Spanne vom ersten Kopf bis zum zweiten Ende -- und das ist ein Rueckgaengig-Schritt,
denn ein halb verbundenes Paar ist kein Zustand, in den jemand gelangen wollte. Und im **Text**-Feld
des Inspectors werden die Woerter getippt. Es ist ein Textbereich und kein einzeiliges Feld: ein
harter Zeilenumbruch ist ein Zeilenumbruch im Bild, und ein zweizeiliger Untertitel, der in ein
einzeiliges Feld getippt wird, kommt einzeilig zurueck.

### Wo die Zeiten liegen

Die Formate rechnen in ganzen Millisekunden, das Projekt in Flicks. 705 600 000 ist ein ganzes
Vielfaches von 1000, eine Millisekunde sind also genau 705 600 Flicks, und in keiner Richtung geht
etwas verloren. Diese Umrechnung liegt in `millisecondsToTime` und `timeToMilliseconds` in
`packages/core/src/commands.ts` und sonst nirgends -- und genau das laesst dieselbe Datei Zeichen
fuer Zeichen hinein und wieder heraus. Geprueft wird das an einer Datei, deren Millisekunden weder
ganze Sekunden noch ganze Bilder sind.

Zurueckgeschrieben wird nur eine Untertitelspur. Das ist der ganze Grund, warum es
`TrackKind::Caption` gibt statt einer Verabredung auf der Textspur: die mitgelieferten Vorlagen legen
Bauchbinden auf Textspuren, eine Untertiteldatei aus allen Textclips des Projekts truege die
Bauchbinden also als Marken mit -- und eine aus einigen von ihnen braeuchte anderswo eine zweite
Markierung, die sagt, welche. Eine ausgeblendete Untertitelspur bleibt aus der Datei, aus demselben
Grund, aus dem sie aus dem Bild bleibt.

### Was eine SRT sein darf

Eine Untertiteldatei ist eine Datei, die dir jemand gegeben hat. Jedes hiervon wird einzeln
weggelassen, und der Rest der Datei wird trotzdem gelesen: ein Zeitstempel, der sich nicht lesen
laesst, ein Ende, das nicht nach dem Anfang kommt, eine Marke ohne Woerter darin, eine Marke weiter
draussen, als ein Projekt reicht. Nach 20 000 Marken hoert das Lesen auf -- das Zehnfache eines
dreistuendigen Films. Aus einer Datei, die gar keine Untertiteldatei ist, kommt nichts statt eines
Fehlers. Auszeichnungen fallen weg -- der Generator zeichnet einen Textlauf in einem Stil, und die
Alternative waere, die Auszeichnung als Zeichen zu zeichnen.

### Wie sie aussehen und wo sie landen

Voreingestellt ist Weiss auf einer halbdurchsichtigen schwarzen Platte, unten und mittig, in den
Stilschluesseln, die der Textgenerator ohnehin liest. Die Platte ist es, die den Untertitel vor
hellem Himmel wie vor naechtlichem Innenraum lesbar macht -- eine Kontur allein uebersteht das eine
und nicht das andere, und eine Kontur, die fuer beides breit genug ist, frisst die Punzen der
Buchstaben. Diese Behauptung wird an Pixeln geprueft, ueber Weiss und ueber Fastschwarz, gegen
dieselben Woerter ohne Platte.

Im Exportdialog stehen Untertitel **ins Bild**, **als eigene Spur** oder **weggelassen**. Ins Bild
ist die Voreinstellung und verlangt vom Abspieler nichts. Eine eigene Spur kann der Zuschauer
abschalten; ob der gewaehlte Container eine tragen kann, wird beim Schreiber erfragt statt
angenommen, und der Knopf ist ausgegraut, wo er es nicht kann. Beide Container, die Videola
schreibt, tragen heute WebVTT.

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

### J, K und L

| Taste | Wirkung |
|---|---|
| <kbd>J</kbd> | läuft rückwärts; jeder Druck in dieselbe Richtung steigt 1, 2, 4, 8 |
| <kbd>K</kbd> | hält an |
| <kbd>L</kbd> | läuft vorwärts, dieselbe Leiter hinauf |

Ein Druck gegen die Fahrtrichtung fällt sofort auf die erste Stufe zurück, statt herunterzuzählen —
das ist es, was ein Antippen von <kbd>J</kbd> aus dem schnellen Vorlauf wie eine Bremse anfühlen
lässt. Die Rate steht neben dem Timecode, solange sie nicht die gewöhnliche ist, und die beiden
Dreiecksknöpfe tun dasselbe für eine Hand ohne Tastatur darunter. Ein Rücklauf endet am Anfang der
Zeitleiste und hält dort an.

Das ist die Rate des **Transports** und nicht die eines Clips. Die Geschwindigkeit eines Clips —
auch eine Rampe, die eine Kurve ist und kein Faktor — ist eine Eigenschaft des Materials und wandert
mit ihm in den Export; diese hier existiert nur, solange jemand schaltet, und nichts im Projekt liest
sie je.

Ton läuft bei einfacher Geschwindigkeit und bei keiner anderen. Ein `AudioBufferSourceNode` ist gegen
die echte Zeit geplant und kann einer Schaltung nicht folgen; die Alternative wäre also nicht
schneller Ton, sondern Ton, der mit jeder Sekunde weiter vom Bild wegläuft — und das ist schlechter
als keiner.

### Wiedergabe-Auflösung

Die Auswahl neben dem Timecode zeichnet die Vorschau auf **1/2** oder **1/4** der Auflösung des
Bildschirms. Das Element behält seine Größe, der Browser zieht den kleineren Puffer darüber, und das
Bild wird nur weicher — die billigste Leistungssteigerung, die es für eine Vorschau gibt, die bei
großem Material mitkommen soll. Der Export sieht davon nichts: er rendert in einen eigenen Kontext,
in der Größe, die der Export-Dialog bekommen hat.

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
