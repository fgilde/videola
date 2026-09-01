# Vorlagen

**Gebaut.** Eine Galerie mit fünfzehn Vorlagen in fünf Kategorien, jede Karte ein Bild, das aus der
Vorlage selbst gerendert wurde; ein Assistent, der zeigt, was er baut, während man ihn ausfüllt; und
eine `.videolat`-Datei, die man weitergeben kann. Was am Ende herauskommt, ist ein gewöhnliches
Projekt: derselbe Editor, dieselben Commands, derselbe Undo-Stapel. Es gibt keinen Vorlagen-Modus,
den man verlassen müsste.

## Die Einschränkung, aus der alles folgt

**Es gibt kein Material in diesem Verzeichnis, und es wird auch keines geben.** Eine Vorlage ist ein
Rezept; Video mitzuliefern würde jeden Eintrag so schwer machen wie das Projekt, aus dem er kam, und
fremdes Material in die Galerie stellen statt der Idee der Vorlage.

Eine Vorlage ist deshalb aus dem gebaut, was der Renderer allein aus einer Projektdatei zeichnen
kann: der Textgenerator mit Ein-, Aus- und Schleifenbewegung, Farbflächen und Verläufe, die dreizehn
Effekte, die fünf Übergänge, Masken und keyframebare Transformationen samt Bewegungspfad. Das eigene
Material kommt über die Platzhalter dazu.

Das ist der Punkt und keine Notlösung. Was eine Vorlage ehrlich zeigen kann, sind Rhythmus,
Typografie, Farbe und Bewegung — und genau daran erkennt man, ob sie etwas taugt.

## Was mitgeliefert wird

| Vorlage | Kategorie | Was sie ist | Was sie funktionierend zeigt |
|---|---|---|---|
| Kraftvoller Auftakt | Auftakt | ein Titel über einer Farbfläche übergibt an Ihre Aufnahme, 6,5 s | Text, der aufwächst und ausblendet, ein Verlauf, der Zoom-Übergang, eine Farbe, die Fläche und Hintergrund zugleich erreicht |
| Blende auf | Auftakt | ein Kreis öffnet sich auf das Bild, 4,6 s | eine Maske mit keyframebarer Größe — die einzige Art, wie diese Fassung eine Aufnahme aus einer Form heraus freigeben kann |
| Weiche Diaschau | Diaschau | vier Bilder blenden ineinander, unter einer Bildunterschrift, 8,6 s | die Überblendung in spürbarer Länge, ein maskierter Streifen, der die Worte vom Bild abhebt, eine Unterschrift, die stehen bleibt, während sich darunter alles ändert |
| Im Takt | Diaschau | fünf kurze Einstellungen auf kurzem Takt, 4 s | der Wisch, und dass sein Winkel ein Parameter ist — jede Übergabe kommt von einer anderen Seite |
| Hochkant-Story | Hochkant | drei hochkante Aufnahmen mit Aufhänger und Aufforderung, 6,4 s | der Schiebe-Übergang, Querformat-Material, das ein 9:16-Bild wirklich füllt statt in Balken zu liegen, Text auf eigenem Kasten |
| Geteiltes Bild | Hochkant | zwei Bilder, ein Rahmen, 5 s | eine Cover-Einpassung in die halbe Fläche plus eine Rechteckmaske, die sie dort hält — erst beides zusammen ergibt eine Teilung ohne Naht |
| Bauchbinde | Titel und Abspann | Name und Rolle über Ihrer Aufnahme, 6 s | ein Balken, der hereinfährt, weil seine *Maske* sich bewegt, und zwei Zeilen um Sekundenbruchteile versetzt, damit sie als eine Geste lesen |
| Abspann | Titel und Abspann | die Aufnahme dunkelt ab, eine Karte übernimmt, 6,5 s | eine keyframebare Helligkeit, die das Bild auf nichts bringt, der Dip-Übergang, zwei Schlusszeilen im Abstand eines Taktes |
| Produkt im Blick | Produkte | eine Sache, richtig gezeigt, 7 s | ein Bewegungspfad — eine `position`-Spur, die eine Zeile durchs Bild trägt — dazu eine Vignette und eine Contain-Einpassung |
| Zitat | Titel und Abspann | jemandes Worte über seinem Bild, 6 s | eine Aufnahme, die von einer Keyframe-Helligkeit abgedunkelt wird, damit Schrift darauf lesbar ist — statt eines schwarzen Rechtecks darüber |
| Vorher / Nachher | Produkte | eine Kante wandert über das Bild, 6 s | eine Maske, deren *Position* gekeyframt ist: beide Bilder sind die ganze Zeit da, und die Kante dazwischen ist die Geschichte |
| Gespräch | Titel und Abspann | zwei Einstellungen, ein harter Schnitt, Name und Funktion, 8 s | das Einfachste hier und das, was die meisten Schnitte wirklich sind: gar kein Übergang, und eine Leiste, die einmal kommt und geht |
| Vorlauf | Auftakt | drei, zwei, eins, dann das Material, 3,4 s | der `countdown`-Generator: eine Zahl, die der Renderer selbst herunterzählt, statt drei Textclips, die jemand in Schritt halten muss |
| Drei Karten | Titel und Abspann | drei Zeilen nacheinander, ganz ohne Aufnahme, 6,7 s | eine Vorlage, die nichts Importiertes braucht: drei Karten auf einer Spur, genau um ihre Überblendung überlappt, über einer Fläche, die bleibt |
| Aufhänger hochkant | Hochkant | Aufhänger, Scheibe, Handlungsaufruf, 6 s | der `shape`-Generator auf halbe Bildgröße skaliert, mit Schrift darum statt darauf — die ganze Karte sind Generatoren |

