# Ton

Der Ton führt, das Bild folgt. Die vergangene Zeit wird aus dem Audio-Kontext gelesen, weil ein
Versatz im Ton hörbar ist und ein ausgelassenes Bild nicht — jede Position, die der Editor anzeigt,
kommt über die Uhr aus `AudioContext.currentTime`, und nichts leitet Projektzeit aus einem
Dekoder-Zeitstempel ab.

## Der Graph

```
Clip → Puffer-Quelle → Clip-Pegel (Lautstärke, Blenden)
     → Spur-Inserts (Equalizer, Kompressor, …)
     → Spur-Bus (Pegel für Lautstärke/Stumm/Solo → Stereo-Panorama)
     → Summen-Inserts (die Mastering-Kette)
     → Summenpegel
     → Ausgang
```

Jeder Clip, dem die Bibliothek Kanäle zuschreibt, bekommt eine Stimme — gleich auf welcher Art Spur er
liegt: eine Videospur trägt Clips, deren Medium eine Tonspur hat, und auf einer Tonspur kann eine
Videodatei liegen, die jemand dort abgelegt hat. Nur der Bibliothekseintrag weiß es.

Ein Medium, das sich nicht dekodieren lässt, kostet seinen eigenen Clip den Ton und sonst nichts.
Eine Lücke macht nicht die ganze Zeitleiste stumm.

### Lautstärke, Stumm und Solo

Spurpegel, Stumm und Solo wirken auf den Spur-Bus und nicht auf die einzelnen Clip-Pegel. Damit
bleibt eine Spur, die mitten in einer Blende stummgeschaltet wird, stumm, und die Blendenautomation
darunter bleibt unangetastet.

**Stumm schlägt Solo.** Eine Spur, die stumm *und* solo ist, bleibt stumm, und sie auf Solo zu setzen
stummt trotzdem jede Spur, die nicht solo ist. Die beiden Knöpfe im Mischpult sind aus demselben
Grund voneinander unabhängig: der eine darf beim Drücken den anderen nicht stillschweigend löschen.

### Effekte auf einem Bus

Eine Spur und das Projekt selbst tragen je eine Effektkette. Angesprochen wird sie mit denselben
Kommandos `effect.add` und `effect.setParam` wie die Kette eines Clips — nur auf `on.track(id)` oder
`on.project` gerichtet statt auf `on.clip(id)`.

Drei gibt es, und alle drei sind native Web-Audio-Knoten:

| Effekt | Knoten | Regler |
| --- | --- | --- |
| Equalizer | `BiquadFilterNode`, Glockenfilter | Frequenz, Anhebung, Güte |
| Kompressor | `DynamicsCompressorNode` | Schwelle, Verhältnis, Ansprechzeit, Rückfallzeit |
| Limiter | `DynamicsCompressorNode`, Verhältnis 20, ohne Kniebereich | Schwelle |

**Inserts liegen vor dem Regler**, so wie ein Pult sie verdrahtet. Der Regler fährt dann auf einem
Signal, das der Kompressor schon eingeebnet hat: ihn herunterzuziehen ändert, wie laut die Spur ist,
und nicht, was der Kompressor mit ihr macht. Dieselbe Regel auf der Summe lässt den Summenregler das
Letzte vor dem Ausgang sein, und dafür ist ein Regler da.

Einen Effekttyp, für den dieser Stand keinen Knoten hat — eine Unschärfe, die jemand auf einem Bus
abgelegt hat, oder ein Typ aus einer neueren Fassung —, überspringt die Kette, und der Rest klingt
weiter. Die Kette zu verweigern kostete die ganze Spur ihren Ton wegen eines einzigen Eintrags. Einen
abgeschalteten Effekt überspringt sie genauso.

Ketten sind Folgen, keine Mengen: ein Limiter nach einer Anhebung fängt ein, was die Anhebung
erzeugt hat — dieselben zwei andersherum heben an, was der Limiter schon niedergehalten hat.

