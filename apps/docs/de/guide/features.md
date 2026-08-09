# Was Videola kann

Ein Rundgang durch den Editor, wie er dasteht. Alles hier ist gebaut und geprüft; das
[Architektur-Kapitel](/de/guide/architecture) hält Entscheidung für Entscheidung fest, was
stattdessen geplant ist.

## Die Oberfläche

![Videola am Schreibtisch: Medienbibliothek links, ein dekodiertes Bild in der Vorschau, Eigenschaften rechts, darunter die Zeitleiste und am Boden das Mischpult](/editor-desktop.webp)

Vier Bereiche, und das Bild ist der größte davon — dafür gibt es eine Prüfung, weil eine Rasterzeile,
die mit ihrem Inhalt wächst, die Leinwand schon zweimal auf Briefmarkengröße geschrumpft hatte,
ohne dass es jemandem auffiel.

**Die Bibliothek** zeigt, was im Projekt liegt: Länge, Maße in Pixeln, Abtastrate und ein
Vorschaubild, das aus der Datei selbst dekodiert wurde. **Die Eigenschaften** zeigen, was am
gewählten Clip einstellbar ist, und lassen jeden Wert über die Zeit animieren. **Die Zeitleiste** ist
der Ort der Arbeit. **Das Mischpult** trägt einen Streifen je Spur und einen Master.

## Schneiden

| Geste | Wirkung |
|---|---|
| Klick auf einen Clip | wählt ihn aus; mit Modifikatortaste mehrere |
| Ziehen in der Mitte | verschiebt ihn, auch über Spuren hinweg |
| Ziehen an einer Kante | trimmt, rippelt oder rollt, je nach Kantenmodus |
| Ziehen im Slip- oder Slide-Modus | schiebt die Quelle unter dem Clip, oder den Clip zwischen seinen Nachbarn |
| Ziehen im Lineal | scrubbt |
| Zwei Zeiger | zoomen über die Abstandsänderung |
| Langes Drücken | öffnet das Kontextmenü |

Ripple-Löschen schließt die Lücke, die es hinterlässt. Gruppen bewegen sich gemeinsam. Ausschneiden,
Kopieren und Einfügen arbeiten auf ganzen Clips, Marker sitzen im Lineal, und eine Auswahl lässt sich
zu einem **Compound-Clip** zusammenfassen — dass sich das Bild dabei nicht ändert, ist gegen den
ganzen Bildpuffer, die Zeichenliste an sechzehn Zeitpunkten und den Tonlauf Sample für Sample
nachgewiesen.

Alles läuft über Pointer Events, damit Maus, Stift und Finger denselben Weg nehmen, und ein ganzer
Zug über zweihundert Bewegungen ist **ein** Undo-Schritt.

## Effekte, Übergänge und Text

Helligkeit, Kontrast, Sättigung, Farbtemperatur, Vignette, Weichzeichnen, Schärfen und
Chroma-Keying. Überblendung, Wischen, Schieben, Zoom und Blende über eine Farbe. Rechteckige und
elliptische Masken mit weicher Kante und Invertierung; zwei Masken in einer Kette schneiden sich.
Ein Textgenerator mit Gestaltung sowie Ein-, Aus- und Schleifenanimation.

Jeder Parameter ist keyframebar — auch Position, Skalierung, Drehung und Deckkraft eines Clips — und
eine `position`-Spur macht aus einer Reihe von Schlüsseln einen **Bewegungspfad**, der als Kurve
interpoliert wird statt als Ecken. Die Interpolation geschieht im Rust-Kern, damit Vorschau und
Export unmöglich verschiedene Werte lesen.

Bearbeitet werden Keyframes in einer Spur unter den Spuren, auf der Zeitachse der Zeitleiste
selbst: ein Druck wählt einen aus, ein Zug verschiebt ihn, <kbd>Entf</kbd> oder der Knopf über der
Spur löscht ihn, und eine Auswahl bestimmt den Verlauf der Strecke danach — linear, halten oder
weich. Ein Zug ist ein Undo-Schritt, und alles funktioniert mit dem Finger genauso wie mit der
Maus. Einen Kurveneditor gibt es noch nicht: ein Projekt, das Bezier-Anfasser trägt, behält sie und
behält seine Form, aber ziehen kann sie hier niemand — siehe
[Schneiden](./editing.md#die-keyframe-spur).

Die Wirkung jedes Effekts wird an echten Pixeln eines echten Treibers gemessen: 258 solcher
Prüfungen laufen bei jedem Bau. Ein zu einem Drittel gedeckter Pixel über Rot muss **81** ergeben —
das liefert premultipliziertes Alpha; die naheliegende Antwort 255 fällt durch.

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

Die Lautheit wird nach EBU R128 gemessen und gegen die Tech-3341-Fälle geprüft. Der Regler des
Limiters heißt **Schwelle**, nicht Ceiling: der Kompressor des Browsers legt eigenen Ausgleichspegel
drauf, ist also keine Brickwall — und die Doku sagt das, statt etwas anderes anzudeuten.

## Wiedergabe und Export

Der Ton führt und das Bild folgt, weil Audio-Drift hörbar ist und ein ausgelassenes Bild nicht.
Bildraten bleiben bis zur letzten Division rational — 30000/1001 ist nicht 29,97, und ein Bildschritt
aus der Dezimalzahl läuft schon nach wenigen hundert Bildern vom Lineal weg.

Der Export schreibt MP4 mit H.264 und AAC oder WebM mit VP9 und Opus, in einem Worker, durch denselben
Compositor wie die Vorschau. Der Fortschritt wird gemeldet, und ein Abbruch stoppt wirklich. Ein
Browser, der das Bild eines Formats kodieren kann und seinen Ton nicht, schreibt eine stumme Datei,
statt auf halbem Weg zu scheitern — Chrome unter Linux ist genau dieser Browser.

Jeder Export in der CI wird an `ffprobe` und `ffmpeg` übergeben, die keine Zeile mit diesem Projekt
teilen, und das dekodierte Ergebnis Bild für Bild mit dem verglichen, was hineinging.

## Vorlagen

![Galerie und eine gebackene Vorlage: drei Clips auf der Zeitleiste, jeder so lang wie die Vorlage es vorgibt, nicht wie die Datei](/editor-templates.webp)

Eine Vorlage ist derselbe Behälter wie ein Projekt mit einem Eintrag mehr — dieselben Bytes öffnen
sich also weiterhin als Projekt. Auswählen, den Assistenten beantworten, und heraus kommt ein ganz
normales bearbeitbares Projekt; es gibt keinen Vorlagenmodus, den man verlassen müsste. Die Karte in
der Galerie zeichnet die Zeitleiste, die die Vorlage bauen wird, aus deren eigenem Projekt gelesen —
statt eines Bildes, das ein Ergebnis behauptet.

Vier werden mitgeliefert, keine davon bringt Material mit, und jede zeigt etwas, das wirklich
funktioniert, statt etwas, das sich auf einem Schirmbild gut macht.

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