Zusammen benutzen sie **jeden Übergang, den der Renderer hat**. Das ist ein Test und kein Zufall:
eine Galerie lohnt sich nur, wenn die Karten nicht dieselbe Karte sind.

Der Vorlauf war einmal zurückgezogen und ist wieder da. Geschrieben war er zuerst gegen einen
Generator, den **nichts zeichnete** — `paintsGenerator` listete Text, Solid und Gradient, und ein
Clip, dessen Generator nicht darauf steht, fällt ganz aus der Draw-List — die Karte wäre also ein
leeres Rechteck geworden. Gefunden hat es der Test, der jede ausgelieferte Vorlage backt und einen
Clip ablehnt, für den dieser Stand nichts zeichnet. Statt die Karte auszuliefern, hat der Renderer
gelernt, den Generator zu zeichnen: ein Vorlauf ist jetzt eine Zahl pro ganzer Sekunde des eigenen
Materials des Clips, und die Formen werden ebenfalls gezeichnet. Die Vorlage kam nach dem Renderer,
und in dieser Reihenfolge gehören die zwei.

## Die Karte ist ein gerendertes Bild

Eine gemalte Karte wäre ein Versprechen ohne Deckung. Sie kann ein Aussehen zeigen, das der Renderer
nie hervorbringen würde, und niemand fände es heraus, bevor er gewählt hat.

Die Karte wird deshalb gerendert, über denselben Weg, den eine echte Antwort nimmt:

```
Template::preview(frame) → Project → renderStills() → ein PNG
```

`preview` backt die Vorlage gegen einen **Platzhalter** für jedes Stück Material — einen schlichten
grauen Verlauf — und gibt ein gewöhnliches Projekt zurück, das nur noch aus Generatoren besteht. Die
Anwendung zeichnet es mit demselben Compositor wie der Editor. Ist eine Karte falsch, ist die Vorlage
falsch.

Drei Entscheidungen darin sind es wert, ausgesprochen zu werden:

* **Der Platzhalter ist genau so groß wie das gewählte Bildformat.** Ein Generator wird in
  Bildgröße gezeichnet, also legt die Einpassung das graue Rechteck nur dann dorthin, wo Ihr Material
  landen wird, wenn der Platzhalter behauptet, diese Größe zu haben. Ein bildfüllender Clip kommt
  deshalb in *jedem* angebotenen Format auf Maßstab 1 heraus — und genau diese Zusicherung fällt in
  dem Moment um, in dem der Platzhalter dem Bildformat nicht mehr folgt.
* **Sein Verlauf wird für jeden Platzhalter ein Stück weitergedreht.** Zwei Bilder nebeneinander —
  ein geteiltes Bild, eine Einblendung über einem Hintergrund — sind zwei verschiedene Bilder, und
  beide im exakt gleichen Grau zu zeichnen lässt die Naht verschwinden, also genau das, wofür diese
  Vorlagen da sind.
* **Er ist heller als die Karte, auf der er liegt.** Ein Platzhalter, der dunkler ist als die Fläche
  dahinter, ließ jede Vorlage, deren Material das Bild füllt, wie eine leere Karte aussehen — und
  versteckte damit die guten Vorlagen hinter denen, die zufällig mehr Text tragen.

`posterAt` im Manifest ist der Augenblick, aus dem eine Karte gezeichnet wird. Den wählt die Autorin,
denn nur sie weiß, welche Sekunde ihres Aufbaus die zeigenswerte ist, und es gibt keine Rechnung, die
zuverlässig dort landet.

### Was das kostet

Ein kleines Bild pro Vorlage — 384 px auf der längeren Kante —, eines nach dem anderen in der
Reihenfolge der Galerie gerendert, während der Dialog schon offen und bedienbar ist. Ein
Vorschauprojekt enthält nur Generatoren, also **kein Dekodieren, kein Speicherzugriff, kein Netz**;
`renderStills` baut und verwirft seinen WebGL-Kontext selbst, es lebt also immer genau einer. Neun
davon sind ein paar hundert Millisekunden Grafikarbeit, auf die nichts wartet.

Jedes Maß im Textgenerator ist ein Bruchteil des Bildes — das ist es, was das Rendern bei 384 px
ehrlich macht statt zu einem anderen Bild.

Es gibt keinen `IntersectionObserver`. Der Katalog ist durch das begrenzt, was ein Mensch
durchscrollt, und die Schleife läuft ohnehin einzeln und in Galerie-Reihenfolge — ein entfernter
Katalog mit Hunderten würde dieser Schleife eine gefilterte Liste geben, und das ist ein Filter, kein
Umbau. Wo es gar kein WebGL gibt, fällt die Karte auf den Umriss der Zeitleiste zurück, die die
Vorlage bauen wird: eine kleinere Behauptung, aber eine wahre.

## Platzhalter

Ein Platzhalter — ein *Slot* — hat eine Art, eine Bezeichnung und einen Hinweis in beiden Sprachen und
eine oder mehrere **Bindungen**, die sagen, wo sein Wert landet:

| Bindung | Art | Wohin der Wert geht |
|---|---|---|
| `clipMedia` | Medien | die Quelle eines Clips, samt der Transformation, die ihn ins Bild einpasst |
| `clipLabel` | Text | der Name eines Clips auf der Zeitleiste |
| `projectTitle` | Text | der Projektname, der Browser-Tab und der Name der Exportdatei |
| `generatorText` | Text | die Worte, die ein Textgenerator **auf den Schirm** bringt |
| `background` | Farbe | `settings.background`, sichtbar überall, wo kein Bild liegt |
| `generatorColor` | Farbe | die eigene Farbe eines Generators: die Füllung einer Fläche, der erste Halt eines Verlaufs oder die Schriftfarbe eines Titels |

`generatorText` ist die Bindung, die eine Vorlage nach der Person aussehen lässt, die sie ausgefüllt
hat, statt nach der Vorlage. Beide Generator-Bindungen werden gegen den **tatsächlichen Generator**
des Clips geprüft und nicht nur dagegen, dass es den Clip gibt: eine Textantwort, die in eine
Farbfläche geschrieben wird, verschwindet wortlos — und der Assistent hätte eine Frage gestellt,
deren Antwort ins Leere geht.

