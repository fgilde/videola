# Was geplant ist, und warum in dieser Reihenfolge

Diese Seite ist der verbindliche Plan. Sie existiert, weil die Arbeit über viele Sitzungen läuft: was
entschieden ist und was offen ist, muss irgendwo stehen, das beide Seiten lesen können — nicht im Kopf
von jemandem.

Alles hier ist entweder **Daten**, **ein Shader** oder **ein Command plus eine Bedienfläche** — die drei
Formen, die bisher jedes Feature dieses Programms getragen haben. Ein Planpunkt, der sich auf keine
davon zurückführen lässt, ist ein Planpunkt, der noch nicht durchdacht ist, und sagt das auch.

## Die Regel über fremde Inhalte

Videola liefert kein Material aus, das ihm nicht gehört. Keine Vorlage, kein Übergang, kein Klang und
keine Schrift wird aus einem anderen Editor kopiert. Das ist keine Vorsicht: eine lizenzierte Bibliothek
in ein GPL-Verzeichnis geklebt ist eine Rechtsverletzung mit einem Namen daran — dem der Person, die es
veröffentlicht.

Was an die Stelle tritt: **Generatoren**. Jede ausgelieferte Vorlage ist Arithmetik über Formen,
Verläufe und eine Schrift, die das System schon hat. Deshalb wiegen die fünfzehn nichts und können
hundert werden. Wo später echtes Material wirklich nötig ist — eine Musikunterlage, eine Textur —, kommt
es aus einer CC0-Quelle mit der Herkunft daneben, oder es kommt nicht.

## Als Nächstes

### 1. Ton-Effekte

Das Pult baut seine Kette schon aus Web-Audio-Knoten und liest die Gain-Reduction am lebenden Kompressor
ab. Jeder dieser Punkte ist also ein Knoten und eine Zeile im Panel, kein neuer Mechanismus.

| Effekt | Knoten | Warum er auf der Liste steht |
|---|---|---|
| ~~Dreiband-EQ~~ | ausgeliefert: Bass- und Höhen-Kuhschwanz plus Kerbe auf der Netzfrequenz | die Abhilfe für eine dröhnende Stimme, und in jedem Editor vorhanden |
| Hall | `ConvolverNode` mit erzeugter Impulsantwort | der eine Effekt, der eine in einem Raum aufgenommene Stimme klingen lässt, als sollte sie dort sein |
| Tonhöhe / Tempo-Kopplung | Abspielrate plus `preservesPitch` | eine Temporampe, die aus einer Stimme kein Eichhörnchen macht |
| Rauschsperre | Verstärkungsverlauf aus der eigenen Messung | die billige Hälfte der Rauschunterdrückung, die es schon gibt |

**Was die Schnittstelle ihnen noch schuldet.** Ein Ton-Effekt ist heute genau ein nativer Knoten, und
Hall wie Rauschsperre brauchen zwei: einen nassen und einen trockenen Weg zum Mischen, eine Messung und
eine Verstärkung zum Steuern. Bass, Höhen und Brummfilter kamen zuerst, weil jeder von ihnen ein Knoten
ist. `AudioEffectNode` um einen Eingang und einen Ausgang zu erweitern ist die kleine, echte Arbeit vor
den anderen beiden — und sie gehört in den Graphen, nicht in die Effekte, die sie brauchen.

Die Impulsantwort wird erzeugt und nicht mitgeliefert, aus dem Grund weiter oben: ein abfallender
Rauschstoß, geformt von der Raumgröße, sind drei Zeilen und schulden niemandem etwas.

### 2. Look-Vorlagen fürs Bild

Dieselbe Tabelle, die die zwölf Titel sind: ein Name und eine Liste von Effekten mit ihren
Einstellungen. Dreiundzwanzig Effekte sind für jemanden unbenutzbar, der nicht weiß, was
„Farbreduktion“ bedeutet; „Vintage“, „Kino“, „Sommer“, „Nacht“ sind dieselben Effekte, geordnet von
jemandem, der es weiß.

### 3. Viel mehr Projekt-Vorlagen