::: warning Was die Schwelle des Limiters nicht ist
`DynamicsCompressorNode` bringt eine eigene Nachverstärkung mit. Der Pegel, der herauskommt, liegt
deshalb über der Schwelle und nicht auf ihr — gemessen kommt bei Verhältnis 20 und ohne Kniebereich
ein vollausgesteuerter Ton mit Schwelle −12 bei etwa −4 dBFS heraus. Der Regler heißt darum Schwelle
und nicht Deckel: was er tut, ist echt und einsinnig (weiter herunter heißt leiser und gleichmäßiger),
aber es ist keine harte Obergrenze, und ihn so zu nennen hieße etwas zu benennen, was der Knoten nicht
liefert.
:::

### Automation auf einem Bus

Ein Bus-Parameter nimmt Keyframes genau wie der eines Clips: ein automatisierter Filterschwenk oder
ein Ducking-Verlauf ist dieselbe Mechanik wie eine animierte Unschärfe. Anders als bei einem Clip
lässt er sich setzen, wo der Abspielkopf gerade steht — eine Spur und eine Mastering-Kette haben kein
Clip-Fenster, aus dem man fallen könnte.

Aufgelöst werden die Keyframes **im Kern und sonst nirgends.** Der Graph liest die Zeiten der Ecken,
um zu entscheiden, *wann* er fragt, fragt dann `Document.effectParamsAt` nach dem Wert an jeder von
ihnen und übergibt das Ergebnis derselben Planung, die auch die Blenden benutzen. Zwischen zwei Ecken
fragt er an einigen Zwischenstellen noch einmal: eine Kurve, die der Kern biegt, wird so als Streckenzug
durch dessen eigene Werte nachgefahren, statt zur Geraden zwischen ihren Enden gestreckt zu werden.
Einer linearen Strecke schadet das nicht — jede zusätzliche Abtastung landet wieder auf der Geraden,
die sie ohnehin hatte. Ein gehaltener Keyframe springt statt zu gleiten, weil der Graph zusätzlich
einen Flick vor jeder Ecke fragt.

Der Satz, der daran zählt: Vorschau, Export, der Renderer auf dem Server und die Lautheitsmessung
bekommen alle denselben Auflöser und denselben `AudioGraph`. Es gibt nirgends eine zweite
Interpolation, über die zwei von ihnen uneins werden könnten.

### Blenden

Eine Blende ist Automation, keine Rechnung pro Bild. Die Hüllkurve ist eine Liste von Ecken, und der
Audio-Thread interpoliert zwischen ihnen pro Abtastwert — ein Pegel, der einmal pro Bild geschrieben
wird, ist eine Treppe, und eine Treppe in einer Amplitude ist ein Knacken.

Eine Wiedergabe, die mitten in einer Blende einsetzt, beginnt beim interpolierten Wert und plant nur
noch, was vor ihr liegt. Das wiegt schwerer, als es klingt: Automationszeiten sind absolut und dürfen
nicht negativ werden, und ein Clip, dessen Blende vor der Wiedergabe begann, ist der Regelfall und
nicht der Randfall.

Trimmen und Teilen fassen die Blenden nicht an, also ist ein Clip, der kürzer ist als seine eigenen
Blenden, erreichbar, ohne dass jemand einen Blendengriff angefasst hätte. Beide Blenden werden dann
mit demselben Faktor verkleinert, behalten also ihr Verhältnis, und die Hüllkurve erreicht ihren
Höchstwert dort, wo die beiden sich gekreuzt hätten.

### Rückwärts laufende Clips

Ein `AudioBufferSourceNode` kennt keine negative Abspielrate, also spielt ein umgekehrter Clip eine
umgedrehte Kopie seines eigenen Bereichs, die beim Vorbereiten einmal entsteht. Die
Versatz-Arithmetik braucht dafür keinen Sonderfall: eine Position `p` im Clip verbraucht `p × Rate`
Sekunden Quelle, vom Ausspielpunkt zurückgerechnet, und das ist dasselbe `p × Rate` vom Anfang der
Kopie vorwärts.