Ein Slot darf mehrere Bindungen tragen, und das ist der Sinn des Entwurfs: der Titel-Slot von
„Kraftvoller Auftakt“ füllt zugleich die Worte im Bild und den Projektnamen.

**Jeder Slot ist optional**, Medien eingeschlossen. Das ist es, was eine Karte überhaupt etwas zeigen
lässt: die Vorlage bringt die Worte mit, mit denen sie entworfen wurde, ein unbeantworteter Titel ist
also die Zeile ihrer Gestalterin und kein leeres Rechteck — und der Assistent startet jedes Feld auf
diesen Worten.

Ein unbeantworteter Medien-Slot nimmt seinen Clip mit, und die Spur mit, wenn dieser Clip alles war,
was sie trug. Eine Vorlage ganz ohne Material kommt also als ihre Grafik zurück: die Titel, die
Farbflächen, die Endkarte. Das ist kein abgespecktes Ergebnis — die Hälfte dessen, wofür Vorlagen da
sind, ist die Grafik, und eine Bauchbinde will man über einen Schnitt legen, der schon existiert. Genau
das macht **Als Spuren einfügen** erst sinnvoll.

Ein Pflicht-Medien-Slot hieße: eine Vorlage, die niemand benutzen kann, bevor etwas importiert ist —
beim ersten Start also genau verkehrt.

Es gibt keinen Ton-Slot. Eine Musikunterlage bräuchte entweder eine Datei bei jeder Vorlage oder einen
Upload bei jeder Benutzung, und kein Prüfstand in diesem Verzeichnis kann das Ergebnis hören —
headless Chrome hat keine Ausgabe. Das ist eine Slot-Art, kein Mechanismus, und kostet später eine
Variante.

## Einpassen

Eine Medienantwort kommt mit Breite und Höhe des Materials, und das Bildformat steht erst fest, wenn
der Assistent beantwortet ist — die Transformation wird deshalb beim Backen gerechnet und nicht von
der Autorin. Eine Bindung trägt ein Rechteck in Bruchteilen des Bildes und eine Art:

* **cover** füllt das Rechteck; was nicht hineinpasst, läuft über die Kanten hinaus. Das ist es, was
  eine Vorlage 16:9, 9:16 und 1:1 aus demselben Material bedienen lässt.
* **contain** passt in das Rechteck hinein; was übrig bleibt, bleibt leer. Das benutzt die
  Einblendung von „Produkt im Blick“, denn eine Cover-Einpassung in einen kleinen Kasten liefe
  darüber hinaus.

Eine Cover-Einpassung in einen *Teil* des Bildes läuft absichtlich über den Rest hinaus und wird mit
einer `mask-rect` gepaart, die sie in ihrer Hälfte hält — so hat „Geteiltes Bild“ keine Naht.

Geschrieben werden nur Maßstab und Position. Drehung, Deckkraft, Beschnitt und Ankerpunkt bleiben so,
wie die Vorlage sie gesetzt hat; eine Einpassung kann ein gestaltetes Aussehen nicht stillschweigend
zurücknehmen.

Zu beachten: ein Bewegungspfad und eine Einpassung beantworten dieselbe Frage, und der Pfad gewinnt
(siehe `transform_at`). „Produkt im Blick“ legt seinen Pfad deshalb auf einen **Text**-Clip, der
keine Einpassung hat, mit der er streiten könnte.

## Material, das zu kurz ist

Der Rhythmus ist die Vorlage. Eine Datei, die kürzer ist als ihr Slot, wird deshalb **verlangsamt**
statt gekürzt: ein kürzerer Clip ließe ein Loch, wo der nächste Übergang ein Bild erwartet, und die
folgenden Clips zu verschieben wäre eine andere Vorlage als die, die die Karte gezeigt hat. Jenseits
von vierfacher Verlangsamung liest eine Aufnahme als Standbild und nicht mehr als Zeitlupe, und das
Backen verweigert stattdessen.

