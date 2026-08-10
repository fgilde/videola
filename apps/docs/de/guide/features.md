# Was Videola kann

Ein Rundgang durch den Editor, wie er dasteht. Alles hier ist gebaut und geprüft; das
[Architektur-Kapitel](/de/guide/architecture) hält Entscheidung für Entscheidung fest, was
stattdessen geplant ist.

## Die Oberfläche

![Videola am Schreibtisch: Medienbibliothek links, ein dekodiertes Bild in der Vorschau, Eigenschaften rechts, unter dem Transport die Messgeräte und darunter die Zeitleiste](/editor-desktop.webp)

Vier Bereiche, und das Bild ist der größte davon — dafür gibt es eine Prüfung, weil eine Rasterzeile,
die mit ihrem Inhalt wächst, die Leinwand schon zweimal auf Briefmarkengröße geschrumpft hatte,
ohne dass es jemandem auffiel.

**Die Bibliothek** zeigt, was im Projekt liegt: Länge, Maße in Pixeln, Abtastrate und ein
Vorschaubild, das aus der Datei selbst dekodiert wurde. **Die Eigenschaften** zeigen, was am
gewählten Clip einstellbar ist, und lassen jeden Wert über die Zeit animieren. **Die Zeitleiste** ist
der Ort der Arbeit. **Das Mischpult** trägt einen Streifen je Spur und einen Summenzug; es wird wie
die Messgeräte im Transport aufgeklappt und beginnt zugeklappt, denn das Bild ist der größte Bereich
auf dem Schirm, und keines von beidem ist es wert, das ungefragt aufzugeben.

## Schneiden

| Geste | Wirkung |
|---|---|
| Klick auf einen Clip | wählt ihn aus; mit Modifikatortaste mehrere |
| Ziehen in der Mitte | verschiebt ihn, auch über Spuren hinweg |
| Ziehen an einer Kante | trimmt, rippelt oder rollt, je nach Kantenmodus |
| Ziehen im Slip- oder Slide-Modus | schiebt die Quelle unter dem Clip, oder den Clip zwischen seinen Nachbarn |
| Ziehen im Lineal | scrubbt |
| Ziehen über leere Zeitleiste | ein Gummiband über alles, was es berührt |
| Zwei Zeiger | zoomen über die Abstandsänderung |
| Langes Drücken | öffnet das Kontextmenü |

Ein Clip lässt sich **ausschalten** statt löschen: er behält seinen Platz und seine Länge, nichts
zeichnet ihn und nichts spielt ihn, und er erscheint abgedunkelt und schraffiert. So vergleicht man zwei
Takes — einen zu löschen und wieder einzufügen ist eine andere Handlung, und sie verliert, wo der Clip
war.

Ein Zug über leere Zeitleiste zieht ein **Gummiband** und wählt aus, was es berührt; zugezogen gibt es
die Auswahl wieder her.