### Geschwindigkeit

Versatz und Dauer werden in der Zeit des Puffers gemessen, und die läuft mit der Abspielrate relativ
zur Zeitleiste — ein Clip mit halber Geschwindigkeit verbraucht eine halbe Sekunde Quelle je Sekunde
Zeitleiste.

## Wellenformen

Die Zeitleiste zeichnet je Clip einen Streifen aus den Abtastwerten, die der Graph für die Wiedergabe
ohnehin schon dekodiert hat. Es gibt keinen zweiten Dekodierlauf und keinen zweiten Zwischenspeicher,
also können Gesehenes und Gehörtes nicht auseinanderlaufen — ein umgekehrter Clip zeigt sich so, wie
er spielt.

Jeder Bucket hält das Minimum und das Maximum der Abtastwerte unter ihm, nicht ihren Mittelwert: ein
Mittelwert macht aus einem Snare-Schlag eine Delle und aus einer Passage Sprache ein graues Band. Der
Streifen wird in eigenen Koordinaten gezeichnet und per `viewBox` auf den Clip gedehnt, also
überlebt er jede Zoomstufe, ohne neu gebaut zu werden.

Ein Clip ohne Spitzenwerte bekommt gar keinen Streifen. Eine flache Linie wäre ein Versprechen auf
ein Signal, das noch keiner gelesen hat.

## Lautheit

Videola misst **integrierte Lautheit nach ITU-R BS.1770 / EBU R128**, in LUFS. Die Koeffizienten der
K-Bewertung werden für die Abtastrate des Projekts aus den Filterformeln neu gerechnet und nicht aus
der 48-kHz-Tabelle des Standards übernommen — damit misst ein Projekt mit 44,1 kHz genauso richtig
wie eines mit 48 kHz.

Beide Tore greifen: Blöcke unter −70 LUFS absolut, danach Blöcke mehr als 10 LU unter dem Mittel
dessen, was übrig blieb. Das ist es, was verhindert, dass die Pausen einer Dialogspur die Anzeige
nach unten ziehen.

Gemessen wird das **Programm, nicht das Material**. Die Zahl kommt aus einem echten Offline-Lauf des
echten Graphen, also stecken Clip-Pegel, Blenden, Spur-Busse, Stumm, Solo und der Summenpegel darin —
weil sie alle die Zahl verändern.

Eine Messung rendert die ganze Zeitleiste, sie läuft also, wenn im Mischpult danach gefragt wird, und
nie pro Bild.

::: tip Was die Zahl bedeutet
−23 LUFS ist der Zielwert für die Ausspielung nach EBU R128 im Rundfunk. Streaming-Plattformen
normalisieren auf etwa −14 bis −16 LUFS. Ein Programm, das bei −23 gemessen wird, dreht eine
Plattform mit Ziel −14 wieder hoch — lauter zu mastern als der Zielwert bringt also nichts außer
verlorenem Aussteuerungsspielraum.
:::

## Das Mischpult

Das Pult wird im Transport aufgeklappt, neben dem Schalter für die Messgeräte, und es beginnt
zugeklappt. Ein Streifen aus zwei beschrifteten Reglern über Stumm, Solo und der Effektauswahl ist
hundertneunzig Pixel hoch; stand er da, ob jemand mischte oder nicht, und waren die Messgeräte
ebenfalls offen, blieben dem Bild sechzig von siebenhundert Pixeln. Wer das Bild aufgibt und wann,
ist eine Entscheidung und keine Voreinstellung. Auf dem Telefon liegt das Pult stattdessen hinter
einem der Reiter.

Ein Streifen je Spur, in der Reihenfolge, in der die Zeitleiste die Spuren stapelt, und nicht in der,
in der der Kern sie hält — `tracks[0]` ist unten im Stapel, und ein Mischpult in dieser Reihenfolge
setzte den Streifen der obersten Spur ans Ende.