Material, das länger ist als der Slot, läuft in seinem eigenen Tempo, und der Rest wird schlicht nicht
benutzt.

Der Assistent nennt die Länge, die ein Slot haben will; was verweigert wird, entscheidet der Kern.
Die Verweigerungsregel in der Oberfläche zu wiederholen wäre eine zweite Instanz, die man in
Übereinstimmung halten müsste.

## Die Galerie

* **Kategorien als Chips**, in der Reihenfolge, in der man arbeitet: Auftakt, Diaschau, Hochkant,
  Titel und Abspann, Produkte. Eine Kategorie, für die dieser Aufbau kein Wort hat, bekommt trotzdem
  einen Chip unter ihrem eigenen Namen — eine Vorlage, die niemand findet, ist dasselbe wie eine
  Vorlage, die nicht geladen werden konnte.
* **Die Karte ist der Knopf.** Ein Bild mit einem Bedienelement darunter macht das Größte auf dem
  Schirm zu dem Teil, der nichts tut, und gibt am Telefon die kleinste Trefferfläche der Karte
  ausgerechnet dem Daumen, der ohnehin darüber steht.
* **Der Bildkasten hält die Form der Vorlage schon beim ersten Zeichnen**, genommen aus dem Format,
  das die Vorlage zuerst anbietet — so sieht eine hochkante Vorlage sichtbar hochkant aus, und das
  Raster kann nicht unter dem Zeiger wegrutschen, wenn ein Standbild ankommt.
* Auf einem schmalen Schirm ist der Dialog der Schirm: eine mittige Karte mit Rand ringsum
  verschwendet die beiden Dinge, von denen ein Telefon am wenigsten hat.

## Der Assistent

* **Das Bild der Vorlage bleibt während des ganzen Ablaufs stehen.** Wer sechs Felder ausfüllt, hat
  sonst keine Erinnerung daran, wofür.
* **Eine Leiste mit allen Schritten** statt „3 von 5“: wie viel noch kommt, ist die Frage, für die die
  Zahl einspringt.
* **Ein Schritt je Art von Frage** — Ihr Material, Ihre Worte, Ihre Farbe — in der Reihenfolge, in der
  man sie beantwortet, und ein Schritt ohne Inhalt wird gar nicht erst gezeigt.
* **Eine gewählte Datei erscheint als Bild mit ihrer Länge**, nicht nur als Name.
* **Die letzte Tafel listet jede Antwort**, auch die von Tafeln, die den Schirm längst verlassen
  haben. Ein Assistent, der über drei Tafeln fragt und dann auf einmal auf alles hin handelt, verlangt
  eine Entscheidung, die niemandem gezeigt wurde.
* **Textfelder sind Textbereiche.** Der Textgenerator ehrt einen harten Zeilenumbruch, ein `<input>`
  verschluckt ihn stillschweigend; ein zweizeilig entworfener Titel kam einzeilig zurück, sobald das
  Feld gezeichnet war. Ein Feld unberührt zu lassen darf den Entwurf nicht ändern.

## Das Dateiformat

`.videolat` ist der `.videola`-Behälter plus einen Eintrag:

```
videola.json      dasselbe Manifest, das ein Projekt hat
project.json      das Projekt, mit Platzhalter-Clips
template.json     Kennung, Fassung, Namen, Kategorie, Formate, Kartenaugenblick, Slots, Schritte
media/<sha256>…   nur, wenn die Vorlage eigenes Material mitbringt
```

Denselben Behälter zu benutzen heißt, dass Größengrenzen, die inhaltsadressierte Benennung von
Medien, der Migrationspfad und das Verhalten „fehlendes Medium ist eine Warnung, kein Fehler“ schon
geschrieben und schon geprüft sind. Dieselben Bytes öffnen sich weiterhin als Projekt — eine Vorlage
ist ein Projekt mit angehängten Fragen und keine zweite Art von Datei.