**Schnitte in diesem Clip finden** liest jedes Bild eines Clips und teilt dort, wo sich das Bild viel
stärker ändert als drumherum — eine Kamerakarte, in einem Undo-Schritt in ihre Takes zerlegt. Eine
Blende wird nicht als Schnitt gemeldet und ein Schwenk auch nicht: geprüft wird auf eine Spitze gegen die
eigene Nachbarschaft und nicht auf eine Schwelle. Siehe
[Schneiden](./editing.md#die-schnitte-in-einer-aufnahme-finden).

Ripple-Löschen schließt die Lücke, die es hinterlässt. Gruppen bewegen sich gemeinsam. Ausschneiden,
Kopieren und Einfügen arbeiten auf ganzen Clips, Marker sitzen im Lineal, und eine Auswahl lässt sich
zu einem **Compound-Clip** zusammenfassen — dass sich das Bild dabei nicht ändert, ist gegen den
ganzen Bildpuffer, die Zeichenliste an sechzehn Zeitpunkten und den Tonlauf Sample für Sample
nachgewiesen. Gibt man diesem Compound eine Deckkraft, einen Blendmodus, einen Effekt, einen
Zuschnitt oder eine Blende, wird er zuerst auf eine eigene Fläche komponiert, und alle fünf treffen
die fertige Gruppe genau einmal: zwei überlappende Clips auf die Hälfte geblendet lesen über die
Überlappung 128 statt der 191, die früher eine Naht hindurchzogen.

Alles läuft über Pointer Events, damit Maus, Stift und Finger denselben Weg nehmen, und ein ganzer
Zug über zweihundert Bewegungen ist **ein** Undo-Schritt.

Der klassische Schnitt ist ebenfalls da: einen Bereich im Medium mit <kbd>I</kbd> und <kbd>O</kbd>
markieren, dann **fügt** <kbd>,</kbd> ihn am Playhead ein — mit derselben Lücke auf jeder Spur, damit
Ton beim Bild bleibt — oder <kbd>.</kbd> **überschreibt** damit, ersetzt also, was dort lag, und
lässt die Zeitleiste so lang, wie sie war. Jedes davon ist ein Command; ein Einfügen über drei Spuren
und ein Dutzend Clips ist ein <kbd>Strg</kbd>+<kbd>Z</kbd>.

Eine **Anpassungsspur** trägt kein eigenes Bild: die Effekte ihrer Clips laufen über alles, was
darunter gezeichnet wird — über das zusammengesetzte Bild, einmal, nicht einmal je Clip —, damit fünf
Einstellungen auf einmal gegradet werden statt fünfmal. Dass sich das Bild darunter ändert und das
daneben nicht, ist an echten Pixeln geprüft — der einzige Ort, an dem diese Aussage überhaupt
existiert; und die Naht ebenso: zwei Clips, die unter einer weichgezeichneten Ebene aneinanderstoßen,
halten ihre Farben auf volle 255 statt auf 194.

Marker tragen eine Farbe und eine Notiz, und die Liste neben dem Marker-Knopf springt zwischen ihnen;
<kbd>Umschalt</kbd> und eine Pfeiltaste tut dasselbe von der Tastatur aus.

## Effekte, Übergänge und Text

![Der Effekt-Browser: Kacheln nach Kategorien, jede durch den Effekt gerendert, den sie anbietet](/editor-effects.webp)

Ausgewählt werden sie in einem Browser nach Kategorien, durchsuchbar in beiden Sprachen, und **jede
Kachel ist der Shader des Effekts über dem Bild am Playhead** — kein gemaltes Beispiel. Eine Kachel,
die das Bild nicht verändert, aus dem sie gezeichnet wurde, lässt den Bau scheitern. Genau das
verhindert, dass ein Effekt mit seinem eigenen Standardwert für sich wirbt.

Helligkeit, Kontrast, Sättigung, Farbtemperatur, Kurven, Farbräder, Farbtabellen, Vignette,
Weichzeichnen, Schärfen, Verpixeln, Richtungsunschärfe, Leuchten und Chroma-Keying. Überblendung, Wischen, Schieben, Kreisblende, Zoom, Weichzeichnen-Blende und Blende
über eine frei gewählte Farbe. Rechteckige und elliptische Masken mit weicher Kante und
Invertierung; zwei Masken in einer Kette schneiden sich. Ein Textgenerator mit Gestaltung sowie
Ein-, Aus- und Schleifenanimation.

**Bewegungsunschärfe** ist keiner davon, und das mit Absicht: ein Clip trägt eine Belichtung, und der
Renderer mittelt ihn über acht echte Zeitpunkte dieser Belichtung, jeden mit eigener Quellzeit und
eigener Platzierung. Kein Shader kann das aus einem Bild herstellen — deshalb heißt die
Richtungsunschärfe oben nach dem, was sie ist. Siehe
[Effekte und Übergänge](./effects-and-transitions.md#bewegungsunscharfe).

Ein Effekt lässt sich **ausschalten**, ohne entfernt zu werden, und entfernen, ohne ausgeschaltet zu
sein: Überbrücken lässt jeden Parameter und jeden Keyframe stehen. Bis zu dieser Fassung gab es für
beides keinen Befehl.

Ausgewählt werden sie in einer **Bibliothek zum Ansehen**: nach Kategorien geordnet, in beiden
Sprachen durchsuchbar — und jede Kachel darin ist der Shader dieses Effekts selbst, gerechnet über
das Bild, das der Editor gerade zeigt, in Daumennagelgröße. Keine gemalte Illustration und kein
Beispielfoto: Was die Kachel verspricht, liefert die Zeitleiste, weil es derselbe Shader ist. Ein
Übergang zeigt den Moment, der am meisten über ihn sagt — bei einer Überblendung die Mitte, bei
einer Blende über Farbe gerade nicht.

Jeder Parameter ist keyframebar — auch Position, Skalierung, Drehung und Deckkraft eines Clips — und
eine `position`-Spur macht aus einer Reihe von Schlüsseln einen **Bewegungspfad**, der als Kurve
interpoliert wird statt als Ecken. Die Interpolation geschieht im Rust-Kern, damit Vorschau und
Export unmöglich verschiedene Werte lesen.

Bearbeitet werden Keyframes in einer Spur unter den Spuren, auf der Zeitachse der Zeitleiste
selbst: ein Druck wählt einen aus, ein Zug verschiebt ihn, <kbd>Entf</kbd> oder der Knopf über der
Spur löscht ihn, und eine Auswahl bestimmt den Verlauf der Strecke danach — linear, halten oder
weich oder eine eigene Kurve. Ein Zug ist ein Undo-Schritt, und alles funktioniert mit dem Finger
genauso wie mit der Maus.

Das **Kurvenfeld** öffnet neben dem gewählten Keyframe über den Spuren und zeigt den einen
Abschnitt, der bei ihm beginnt: den Weg, aufgetragen gegen die gleichmäßige Diagonale, mit je einem
Anfasser an beiden Enden. Die Linie wird beim Kern abgetastet statt hier nachgerechnet — was auf
dem Schirm steht, ist das, was das Bild bewegt, und eine Kurve, die anders aussieht, als sie wirkt,
ist der eine Fehler, den so ein Werkzeug nicht haben darf. Die drei Voreinstellungen bleiben
daneben ein Klick. Einer Ratenspur wird nie eine Kurve angeboten: die Fläche unter einer Bezier ist
nicht exakt, und die Zeitabbildung einer Geschwindigkeitsrampe steht darauf, dass diese Fläche
exakt additiv ist. Siehe [Schneiden](./editing.md#das-kurvenfeld).

Die Wirkung jedes Effekts wird an echten Pixeln eines echten Treibers gemessen: 338 solcher
Prüfungen laufen bei jedem Bau, und jede Kachel der Bibliothek ist eine davon — eine Kachel, die das
Bild nicht verändert, aus dem sie gezeichnet wurde, lässt den Bau scheitern. Ein zu einem Drittel
gedeckter Pixel über Rot muss **81** ergeben —
das liefert premultipliziertes Alpha; die naheliegende Antwort 255 fällt durch.

## Farbkorrektur, und etwas, woran man sie beurteilt

Kurven und Farbräder, und drei Messgeräte, um das Ergebnis abzulesen.

**Kurven** für die Helligkeit und für jeden der drei Kanäle, mit Stützpunkten, die man zieht: ins
Feld tippen setzt einen neuen dorthin, auf einen Punkt tippen nimmt ihn weg, und die beiden Enden
bleiben. Die Linie ist ein monoton kubischer Spline, der zwischen zwei Punkten nicht überschießen
kann — ein Überschwinger auf einer Tonwertkurve ist ein heller Saum an jeder Kante im Bild, die
diesen Tonwert kreuzt. Die Helligkeitskurve ist nicht dasselbe wie die drei Kanalkurven im
Gleichschritt: sie skaliert alle drei mit einem Verhältnis, die Farbe eines Pixels kommt also genau
so heraus, wie sie hineinging, und nur seine Helligkeit bewegt sich.

**Farbräder** — Lift, Gamma und Gain — jeweils mit Farbstich und Stärke, also mit dem, was Rad und
Ring an einem echten Pult sind. Lift sagt, wohin Schwarz geht, Gain sagt, wohin Weiß geht, und Gamma
biegt, was dazwischen liegt, ohne eines der beiden Enden mitzunehmen.

**Farbtabellen**: eine `.cube` auf den Editor fallen lassen und unter der Farbkorrektur auswählen.
Die Tabelle kommt in die Bibliothek wie jedes andere Medium — inhaltsadressiert, dieselbe Datei in
zwei Projekten ist also eine Datei auf der Platte, und mit in die `.videola` gepackt, **ein Projekt,
das reist, bringt seine Farbkorrektur also mit**. Ein Stärkeregler mischt den Look zurück zum Bild,
aus dem er kam. Gelesen wird die Tabelle gegen das Bild, wie es steht, und das ist der richtige
Eingang für einen display-referred Look; eine für lineares Licht gebaute Tabelle erwartet ihren
eigenen Eingang und wird hier nicht eines Besseren belehrt. Eine eindimensionale `.cube` wird
ausdrücklich abgelehnt, denn das ist eine Tonwertkurve, und die Kurven weiter oben bearbeiten eine
davon bereits mit Punkten, die man hinterher noch ziehen kann.

**Messgeräte**: eine Wellenform, ein Vektorskop und ein Histogramm, in einer Leiste unter dem Bild,
die ein Schalter in der Transportleiste öffnet. Sie lesen die Pixel der Vorschau selbst, was sie
zeigen, ist also das, was der Export schreiben wird. Vor dem Zählen werden sie auf der GPU
verkleinert und zehnmal in der Sekunde gemessen: 0,9 ms je Messung statt der 33 ms, die ein naives
Zählen des ganzen Bildes bei 1080p kostet — und gar nichts, solange die Leiste zu ist.

Alles hier lässt sich keyframen wie jeder andere Parameter, Kurven eingeschlossen: ein Kurven-Keyframe
interpoliert die Stützpunkte, ein Knie wandert also seitlich mit und nicht nur nach oben.

## Untertitel

Eine **SRT** oder **WebVTT**, die auf den Editor faellt, wird zu einer Untertitelspur: ein Clip je
Marke, zu den Zeitpunkten der Marke selbst. Dieselbe Spur schreibt sich als SRT wieder heraus,
Zeichen fuer Zeichen -- die Formate rechnen in ganzen Millisekunden, eine Millisekunde sind genau
705 600 Flicks, und die Umrechnung liegt an einer einzigen Stelle, damit eine Datei den Weg hin und
zurueck geht, ohne sich zu bewegen.

Ein Untertitel ist ein Clip mit einem Textgenerator darin. Er laesst sich also ziehen, trimmen und
teilen wie alles andere auf der Zeitleiste; einen in den naechsten zu verbinden ist ein Menuepunkt
und ein Rueckgaengig-Schritt. Getippt werden die Woerter im Inspector, in einem Textbereich statt in
einem einzeiligen Feld, denn ein zweizeiliger Untertitel ist zweizeilig. Voreingestellt ist Weiss auf
halbdurchsichtiger Platte, unten und mittig -- dass das vor hellem Himmel wie vor naechtlichem
Innenraum lesbar bleibt, wird an Pixeln geprueft statt behauptet.

Im Export gehen sie **ins Bild**, **daneben als Untertitelspur**, die der Zuschauer abschalten kann,
oder **gar nicht**. Welcher Container eine eigene Spur tragen kann, wird beim Schreiber erfragt statt
angenommen, und die entstandene Datei wird von **ffprobe** zurueckgelesen, um zu bestaetigen, dass
die Spur wirklich darin steht.

Untertitelclips werden nirgends abgelehnt und ueberall erkannt: zurueckgeschrieben wird nur eine
Untertitelspur, die Bauchbinden auf den Textspuren bleiben also aus der Untertiteldatei heraus.

## Umzeiten und Voreinstellungen

Die Geschwindigkeit eines Clips ist eine **Kurve über die Zeit**, kein Faktor. Keyframes auf der
`speed`-Spur machen aus der Abbildung von Projektzeit auf Quellzeit ein Integral statt einer
Multiplikation — die Fläche unter der Geschwindigkeitskurve — und `consumed_source` ist dasselbe
Integral, nur für den ganzen Clip gefragt. Summe und Anfang können deshalb nie auseinandergehen.
Rückwärtslauf, Trimmen und die Dekoderklemmung arbeiten weiter, weil sie auf dieser einen Funktion
stehen und nicht auf der Arithmetik, die sie ersetzt.

Der Ton folgt derselben Kurve: ein `AudioBufferSourceNode` liest seinen Puffer am laufenden Integral
von `playbackRate`. Bild und Ton sind also eine Abbildung, von zwei Maschinen gerechnet, und nicht
zwei Umsetzungen, die man im Gleichschritt halten muss. Eine Rampe wird über sieben Formen Flick für
Flick gegen den Rust-Kern geprüft und Sample für Sample in einem echten Offline-Tonlauf.

Ein **Standbild** ist eine Rate von null und sonst nichts. Kein Standbildclip, keine zweite
Quellenart.

Die Voreinstellungen — Standbild, drei Zeitlupenformen, eine Ken-Burns-Fahrt, Bild im Bild, geteilter
Bildschirm — sind Listen von Befehlen unter einem gemeinsamen Sammelschlüssel, keine Einträge in der
Projektdatei. Damit ist jede von ihnen ein einziger Undo-Schritt ohne eine Zeile Umkehrcode und für
einen Agenten erreichbar, indem er dieselben Befehle schickt. Siehe [Schneiden](./editing.md#voreinstellungen).

## Untertitel

Ein Untertitel ist ein Clip mit Textgenerator auf einer Untertitelspur — einer eigenen Spurart, weil
nur die beantworten kann, welche Clips Untertitel sind. Eine Bauchbinde liegt auf einer Textspur und
stünde sonst in jedem exportierten SRT.

**SRT und WebVTT gehen hinein und kommen heraus.** Eine Millisekunde sind exakt 705.600 Flicks, der
Ringschluss ist also rechnerisch verlustfrei und nicht durch Rundungsglück — und er wird zweimal
Zeichen für Zeichen geprüft: einmal durch den Parser allein, einmal durch den echten Rust-Kern samt
Speichern und Wiederöffnen. Die Prüfzeiten sind bewusst keine ganze Sekunde, kein Zehntel und kein
Bild bei irgendeiner angebotenen Rate.

Untertitel lassen sich auf der Zeitleiste neu tippen, teilen und zusammenfassen wie jeder Clip. Ins
Bild kommen sie über denselben Textgenerator wie die Vorlagen, und der Export kann sie als Spur
mitschreiben, wo der Behälter es zulässt.

## Ton

![Der Editor auf einem Tablet: die Eigenschaften zweispaltig, drei vollständige Mischpult-Streifen am Boden](/editor-tablet.webp)

Lautstärke, Panorama, Stumm und Solo je Spur, wobei Stumm über Solo gewinnt. Fades werden als
Automation im Voraus gesetzt statt pro Bild gerechnet — das ist der Unterschied zwischen einem
sauberen Fade und einem Knacken. Waveforms entstehen aus den Puffern, die der Graph ohnehin dekodiert
hat: kein zweites Dekodieren, und ein rückwärts laufender Clip zeigt sich so, wie er klingt.

Jede Spur und der Master können **Inserts** tragen: einen Peaking-EQ, einen Kompressor, einen
Limiter. Sie sitzen vor dem Fader wie an einem Pult, damit der Fader das gepegelte Signal führt. Ihre
Parameter sind keyframebar wie alle anderen, und derselbe Auflöser bedient Vorschau, Export, Server
und Lautheitsmessung.

Die **Stereo oder 5.1**, gewählt am Master-Streifen. In einem Surround-Projekt hat jede Spur eine Position
im Feld statt eines Platzes zwischen zwei Boxen: Panorama links/rechts, **hinten** von vorne nach
hinten, und ein **LFE**-Weg, der ein Band ist — ein Tiefpass bei den 120 Hz, die die Spezifikation für
diesen Kanal nennt — und kein Ort. Platziert wird paarweise zwischen benachbarten Boxen mit konstanter
Leistung, eine Bewegung behält also ihre Lautheit; ein Stereobett behält die Breite, mit der es
aufgenommen wurde, und nach innen gezogen erreicht es die Center-Box. Eine 5.1-Mischung, die der
Browser nicht kodiert, wird in Stereo ausgegeben und behält ihre Platzierung, statt still zu sein.

**Rauschunterdrückung** ist spektral und das Einzige, was Tiefen- und Höhensperre nicht sein können: sie
trennt eine Stimme von einem Geräusch, das ihr Band teilt. Der Boden wird aus den Pausen des Clips
selbst gelernt, und jedes Fenster wird pro Bin um so viel abgesenkt, wie davon Boden ist. Es läuft über
dem dekodierten Puffer und nicht als Insert, weil die Analyse die ganze Aufnahme braucht — deshalb
ändert sich der Wellenform-Streifen sichtbar, wenn man es einschaltet, und das ist derselbe Puffer, den
Vorschau und Export benutzen.

Lautheit wird nach EBU R128 gemessen und gegen die Tech-3341-Fälle geprüft. Der Regler des
Limiters heißt **Schwelle**, nicht Ceiling: der Kompressor des Browsers legt eigenen Ausgleichspegel
drauf, ist also keine Brickwall — und die Doku sagt das, statt etwas anderes anzudeuten.

Jeder Streifen trägt eine **Pegelanzeige** — Spitze, Effektivwert und eine fallende Haltemarke,
gelesen aus einem Analyser, der in der Signalführung sitzt und nicht daneben. **Normalisieren**
bringt den Summenregler auf einen Zielwert von −14, −16 oder −23 LUFS und misst danach erneut, was
dasteht, ist also ein Messwert und nicht der Zielwert. **Ducking** senkt die Musik unter einer
Sprachspur ab, indem es Keyframes auf einen Verstärkungs-Insert des Musikbusses schreibt —
sichtbare Ecken zum Nachziehen statt einer unsichtbaren Automatik, und der einzige Weg, den die
Web-Audio-API lässt, denn eine Seitenkette hat sie nicht. **Stille schneiden** findet die Pausen
einer Spur aus den Spitzenwerten, die ohnehin auf dem Schirm sind, und nimmt sie heraus — als
Lücke, nicht als Ripple, damit das Bild synchron bleibt. Siehe [Ton](./audio.md).

## Wiedergabe und Export

Der Ton führt und das Bild folgt, weil Audio-Drift hörbar ist und ein ausgelassenes Bild nicht.
Bildraten bleiben bis zur letzten Division rational — 30000/1001 ist nicht 29,97, und ein Bildschritt
aus der Dezimalzahl läuft schon nach wenigen hundert Bildern vom Lineal weg.

<kbd>J</kbd>, <kbd>K</kbd> und <kbd>L</kbd> schalten rückwärts, halten an und schalten vorwärts, mit
jedem Druck in dieselbe Richtung eine Stufe höher: 1, 2, 4, 8. Diese Rate gehört dem Transport und
nicht dem Material — die Geschwindigkeit eines Clips samt Rampe bleibt davon unberührt und erreicht
den Export so, wie sie gebaut wurde. Die Vorschau lässt sich auf halbe oder viertel Auflösung
stellen, die billigste Leistungssteigerung bei großem Material, und sie erreicht die exportierte
Datei nie.

Material, das höher als 720 Pixel ist, bekommt einen **Proxy**: eine 720p-Kopie in H.264 mit einem
Keyframe pro Sekunde, einmal in einem eigenen Worker erzeugt und in OPFS neben dem Original unter
dessen Inhalts-Hash abgelegt. Die Vorschau dekodiert den Proxy, der Export das Original. Ein
dekodiertes Bild kostet Breite × Höhe × 4 Bytes, ganz gleich, worauf die Datei komprimiert war —
derselbe 256-MiB-Bildpuffer hält also 8 Bilder in 4K und 72 in 720p, und das ist der Unterschied
zwischen einem Scrubben, das seine Bilder im Speicher findet, und einem, das für jeden Schritt
zurück eine ganze Bildgruppe neu dekodiert. Ein Medium, dessen Proxy fehlt, geht genauso wie vor den
Proxies, und **Originale benutzen** in der Bibliothek schaltet die Vorschau jederzeit zurück auf das
Material.

Der Export schreibt MP4 mit H.264 und AAC oder WebM mit VP9 und Opus, in einem Worker, durch denselben
Compositor wie die Vorschau. Der Fortschritt wird gemeldet, und ein Abbruch stoppt wirklich. Ein
Browser, der das Bild eines Formats kodieren kann und seinen Ton nicht, schreibt eine stumme Datei,
statt auf halbem Weg zu scheitern — Chrome unter Linux ist genau dieser Browser.

Jeder Export in der CI wird an `ffprobe` und `ffmpeg` übergeben, die keine Zeile mit diesem Projekt
teilen, und das dekodierte Ergebnis Bild für Bild mit dem verglichen, was hineinging.

## Vorlagen

![Die Vorlagengalerie: dreizehn Karten in fünf Kategorien, jede ein aus der Vorlage selbst gerendertes Standbild](/editor-templates.webp)

Eine Vorlage ist derselbe Behälter wie ein Projekt mit einem Eintrag mehr — dieselben Bytes öffnen
sich also weiterhin als Projekt. Auswählen, den Assistenten beantworten, und heraus kommt ein ganz
normales bearbeitbares Projekt; es gibt keinen Vorlagenmodus, den man verlassen müsste.

**Dreizehn werden mitgeliefert, in fünf Kategorien, und keine einzige bringt ein Bild Video mit.** Eine
Vorlage ist ein Rezept, jede ist deshalb aus dem gebaut, was der Renderer allein aus einer Projektdatei
zeichnen kann: der Textgenerator mit Ein-, Aus- und Schleifenbewegung, Farbflächen und Verläufe, der
Vorlauf, die dreizehn Effekte, die fünf Übergänge, Masken und keyframebare Transformationen samt
Bewegungspfad. Das eigene Material kommt über die Platzhalter dazu. Zusammen benutzen sie jeden
Übergang, den der Renderer hat.

Die Karte ist kein gemaltes Ergebnis — sie wird **aus der Vorlage gerendert**, über dasselbe Backen,
das auch eine echte Antwort nimmt, mit einem grauen Platzhalter genau dort, wo Ihr Material landen
wird. Eine gemalte Karte könnte ein Aussehen zeigen, das der Renderer nie hervorbrächte, und niemand
fände es heraus, bevor er gewählt hat. Kostet ein kleines Bild pro Vorlage, eines nach dem anderen
gezeichnet, während die Galerie schon offen ist; ein Vorschauprojekt enthält nur Generatoren, es gibt
also nichts zu dekodieren und nichts aus dem Speicher zu lesen.

## Tasten

Im Überlaufmenü liegt eine Übersicht, und jede Zeile darauf ist eine Taste, die der Editor wirklich
beantwortet — `shortcut` in `Timeline.tsx`, `useTransportKeys` in `Transport.tsx` und `commandKey` in
`useCommandKeys.ts` sind die ganze Liste. Eine Übersicht, die eine Taste nennt, die niemand behandelt, schickt jemanden auf die Suche
nach einem Fehler in seiner Tastatur.

| Taste | Wirkung |
|---|---|
| <kbd>Leertaste</kbd> | abspielen oder anhalten, von überall außer einem Textfeld |
| <kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> | rückwärts spulen, halten, vorwärts spulen |
| <kbd>←</kbd> <kbd>→</kbd> | ein Bild zurück oder vor |
| <kbd>Umschalt</kbd> + <kbd>←</kbd> <kbd>→</kbd> | zum vorigen oder nächsten Marker |
| <kbd>Entf</kbd> | Auswahl löschen, Lücke bleibt |
| <kbd>Umschalt</kbd> + <kbd>Entf</kbd> | löschen und Lücke schließen |
| <kbd>Strg/Cmd</kbd> + <kbd>C</kbd> <kbd>X</kbd> <kbd>V</kbd> | kopieren, ausschneiden, am Playhead einfügen |
| <kbd>Strg/Cmd</kbd> + <kbd>G</kbd> | gruppieren; mit <kbd>Umschalt</kbd> aufheben |
| <kbd>N</kbd> | Auswahl zu einem Clip zusammenfassen |
| <kbd>M</kbd> | Marker am Playhead setzen |
| <kbd>S</kbd> | am Playhead schneiden |
| <kbd>Strg/Cmd</kbd> + <kbd>A</kbd> <kbd>D</kbd> | alle Clips auswählen; Auswahl verdoppeln |
| <kbd>Strg/Cmd</kbd> + <kbd>Z</kbd> <kbd>S</kbd> <kbd>O</kbd> <kbd>E</kbd> | rückgängig, speichern, öffnen, exportieren — mit <kbd>Umschalt</kbd> auf Z: wiederholen |
| <kbd>+</kbd> <kbd>-</kbd> <kbd>0</kbd> | näher heran, weiter weg, den ganzen Schnitt ins Fenster |
| <kbd>Home</kbd> <kbd>Ende</kbd> | an den Anfang oder das Ende des Schnitts |

Der Modifikator steht als Strg/Cmd da, statt je System aufgelöst zu werden: ein Browser kann nicht
fragen, welchen diese Tastatur hat — `navigator.platform` rät vom Betriebssystem, und das ist auf
einem Mac mit PC-Tastatur falsch und unter Linux ohnehin.

Die Projekttasten — rückgängig, wiederholen, speichern, öffnen, exportieren — lauschen am Fenster und
antworten, wo auch immer der Fokus steht; nur in einem Feld nicht, dessen eigenes
<kbd>Strg/Cmd</kbd>+<kbd>Z</kbd> unangetastet bleibt. Die Schnitt- und Ansichtstasten brauchen den
Fokus in der Zeitleiste. <kbd>N</kbd> und <kbd>M</kbd> tragen aus
einem Grund keinen Modifikator: jede Strg/Cmd-Kombination in ihrer Nähe hat der Browser selbst
belegt, und ein Kürzel, das der Browser frisst, ist kein Kürzel.

## Welches Layout, und wer entscheidet

Unter 768 px ist ein Telefon, unter 1280 ein Tablet, breiter ein Schreibtisch — aber nur, wenn der
Browser einen feinen Zeiger meldet. `(any-pointer: fine)` ist die einzige ehrliche Frage, die eine
Seite darüber stellen kann, womit gezeigt wird, und sie wird oft genug falsch beantwortet: ein
breiter Schirm ohne angeschlossene Maus bekommt das Tablet-Layout, was für ein Grafiktablett richtig
und für einen Schreibtisch, dessen Maus der Browser nicht sieht, falsch ist. Die Einstellung neben
dem Theme-Schalter sagt, welches Layout gilt, und lässt es festlegen; die Wahl wird gemerkt.

Es hat drei fehlschlagende Prüfungen gekostet, das zu finden. Der Anwendungs-Harness maß auf einem
1440-Pixel-Fenster ein zweispaltiges Tablet-Raster und meldete zutreffend, das Bild sei 216 Pixel
hoch — eine wahre Aussage über ein Layout, das niemand prüfen wollte. Jeder Lauf legt jetzt das
Layout fest, das er benennt.

## Auf dem Telefon

<div class="shots">
  <img src="/editor-phone.webp" alt="Videola auf einem Telefon: Vorschau und Transport oben, darunter eine Reiterleiste und die Zeitleiste">
  <img src="/editor-phone-library.webp" alt="Die Medienbibliothek auf einem Telefon, die Vorschau bleibt darüber sichtbar">
  <img src="/editor-phone-inspector.webp" alt="Die Eigenschaften auf einem Telefon, über einen eigenen Reiter erreichbar">
</div>

Unter 768 px wird der Editor einspaltig: Bild und Transport bleiben oben, eine Reiterleiste wechselt
zwischen Medien, Zeitleiste und Eigenschaften. Der Bereich, der gerade nicht dran ist, wird
**ausgehängt statt versteckt** — die Zeitleiste fenstert ihre Clips nach der Breite, die sie misst,
und ein `display: none`-Behälter misst null.

Sonst ändert sich nichts. Derselbe Zeigerpfad trägt den Finger, Trefferflächen wachsen auf 44 px,
sobald der Zeiger keine Maus ist, und alles, was am Schreibtisch erreichbar ist, ist es auch hier.
Der Import kann aus der Kamera oder der Galerie kommen.

Das Telefon-Layout wird auf einem echten 390×844-Viewport bei doppelter Pixeldichte über das
Devtools-Protokoll gefahren, weil Chrome unter Windows kein Fenster schmaler als 500 CSS-Pixel
zulässt — mit `--window-size` allein hätte man ein kleines Tablet vermessen und Telefon dazu gesagt.

## Für Agenten und Skripte

Der ganze Command-Katalog liegt über HTTP, für KI-Agenten über MCP und auf der Kommandozeile offen.
Der Katalog wird aus dem Rust-Enum erzeugt, ein neuer Command wird also zur Agentenfähigkeit, ohne
dass jemand eine Liste pflegt.

Ein Agent kann außerdem **sehen, was er getan hat**: `project_getFrame` rendert ein Standbild zu
jedem Zeitpunkt, `project_getAudioPeaks` liefert die gemischte Wellenform. Das Standbild entsteht in
demselben Kern, derselben Zeichenliste und demselben Compositor, mit denen der Editor zeichnet — es
kann also nichts zeigen, was der Editor nicht zeigen würde.

Siehe [Schnittstelle und MCP](/de/guide/api-and-mcp).

## Selbst hosten

Ein Node-Prozess liefert Editor, HTTP-Schnittstelle, MCP-Server und CLI. Er verweigert den Start auf
einer öffentlichen Adresse ohne Token und sagt warum. Siehe
[Bauen und Ausliefern](/de/guide/building-and-releasing).

<style scoped>
.shots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin: 24px 0;
}
.shots img {
  width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}
</style>