Jeder Streifen trägt eine Pegelanzeige, einen Pegelregler, ein Panorama von links über die Mitte
nach rechts sowie die Knöpfe für Stumm und Solo. Ein Zug am Regler ist ein Schritt in der
Historie, nicht einer je Pixel. Darunter stehen die beiden Aktionen, die die Abtastwerte brauchen
und nicht nur das Projekt: das Auswahlfeld, das diese Spur unter einer anderen absenkt, und der
Knopf, der die Stille aus ihr herausschneidet.

Darunter liegt die Insert-Kette des Streifens: ein Knopf je Effekt, für den dieser Stand einen Klang
hat, und sobald einer hinzugefügt ist, eine Zeile je Parameter mit denselben Keyframe-Bedienelementen
wie im Inspektor. Eine Zeile zeigt den Wert, den der **Kern** für den Abspielkopf aufgelöst hat,
geklemmt auf den Bereich, den der Effekt angibt — dieselbe Klemme, die der Graph anwendet, bevor die
Zahl an einem Filter ankommt. Was dasteht, ist also das, was zu hören ist.

Ganz rechts, durch einen Rahmen abgesetzt, steht der **Summenzug**: der Regler des Projekts und die
Mastering-Kette. Alles links davon läuft dort hinein.

## Tiefensperre und Höhensperre

Zwei Filter mit je einem Regler, auf derselben Insert-Kette wie der Equalizer.

Keiner von beiden ist eine Rauschunterdrückung, und einen so zu nennen wäre gelogen: nichts hier
trennt eine Stimme von einem Geräusch, das ihr Band teilt. Sie nehmen ein Band weg, in dem nichts
steht, was jemand will — Rumpeln, Wind und Netzbrumm unter einer Stimme, Bandrauschen oder ein
Lüfter darüber — und bei einer Außenaufnahme ist das das meiste, was daran nicht stimmt.

Die Tiefensperre steht voreingestellt auf 80 Hz, unter dem tiefsten Ton einer Sprechstimme; die
Höhensperre auf 12 kHz, über den Konsonanten und mitten im Rauschen. Einen Güte-Regler gibt es
nicht: die Güte eines Biquads an seiner Grenzfrequenz ist eine Resonanz, und ein resonanter
Hochpass auf einer Stimme ist ein Heulen bei genau der eingestellten Frequenz.

Beide sind durch den echten Renderer an zwei Tönen in einem Signal gemessen, keiner kann also
bestehen, indem er still wird: bei 1 kHz Grenzfrequenz lässt die Tiefensperre den 200-Hz-Ton unter
einem Zehntel seiner Stärke und den 6-kHz-Ton über sieben Zehnteln, und die Höhensperre dasselbe
andersherum.

## Beats

Das Metronom-Symbol auf einem Streifen setzt auf jeden Schlag dieser Spur einen Marker.

Ein Beat ist hier ein **Anstieg**, kein Pegel: die Differenz zwischen einem Hüllkurven-Eimer und dem
vorigen, und nur, wo sie positiv ist. Eine laute Passage ist kein Beat und eine leise steckt voller
davon — deshalb kann der Pegel selbst nicht das Signal sein. Die Schwelle wandert mit der Musik, als
Mittelwert über die umliegende halbe Sekunde mal einem Faktor, also werden in der leisen Hälfte einer
Spur dieselben Schläge gefunden wie in der lauten; eine feste Schwelle kann das nicht. Ein Anstieg
muss außerdem größer sein als seine unmittelbaren Nachbarn, damit ein Schlag ein Beat ist und nicht
die drei oder vier Eimer, über die sein Einschwingen verteilt ist.