## Die Ladeschranke

`Template::normalize` ist die eine Tür, egal woher eine Vorlage kam: aus dem mitgelieferten Satz, aus
einer Datei oder über die WebAssembly-Grenze zurück aus JavaScript, das sie bearbeitet haben könnte.
Sie führt zuerst `Project::normalize` aus und prüft dann das Manifest:

* die Schema-Fassung, die Kennung und eine Obergrenze von 64 Slots
* jedes angebotene Bildformat gegen dieselben Grenzen, die Breite und Höhe eines Projekts einhalten
* Slot-Kennungen vorhanden und eindeutig, und jede Bindung zulässig für die Art ihres Slots
* jede Bindung benennt einen Clip, den es gibt — und bei einer Generator-Bindung einen Clip, der die
  *Art* von Generator trägt, in die diese Bindung schreibt
* jeder Slot kommt in genau einem Schritt vor. Ein Pflicht-Slot, nach dem kein Schritt fragt, ließe
  den Assistenten dem Backen eine Antwortmenge übergeben, die es verweigern muss — und die Sackgasse
  zeigte sich erst auf dem letzten Knopf.
* **jeder Clip ist etwas, das jemand tatsächlich sehen wird.** Ein Medienclip nimmt sein Material
  entweder aus einem Slot, oder die Vorlage hat es selbst mitgebracht; ein Generatorclip muss einer
  sein, den der Renderer zeichnet. Das ist die Regel gegen den leeren Galerieeintrag.

`paintsGenerator` in der Engine zeichnet **Text, Fläche, Verlauf, Vorlauf und die fünf benannten
Formen** — Rechteck, Quadrat, Ellipse, Kreis, Dreieck. Ein Formname ist im Modell ein freier String,
eine unbekannte Form fällt also wortlos aus der Zeichenliste: eine Vorlage auf `hexagon` sähe in der
Zeitleiste vollständig aus und wäre auf dem Schirm leer und wird verweigert. Compound-Clips ebenfalls: einer
trägt eine ganze zweite Zeitleiste, und jeder Clip darin bräuchte denselben Nachweis wie die oberste
Ebene; die ehrliche Antwort ist deshalb nein statt einer Prüfung, die nur so aussieht, als stiege sie
hinab.

Eine Farbe wird nicht dort beurteilt, wo sie geschrieben wird, sondern dort, wo jede andere Farbe
beurteilt wird. `Project::normalize` prüft jetzt auch **Generatorfarben** und nicht nur
`settings.background`: `hex()` in der Engine fällt bei allem, was es nicht lesen kann, auf Schwarz
oder Weiß zurück — das macht aus einem Tippfehler eine Farbe statt einer Meldung, und ein Farb-Slot
kann jetzt einen Generator erreichen.

## Backen zum Projekt

```
bake(template, answers, frame?) → Project
```

Eine neue Projektkennung, das gewählte Bildformat, jede Antwort eingesetzt, unbeantwortete optionale
Medienclips entfernt (ein Clip, der auf nicht vorhandenes Material zeigt, zeichnet überhaupt nichts),
ein Vermerk unter `template` im Projekt, aus welcher Vorlage es kam, und dann die gewöhnliche
Ladeschranke.

Zeiten sind durchgehend ganzzahlige Flicks, dieselbe Vorlage mit 25 fps und mit 30 fps gebacken ergibt
also bytegleiche Clip-Positionen. Eine Vorlage kann nicht auf eine andere Bildrate driften.

`template.instantiate` ist mit Absicht **kein** Command. Commands sind Änderungen mit einer Umkehrung,
und „dieses Projekt ist entstanden“ hat keine. Backen ist ein Dokumentkonstruktor wie das Öffnen einer
Datei, und alles danach ist ein Command wie jeder andere.

Ein entfernter Clip leert die Spur, auf der er allein lag, und diese Spur geht mit. Eine Vorlage, die
drei Aufnahmen wollte und keine bekam, würde sonst drei nackte Spuren übergeben — Mobiliar zum
Löschen statt Teil dessen, was bestellt war.