Fünfzehn sind dabei. Jede ist Rust-Daten in der Form, die `builtin.rs` schon hält, und die Tests darum
verweigern bereits jede Vorlage, die einen Effekt, einen Übergang, eine Spurart oder eine
Titelbewegung nennt, die der Renderer nicht zeichnen kann. Die zehnte neue ist also so sicher wie die
erste.

### 4. Das Telefon, von Anfang bis Ende

Importieren, Aufnehmen und aus der Galerie wählen sind da, und das Layout wird seit einem Jahr bei
390 px gemessen. Was noch nie in einem Stück gegangen wurde, ist der ganze Weg: Material rein,
schneiden, Titel, exportieren. Dieser Weg ist der nächste Prüfstand-Lauf, und was er findet, ist das
Nächste, das repariert wird.

### 5. Effekte auf einen Bereich statt auf einen ganzen Clip

Heute ist ein Effekt eine Eigenschaft des Clips. Filmora legt einen auf eine Spanne. Die ehrliche
Fassung hier ist ein Schnitt an beiden Enden des Bereichs und der Effekt auf dem Mittelstück, in einem
Schritt der Historie — das braucht kein neues Modell, nur eine Befehlsfolge und eine Geste.

## Seit dieser Seite erledigt

* **Eigene Vorlagen.** Ein Dialog entscheidet, wonach eine Vorlage fragt und was sie mitbringt; ein
  unmarkiertes Medium reist in der Datei mit. Das ist die Hälfte von „das Python-Werkzeug ersetzen“,
  die vom Videomachen handelt.
* **Veröffentlichungsziele.** Ein Server hält sie, der Editor listet sie, und ein Export kann direkt
  auf einen Kanal gehen. Das ist die andere Hälfte.
* **Die Vorschau, die bei mehreren Medien eine Ebene von gestern zeigte** — genau der Pin, den diese
  Seite vorher versprochen hatte.

## Offene Fehler

**Die Effektbibliothek kommt im kopflosen Prüfstand ohne ihre Kacheln.** Dreiundzwanzig Kacheln, keine
Bilder, keine Meldung. Im echten Browser zeichnen sie. Ausgeschlossen bisher, jedes durch Messung: die
Bilduhr (derselbe Aufruf löst im GPU-Prüfstand bei stehender Uhr auf), ein verlorener Kontext (der
Wettlauf gegen das Verlust-Ereignis feuerte nie), das Lesen des Zeichenpuffers (eine Pixel-Lesart
änderte nichts), ein leeres Ergebnis und ein Schlüssel-Unterschied (die Bibliothek meldet jetzt, was
sie bekommen hat). Ein fehlgeschlagener Lauf meldet ein leeres Gitter statt „zeichne noch“ — der
Lauf meldet weiterhin „pending“ — das Versprechen wird also weder erfüllt noch abgelehnt, und als
Nächstes ist zu messen, ob die Kachelvorschau überhaupt einen WebGL-Kontext bekommt, während Vorschau
und Messgeräte schon einen halten.

**Ein nativer Ton-Kontext ist knapp, und die Ton-Tests sitzen an dieser Grenze.** Ein vierter
`OfflineAudioContext` in einer Testdatei reißt den vitest-Arbeiter mit. Eine Prüfung wurde auf drei
umgeschrieben; die anderen sind nicht gezählt, und eine Suite, die in einen fünften hineinwächst, fällt
als rätselhafte CI-Zusicherung aus statt als Absturz.

## Nicht geplant

* **Ein Katalog aus dem Netz.** Der ausgelieferte Satz ist offline und wächst additiv, mit Absicht. Ein
  Laden ist eine Geschäftsentscheidung, kein Feature.
* **KI-Untertitel, KI-Schnitt, KI-irgendwas**, solange es kein Modell gibt, das auf der Maschine vor der
  Person läuft. Jemandes Aufnahmen an einen Server zu schicken, um eine Bildunterschrift
  zurückzubekommen, ist kein Feature, das dieses Programm still wachsen lässt.
* **Eine zweite Interpolation.** Jede Animation löst der Rust-Kern auf. Voreinstellungen sitzen auf dem,
  was der Kern aufgelöst hat; sonst darf nichts interpolieren, denn zwei Antworten auf „wo ist dieser
  Clip in diesem Augenblick“ sind der eine Fehler, der sich nicht wegtesten lässt.