Gelesen wird die Hüllkurve, die der Wellenform-Streifen ohnehin hält; das kostet ein paar Durchläufe
über ein paar tausend Fließkommazahlen statt eines Dekodiervorgangs. Der Schritt vom Eimer zur Zeit
läuft über dieselbe Umkehrung wie die Stille-Erkennung, ein Clip auf einer Geschwindigkeitsrampe
bekommt seine Beats also dort, wo sie zu hören sind.

Marker und keine Schnitte, mit Absicht. Wo der Schlag fällt, ist ein Vorschlag zum Schneiden — die
Zeitleiste rastet an Markern ein — und hundert ungefragte Schnitte wären hundert Clips, die einzeln
zurückzunehmen sind. Der ganze Tastendruck ist ein Schritt in der Historie, gleich was er gefunden
hat.

Ein gleichbleibender Ton hat keine Einsätze und liefert nichts. Das ist die richtige Antwort, kein
Fehlschlag.

## Pegelanzeigen

Jeder Streifen trägt eine Pegelanzeige, die Spurstreifen wie der Summenzug, und jede davon ist ein
echter Abgriff **in** der Signalführung und kein Balken daneben: ein `AnalyserNode` sitzt in der
Leitung, denn ein Knoten ohne Weg zum Ausgang wird gar nicht verarbeitet, und eine seitlich
angehängte Anzeige zeigte genau so lange null, wie niemand hinsieht. Ein Analyser reicht seinen
Eingang unverändert durch — deshalb rendert der Export weiterhin abtastwertgleich zur Wiedergabe.

Der Abgriff einer Spur sitzt **hinter** ihrem Regler und ihrem Panorama, ein Streifen zeigt also, was
diese Spur sendet, und nicht, was ihre Clips waren, bevor jemand am Pult war. Stumm und Solo liegen
davor auf dem Bus-Pegel, eine stummgeschaltete Spur zeigt also Stille.

Drei Zahlen je Balken, alle in dBFS:

- **Spitze** — der lauteste Abtastwert im Fenster, gezeichnet als blasser Teil des Balkens. Sie sagt,
  ob etwas übersteuert hat.
- **Effektivwert** — der quadratische Mittelwert, gezeichnet als voller Balken. Ihn liest das Auge
  als Lautstärke: die Spitze eines Sinus steht 3 dB über seinem eigenen Effektivwert, die einer
  Rechteckschwingung nicht.
- **Haltemarke** — eine Marke auf der zuletzt größten Spitze, die mit 20 dB je Sekunde fällt. Eine
  Transiente über einen Puffer sieht ohne sie niemand.

Der Balken ist linear in **Dezibel** über 60 dB, nicht in der Amplitude: die halbe Breite sind 30 dB
weniger. Genau das macht eine Anzeige lesbar — das leise Ende bekommt so viel Platz wie das laute.
Die letzten sechs Dezibel färben den Balken rot.

Das ganze Pult wird einmal je Bild gelesen, und nichts davon läuft über React: die Schleife schreibt
drei Längen und eine Klasse direkt auf die Elemente. Ein Mischpult mit zehn Streifen kostet je
Streifen und Bild ein `getFloatTimeDomainData` über ein Fenster von 2048 Werten und kein einziges
Neuzeichnen.

::: warning Was nicht gemessen ist
Ein Browser ohne Bildschirm hat keine Tonausgabe. Dass die Anzeigen **im Betrieb ausschlagen**, ist
also das eine, was die Tests nicht sehen. Gemessen ist alles beidseits davon: die Rechnung an echt
gerenderten Abtastwerten und die Abgriffe selbst an einem echten Offline-Lauf — eine Spur mit halbem
Pegel zeigt durch den echten `AnalyserNode` −6,02 dBFS.
:::

## Ein Projekt auf einen Zielwert bringen

Der Summenzug des Mischpults bietet die drei Zielwerte, nach denen wirklich gefragt wird — −14 LUFS
fürs Streaming, −16 für einen Podcast, −23 für den Rundfunk — und einen Knopf, der den Summenregler
so weit bewegt, bis das Programm dort gemessen wird.