### Als Spuren einfügen

Der letzte Schritt des Assistenten bietet eine zweite Antwort: **Als Spuren einfügen**, neben *Projekt
erstellen*. Dasselbe Backen, aber über das bereits offene Projekt gelegt statt es zu ersetzen — eine
neue Spur je Spur der Vorlage, in deren eigener Reihenfolge, alles darauf an den Abspielkopf gerückt.

Zwei Einzelheiten, die nicht umsonst sind:

* **Es sind Commands, kein Konstruktor.** Ein `track.add` je Spur und ein `clip.paste` je Clip, alles
  unter einem gemeinsamen Coalesce-Schlüssel, damit eine Vorlage mit vier Spuren ein einziges
  Rückgängig bleibt. `clip.paste` ist der Command, der ohnehin einen ganzen Clip mit Effekten und
  Übergängen trägt — deshalb brauchte das keine neue Variante.
* **Gebacken wird in der Größe des offenen Projekts**, nicht im Format, das der Assistent anbietet. Die
  Rahmung eines Clips ist relativ zum Bild, für das er gebacken wurde; ein 9:16-Backen in einem
  16:9-Schnitt käme beschnitten an. Das Format gehört dem Projekt, und ein Projekt gibt es hier schon.

Wo nichts offen ist, fehlt das Angebot: in einer frischen Sitzung wird eine Vorlage zuerst das
Projekt.

### Eine Frage, so lang wie die Antwort

Ein Slot kann **die Länge des Materials** annehmen statt der Länge, in der die Vorlage ihn gezeichnet
hat — und bei einer Vorlage aus dem eigenen Schnitt ist das die Voreinstellung. Ohne sie ist eine
Vorlage eine Vorlage für genau ein Video: „mein Intro, dann mein Clip, dann meine Endkarte“ geht nur,
wenn der Clip genauso lang ist wie der, der zufällig da war, als sie entstand.

Wächst ein Slot, folgt die Zeitleiste um ihn herum, nach zwei Regeln:

* Alles, was am Ende dieses Clips oder danach beginnt, **rückt mit** — auf jeder Spur, denn eine
  Endkarte auf einer Textspur ist genauso „danach“ wie die nächste Aufnahme auf derselben Spur.
* Alles, was ihn **von Anfang bis Ende überdeckt hat, wird mitgedehnt** — Wasserzeichen, Logo,
  Musikbett. Nichts im Modell sagt, welcher Clip ein Wasserzeichen ist, und nichts muss es: ein Clip,
  der den gewachsenen überspannt hat, ist genau der Clip, der mitwachsen muss.

Ein Clip, der ihn nur teilweise überlappt, behält seine Länge und rückt nur, wenn er danach begann.
Dort zu raten ist der Anfang davon, dass eine Vorlage einen Schnitt umbaut, um den sie niemand gebeten
hat.

Material, das **kürzer** ist als der Slot, bleibt beim alten Handel: der Clip wird verlangsamt statt
gekürzt, denn Kürzen ließe ein Loch, wo das Nächste anfängt.

Der Autorendialog fragt je Aufnahme — *Länge: folgt dem Material* oder *wie in der Vorlage* — und alle
mitgelieferten Vorlagen sagen das Zweite. Eine Diaschau, die auf den Takt schneidet, ist die Vorlage;
eine Aufnahme, die fünfmal so lang läuft, wäre eine andere.

## Autorenmodus

**Dieses Projekt als Vorlage speichern**, aus der Galerie, öffnet einen Dialog mit allem, was das
Projekt hat — jede Aufnahme mit ihrem Dateinamen, jeder Titel mit seiner ersten Zeile, jede Farbfläche
mit ihrer Farbe — und einem Häkchen daneben. Angehakt heißt: der Assistent fragt danach. Nicht
angehakt heißt: es ist Teil der Vorlage, bei einer Aufnahme samt Datei.

