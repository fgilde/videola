# Ton

Der Ton führt, das Bild folgt. Die vergangene Zeit wird aus dem Audio-Kontext gelesen, weil ein
Versatz im Ton hörbar ist und ein ausgelassenes Bild nicht — jede Position, die der Editor anzeigt,
kommt über die Uhr aus `AudioContext.currentTime`, und nichts leitet Projektzeit aus einem
Dekoder-Zeitstempel ab.

## Der Graph

```
Clip → Puffer-Quelle → Clip-Pegel (Lautstärke, Blenden)
     → Spur-Bus (Pegel für Lautstärke/Stumm/Solo → Stereo-Panorama)
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

Ein Streifen je Spur, in der Reihenfolge, in der die Zeitleiste die Spuren stapelt, und nicht in der,
in der der Kern sie hält — `tracks[0]` ist unten im Stapel, und ein Mischpult in dieser Reihenfolge
setzte den Streifen der obersten Spur ans Ende.

Jeder Streifen trägt einen Pegelregler, ein Panorama von links über die Mitte nach rechts sowie die
Knöpfe für Stumm und Solo. Ein Zug am Regler ist ein Schritt in der Historie, nicht einer je Pixel.

## Was es noch nicht gibt

Benannt statt angedeutet, denn ein Bedienelement, das nichts tut, ist schlimmer als keines:

- **EQ und Kompressor auf dem Spur-Bus.** `Track.effects` steht im Modell und wird serialisiert, aber
  `effect.add` und `effect.setParam` sprechen nur Clips an, es gibt also noch keinen Ort, an dem
  Bandeinstellungen bleiben könnten. Die Tonseite ist dann kurz: `BiquadFilterNode` und
  `DynamicsCompressorNode` bringt die Plattform mit.
- **Ein Summenregler.** `project.master.volume` steht im Modell und der Graph beachtet ihn, aber kein
  Kommando schreibt ihn.
- **Pegelanzeigen im Betrieb.** Aussteuerung und Pegelreduktion brauchen je Bus eine Analyse pro Bild.
- **Ducking, Rauschreduktion, Beat-Erkennung, Panorama über Stereo hinaus.**
- **True Peak (dBTP).** Der Spitzenwert ist ein Abtastwert-Spitzenwert; ein Zwischenwert-Spitzenwert
  braucht Überabtastung.
- **Die Lippensynchronität ist nirgends gemessen.** Ein Browser ohne Bildschirm hat keine Tonausgabe,
  der Versatz zwischen Bild und Ton ist also erschlossen und nicht beobachtet.