**Danach wird erneut gemessen.** Was anschließend in der Anzeige steht, ist ein Messwert und nie der
Zielwert, nach dem gefragt wurde. Das zählt in den Fällen, in denen der Zielwert nicht erreichbar
ist: ein Programm, das schon an der Obergrenze 4 des Reglers steht, oder ein stummes, sagt das dann
mit einer Zahl, statt einen Erfolg zu behaupten.

::: tip Warum ein Durchgang reicht und trotzdem nachgemessen wird
Die Befürchtung ist die richtige: ein Kompressor oder ein Limiter ist keine Verstärkung, er hört auf
zu begrenzen, sobald sein Eingang leiser wird, und `DynamicsCompressorNode` legt eigenen
Ausgleichspegel darauf. Sie greift hier nur nicht, und das liegt an der Verschaltung und nicht am
Knoten — **Inserts sitzen vor dem Fader**, die Mastering-Kette sieht bei jeder Reglerstellung
dasselbe Signal, und der Regler ist eine reine Verstärkung dahinter. Gemessen, mit einem Limiter
zwanzig Dezibel unter dem Material: ein Durchgang.

Daraus folgt nicht, dass man der Rechnung glauben dürfte. Die Tore von R128 hängen vom Pegel ab —
ein verschobenes Programm hat andere Blöcke, die das absolute Tor bei −70 LUFS überschreiten. Was
zurückkommt, ist also immer ein Messwert.
:::

## Ducking

Die Musik absenken, solange jemand spricht. Die Sprachspur im Auswahlfeld auf dem Streifen der
Musikspur wählen, und die Musik geht herunter, solange die Sprache liegt, und danach wieder hoch.

**Es entstehen Keyframes, keine unsichtbare Automatik.** Der Musikbus bekommt einen Insert
`Verstärkung` und darauf eine Kurve: vier Ecken je Phrase — offen, unten, unten, offen — die Senkung
eine Viertelsekunde **vor** dem Beginn der Phrase, denn ein Bett, das erst auf der ersten Silbe zu
fallen beginnt, hat sie schon zugedeckt, und die Rückkehr eine halbe Sekunde danach. Zwei Phrasen so
dicht beieinander, dass die Rückkehr noch stiege, wenn die nächste Senkung beginnt, lassen das Bett
dazwischen unten — so macht es ein Pult, und so hätte es ein Cutter von Hand gezeichnet.

Weil es Keyframes sind, gehört danach alles Ihnen: jede Ecke ist ein Wert in einer Zeile des
Streifens, mit derselben Raute, demselben Vor und Zurück und derselben Interpolation, die der
Inspektor jedem anderen Parameter gibt. Ein zweites Ducking über eine neu geschnittene Sprachspur
ersetzt die Kurve, statt eine zweite darüberzulegen, und das ganze Ducking geht in einem Schritt
zurück.

::: tip Warum kein Seitenketten-Kompressor
Weil die Web-Audio-API keine Seitenkette hat. `DynamicsCompressorNode` nimmt einen Eingang, und es
gibt keinen zweiten, über den er gesteuert werden könnte — eine Seitenkette müsste hier aus einem
Analyser und einem je Bild geschriebenen Pegel gebaut werden, also aus genau der Treppe, deretwegen
es jede andere Hüllkurve in diesem Graphen gibt. Die Keyframes kosten nichts obendrauf: die
Insert-Kette automatisiert jeden Parameter, den sie hat, ohnehin abtastwertweise auf dem Tonfaden,
und Vorschau wie Export lesen dieselbe Spur davon.
:::

Der Insert sitzt wie jeder andere vor dem Fader, Ducking und der Regler des Streifens multiplizieren
sich also, statt sich zu bekämpfen — und ebenso Ducking und die Blende eines Clips, die weiter oben
auf dem Clip-Pegel liegt. Gemessen: ein Bett mit halber Verstärkung unter einer Blende bei der Hälfte
steht bei einem Viertel.