Das ist die ganze Entscheidung, und deshalb ist es ein Dialog und kein Knopf: die Markierung war
vorher die Auswahl im Editor, und die sagt, an welchen Clips jemand gerade arbeitet — dass das
dasselbe ist wie „welche davon ist eine Frage“, ist Zufall. Medien und Titel starten angehakt, Farben
nicht: das ist, was jemand fast immer meint, der aus einem fertigen Schnitt eine Vorlage macht.

Ein Beispiel, weil es der Grund für die Sache ist: Intro, dann dein Clip, darüber ein Wasserzeichen.
Hake den Clip in der Mitte an, sonst nichts. Heraus kommt eine Vorlage, die nach einer Aufnahme fragt;
Intro und Wasserzeichen stecken in der Datei und reisen mit, wohin sie auch geht.

**Projekt als Vorlage speichern**, aus der Galerie heraus. Das Material bleibt zurück, und die
**Auswahl im Editor ist die Markierung** — Clips in der Zeitleiste auszuwählen ist ohnehin schon die
Art, „diese hier“ zu sagen, und eine zweite Art, einen Clip zu markieren, wäre eine zweite Sache zum
Erklären. Nichts ausgewählt heißt „entscheide du“.

Was Markieren entscheiden kann und was nicht, ehrlich:

* **Ein Medium ist nur dann eine Frage, wenn es markiert wurde — sonst reist sein Material mit.** Das
  ist die Umkehrung, die eine Vorlage zu einer eigenen macht: Intro, Logo, Wasserzeichen und Endkarte
  sind das Rezept, jedes Mal dasselbe, und eine Vorlage, die bei jeder Benutzung nach ihrem eigenen
  Intro fragt, ist keine Vorlage. Ein unmarkiertes Medium bleibt also im Projekt, und seine Bytes gehen
  mit in die `.videolat`; ein markiertes wird ein Slot und wird entfernt — diese Aufnahme gehört der
  Autorin, und keine Kopie der Vorlage soll sie tragen.

  Ist gar nichts markiert, ist jedes Medium eine Frage. Das ist gemeint, wenn jemand ein Projekt
  übergibt und sagt „entscheide du“ — und daraus bestehen die mitgelieferten Vorlagen.
* **Textgeneratoren sind eine echte Wahl.** Ein nicht markierter Titel behält schlicht seine Worte,
  denn ein Generator ist sein eigenes Material. Ohne Markierung wird jeder Titel zum Feld — was
  jemand will, der eine Titelsequenz weitergibt.
* **Eine markierte Fläche oder ein markierter Verlauf wird zur Farbfrage.** Nicht markierte nie: ein
  Farbfeld pro farbigem Clip wäre eine Wand von Fragen zu einem Entwurf, den niemand ändern wollte.

## Was nicht da ist

* Ein entfernter Katalog. Der mitgelieferte Satz ist offline und additiv; `GET /api/templates` ist
  eine spätere Stufe, die Einträge in dieselbe Galerie legt.
* Suche und Filtern nach Schlagwort. `tags` wird durch den ganzen Stapel getragen und von nichts
  gelesen; neun Karten hinter fünf Chips brauchen beides nicht.
* Das Material eines Slots nach dem Backen austauschen. Das Backen hält fest, aus welcher Vorlage ein
  Projekt kam, aber nicht die lebenden Bindungen, weil noch nichts diesen Knopf anbietet.
* Ein Ton-Slot, aus dem oben genannten Grund.
* Kartenaugenblick, Kategorie und angebotene Formate wählen, wenn man das eigene Projekt als Vorlage
  speichert. Es nimmt das Format, in dem es entworfen wurde, landet in `custom` und hat keinen
  Kartenaugenblick — seine Karte zeigt deshalb den Zeitleisten-Umriss. Das ist ein kleiner Editor für
  sich, den zu bauen sich lohnt, sobald jemand eine Vorlage *formen* und nicht nur weitergeben will.
