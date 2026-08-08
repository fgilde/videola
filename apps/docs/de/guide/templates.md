# Vorlagen

**Gebaut.** Eine Galerie, ein Assistent, vier mitgelieferte Vorlagen und eine `.videolat`-Datei, die
man weitergeben kann. Was am Ende herauskommt, ist ein gewöhnliches Projekt: derselbe Editor,
dieselben Commands, derselbe Undo-Stapel. Es gibt keinen Vorlagen-Modus, den man verlassen müsste.

## Was eine Vorlage versprechen darf

Diese Fassung des Renderers zeichnet Medien-Clips, eine Transformation, eine Überblendung, einen
Helligkeitseffekt und eine Hintergrundfarbe. Sie hat keine Textmaschine und keine Effektbibliothek.
Jede mitgelieferte Vorlage ist aus genau dieser Liste gebaut, denn ein Galerieeintrag, der ein leeres
Bild erzeugt, ist schlimmer als keine Galerie.

| Vorlage | Was sie ist | Was sie funktionierend zeigt |
|---|---|---|
| Drei Aufnahmen | drei Aufnahmen, weich ineinander übergeblendet, 6,5 s | die Überblendung |
| Auftakt und Abspann | eine Aufnahme öffnet und schließt, eine zweite trägt die Mitte, 7 s | ein Platzhalter, der in zwei Clips schreibt; Aufblenden aus dem Schwarz und wieder hinein, über eine Helligkeitskurve |
| Hochformat-Story | vier schnelle Schnitte im 9:16-Bild, 7,2 s | Querformat-Material, das ein Hochkant-Bild wirklich füllt |
| Bild im Bild | eine Aufnahme bildfüllend, eine zweite klein in der Ecke, 6 s | zwei gestapelte Spuren und eine Einpassung in ein Rechteck |

Keine davon bringt Material mit. Eine Vorlage ist ein Rezept; Video mitzuliefern würde jeden Eintrag
so schwer machen wie das Projekt, aus dem er kam, und fremdes Material in die Galerie stellen statt
der Idee der Vorlage. Die Karte zeigt deshalb **den Zeitstrahl, den die Vorlage baut**, direkt aus
deren Projekt gelesen, und kein Vorschauvideo.

## Platzhalter

Ein Platzhalter — ein *Slot* — hat eine Art, eine Bezeichnung und einen Hinweis in beiden Sprachen
und eine oder mehrere **Bindungen**, die sagen, wo sein Wert landet:

| Bindung | Art | Wohin der Wert geht |
|---|---|---|
| `clipMedia` | Medien | die Quelle eines Clips, samt der Transformation, die ihn ins Bild einpasst |
| `clipLabel` | Text | der Name eines Clips auf der Zeitleiste |
| `projectTitle` | Text | der Projektname, der Browser-Tab und der Name der Exportdatei |
| `background` | Farbe | `settings.background`, sichtbar überall, wo kein Bild liegt |

Die Spezifikation schreibt eine Bindung als Pfad-String. Ein Enum der Stellen, die ein Wert wirklich
erreichen kann, ist kürzer als ein JSON-Pointer-Schreiber und kann kein Feld benennen, das es nicht
gibt. Jede Variante oben ist etwas, das man heute sehen kann; sobald Generatoren gezeichnet werden,
wächst die Liste um eine Variante und nicht um eine Maschinerie.

Ein Slot darf mehrere Bindungen tragen, und genau darin liegt der Sinn des Entwurfs: der eine
Medien-Slot von „Auftakt und Abspann“ füllt sowohl den ersten als auch den letzten Clip.

Es gibt keinen Ton-Slot. Ein Musikbett bräuchte entweder eine Datei in jeder Vorlage oder einen
Upload bei jeder Benutzung, und keine Harness in diesem Repository kann das Ergebnis hören —
headless Chrome hat keine Ausgabe. Es ist eine Slot-Art, keine Maschinerie, und kostet später eine
Variante.

## Einpassen

Eine Medien-Antwort kommt mit Breite und Höhe des Materials, und das Bildformat steht erst fest, wenn
der Assistent beantwortet ist — die Transformation wird deshalb beim Backen gerechnet und nicht vom
Autor gesetzt. Eine Bindung trägt ein Rechteck in Bruchteilen des Bildes und eine Art:

* **cover** füllt das Rechteck; was nicht hineinpasst, läuft über seine Kanten hinaus. Das ist es,
  was eine Vorlage 16:9, 9:16 und 1:1 aus demselben Material bedienen lässt.
* **contain** passt ins Rechteck hinein; was übrig bleibt, bleibt leer. Das nutzt die Einblendung von
  „Bild im Bild“, denn eine cover-Einpassung in ein kleines Feld liefe darüber hinaus.

Geschrieben werden nur Maßstab und Position. Drehung, Deckkraft, Beschnitt und Ankerpunkt bleiben so,
wie die Vorlage sie gesetzt hat — eine Einpassung kann kein gestaltetes Aussehen still aufheben.

## Material, das zu kurz ist

Der Rhythmus ist die Vorlage. Eine Datei, die kürzer ist als ihr Platzhalter, wird deshalb
**verlangsamt** und nicht gekürzt: ein kürzerer Clip hinterließe ein Loch dort, wo die nächste
Überblendung ein Bild erwartet, und die Clips danach zu verschieben wäre eine andere Vorlage als die,
die die Karte gezeigt hat. Jenseits von vierfacher Verlangsamung liest sich eine Aufnahme als
Standbild und nicht mehr als Zeitlupe; dort weist das Backen sie ab.

Material, das länger ist als der Platzhalter, läuft in seiner eigenen Geschwindigkeit, und der Rest
davon wird einfach nicht benutzt.