## Stille finden und schneiden

Der Knopf auf einem Spurstreifen findet die Pausen darin und nimmt sie heraus; wo eine war, bleibt
eine Lücke.

Die Erkennung liest **die Spitzenwerte, die die Zeitleiste ohnehin zeichnet**, in einer Auflösung,
die für diese Aufgabe fein genug ist — die Abtastwerte wurden für die Wiedergabe dekodiert und für
den Streifen einmal durchgesehen, das hier ist also ein dritter Lauf über ein paar tausend Zahlen und
nicht über ein paar Millionen. Ein Bucket zählt als klingend, wenn er −40 dBFS erreicht; Lücken unter
250 ms liegen innerhalb einer Phrase und nicht zwischen zweien und werden geschlossen; was danach
übrig und kürzer als 150 ms ist, war ein Knacken und keine Phrase; und jede Phrase wächst an beiden
Enden um eine Zehntelsekunde, damit der Schnitt in die Pause fällt und nicht auf die erste Silbe.

Ein Bucket wird zu einem Zeitpunkt, indem die Quellenabbildung des Kerns umgekehrt wird, nicht indem
eine Dauer geteilt wird. Das macht es für einen Clip richtig, der nicht geradeaus läuft: unter einer
Geschwindigkeitskurve liegen die Spitzenwerte über dem **Puffer**, und der ist zur Projektzeit gar
nicht proportional. Ein rückwärts laufender Clip braucht keinen eigenen Fall — sein Puffer ist
bereits die umgekehrte Kopie, die der Graph spielt.

::: warning Eine Lücke, kein Ripple
Der Schnitt lässt alles dahinter stehen, wo es steht. Ein Ripple zöge den Rest dieser Spur nach vorn
und ließe jede andere Spur — vor allem das Bild, zu dem die Stimme gehört — stehen. Stille zu
entfernen lohnt sich; Stille so zu entfernen, dass der Ton von den Lippen wandert, nicht. Die
Zeitleiste danach zu schließen ist ein Ripple-Löschen auf den Lücken, und das ist ein Befehl, den man
sieht und zurücknehmen kann.
:::

## Was es noch nicht gibt

Benannt statt angedeutet, denn ein Bedienelement, das nichts tut, ist schlimmer als keines:

- **Andere Filterformen als das Glockenfilter.** Der Equalizer kann kein Hoch- oder Tiefpass sein,
  denn eine Filterform ist eine Auswahl, und die Effektbeschreibungen tragen nur Fließkommazahlen.
  `ParamValue` kennt bereits eine Auswahl-Art; die Kuhschwanzfilter kommen mit dem Bedienelement, das
  eine solche bearbeiten kann.
- **Anzeige der Pegelreduktion.** Die Streifen zeigen, was ein Bus sendet; wie stark sein Kompressor
  arbeitet, ist eine zweite Anzeige, und `DynamicsCompressorNode.reduction` wäre ihre Quelle.
- **Rauschreduktion, Beat-Erkennung, Panorama über Stereo hinaus.**
- **Bus-Automation in der Keyframe-Spur der Zeitleiste.** Die Ecken eines Duckings lassen sich auf
  dem Streifen bearbeiten, der sie geschrieben hat, mit denselben Bedienelementen wie im Inspektor;
  die Spur unter einem Clip zeichnet nur Clip-Keyframes, und die einer Spur zu zeichnen hieße, einer
  Lane eine Identität zu geben, die kein Clip ist.
- **True Peak (dBTP).** Der Spitzenwert ist ein Abtastwert-Spitzenwert; ein Zwischenwert-Spitzenwert
  braucht Überabtastung.
- **Die Lippensynchronität ist nirgends gemessen.** Ein Browser ohne Bildschirm hat keine Tonausgabe,
  der Versatz zwischen Bild und Ton ist also erschlossen und nicht beobachtet.