Der Assistent nennt die Länge, die ein Platzhalter möchte; der Kern entscheidet, was er ablehnt. Die
Ablehnungsregel in der Oberfläche zu wiederholen wäre eine zweite Instanz, die man mitpflegen muss.

## Das Dateiformat

`.videolat` ist der `.videola`-Container plus einem Eintrag:

```
videola.json      dasselbe Manifest, das ein Projekt hat
project.json      das Projekt, mit Platzhalter-Clips
template.json     Id, Version, Namen, Kategorie, Bildformate, Slots, Schritte
media/<sha256>…   nur, wenn die Vorlage eigenes Material mitbringt
```

Den Container wiederzuverwenden heißt: die Größenschranken, die inhaltsadressierte Medienbenennung,
der Migrationsweg und das Verhalten „fehlendes Medium ist eine Warnung, kein Abbruch“ sind schon
geschrieben und schon geprüft. Dieselben Bytes öffnen sich weiterhin als Projekt — eine Vorlage ist
ein Projekt mit Fragen daran, keine zweite Art von Datei.

## Die Ladeschranke

`Template::normalize` ist die eine Tür, wie eine Vorlage auch hereinkommt: aus dem mitgelieferten
Satz, aus einer Datei, oder über die WebAssembly-Grenze zurück aus JavaScript, das sie verändert
haben könnte. Zuerst läuft `Project::normalize`, dann das Manifest:

* Schema-Version, Id, und eine Obergrenze von 64 Slots
* jedes angebotene Bildformat gegen dieselben Schranken, die Breite und Höhe eines Projekts erfüllen
* Slot-Ids vorhanden und eindeutig, und jede Bindung zulässig für die Art ihres Slots
* jede Bindung benennt einen Clip, den es gibt — und bei einer Medien-Bindung einen Medien-Clip
* jeder Slot erscheint in genau einem Schritt. Ein verpflichtender Slot, nach dem kein Schritt fragt,
  ließe den Assistenten dem Backen eine Antwortmenge übergeben, die es abweisen muss, und die
  Sackgasse zeigte sich erst am letzten Knopf.
* **jeder Clip ist entweder von einem Slot gefüllt oder durch Material gedeckt, das die Vorlage selbst
  mitbringt.** Das ist die Regel gegen den leeren Galerieeintrag.
* keine Generator- und keine Compound-Clips. Die Zeichenliste lässt beide heute weg, eine Vorlage
  darauf sähe in der Zeitleiste vollständig aus und wäre auf dem Schirm leer.

Eine Farbantwort wird nicht dort geprüft, wo sie geschrieben wird, sondern dort, wo jede andere
Einstellung geprüft wird: das Backen endet in `Project::normalize`, und `settings.background` wird
dort jetzt mitgeprüft. Der Compositor liest eine unlesbare Farbe kommentarlos als deckendes Schwarz,
und damit wurde aus einem Tippfehler eine Farbe statt einer Meldung.

## Bake-to-Project

```
bake(template, answers, frame?) → Project
```

Eine neue Projekt-Id, das gewählte Bildformat, jede Antwort angewandt, unbeantwortete optionale
Medien-Clips entfernt (ein Clip, der auf nicht vorhandenes Material zeigt, zeichnet überhaupt
nichts), ein Vermerk unter `template` im Projekt, aus welcher Vorlage es kam, und dann die
gewöhnliche Ladeschranke.

Zeit ist durchgehend ganzzahlig in Flicks, dieselbe Vorlage auf 25 und auf 30 Bilder pro Sekunde
gebacken ergibt deshalb bytegleiche Clip-Positionen. Eine Vorlage kann nicht auf eine andere
Bildrate driften.

`template.instantiate` ist bewusst **kein** Command. Commands sind Bearbeitungen mit einer Umkehrung,
und „dieses Projekt ist entstanden“ hat keine. Backen ist ein Dokument-Konstruktor wie das Öffnen
einer Datei, und alles danach ist ein Command wie jeder andere.

## Autoren-Modus

Die Spezifikation beschreibt, in einem bestehenden Projekt Slots zu markieren und es zu exportieren.
Gebaut ist die ehrliche Hälfte davon: **Projekt als Vorlage speichern**, aus der Galerie. Jedes
Medium, das das Projekt benutzt, wird ein verpflichtender Slot, gebunden an jeden Clip, der es
benutzt; das Material bleibt zurück; ein Titel- und ein Hintergrundfarben-Slot kommen dazu. Ein
Klick, kein zweiter Editor-Modus, und der Kreis ist geschlossen — die Datei, die dabei entsteht, ist
eine Datei, die die Galerie öffnen und backen kann.

Slots von Hand zu markieren, zu benennen und in Schritte zu gruppieren ist ein kleiner Editor für
sich. Er lohnt sich, wenn jemand eine Vorlage nicht bloß teilen, sondern *gestalten* will.

## Was nicht da ist

* Titel im Bild. Der Titel-Slot benennt das Projekt, den Browser-Tab und die Exportdatei, und der
  Hinweis im Assistenten sagt genau das. Ein Slot, der einen Titel im Bild behauptet, wäre das
  leerste Versprechen der Galerie.
* Ein Remote-Katalog. Der mitgelieferte Satz ist offline und additiv; `GET /api/templates` ist ein
  späterer Meilenstein, der derselben Galerie Einträge hinzufügt.
* Filter und Suche. Vier Karten brauchen beides nicht.
* Das Material eines Slots nach dem Backen tauschen. Das Backen vermerkt, aus welcher Vorlage ein
  Projekt kam, aber nicht die lebenden Bindungen — denn noch bietet nichts diesen Knopf an.
