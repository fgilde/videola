# M6 — Mobile-Ausbau

Worktree `../videola-mobile`, Branch `m6-mobile`, fuenf Commits auf `8b0755a`.
**Nicht gepusht, nicht gemergt.**

```
pnpm typecheck                  gruen (7 Pakete)
pnpm test                       737 Tests (core 40, media 30, ui 316, engine 237, server 114)
pnpm build                      gruen (7 Pakete)
test:gpu                        89/89
test:export                     27/27
ui test:browser                 41/41
videola-web test:browser        152/152   (vorher 98)
```

---

## Die drei offenen Punkte

### 1. Die Kopfzeile lief auf 390 px aus dem Bild — GESCHLOSSEN

Zehn Bedienelemente, `overflow-x: auto`, und im Ruhezustand stand die Haelfte davon ausserhalb
des Fensters. Die Projektaktionen (neu, Vorlage, oeffnen, importieren, Spur hinzufuegen) liegen
jetzt in einem Ueberlaufmenue, auf dem Telefon zusaetzlich Export, Speichern und die
Sprach-/Themenumschalter. Auf der Leiste bleiben **Rueckgaengig und Wiederholen** — die beiden,
nach denen ein Daumen staendig greift.

Das Menue ist ein `<details>`. Offen-Zustand, Tastaturbedienung und zugaenglicher Name kommen mit;
ein Knopf plus `useState` plus `aria-expanded` waere eine Neuimplementierung von allen dreien. Was
`<details>` nicht kann, ist sich nach der Wahl eines Eintrags zu schliessen — das ist eine Zeile.

**Der Test, der gefehlt hat, ist jetzt da:** bei 390 px muss `scrollWidth` der Leiste gleich ihrer
`clientWidth` sein, und `documentElement.scrollWidth` darf `innerWidth` nicht ueberschreiten. Dazu
die Mitgliedschaft als DOM-Tatsache in jsdom (welcher Knopf liegt in `.v-topbar__menu`, welcher
nicht) — das ist die Frage, die entscheidet, ob die Leiste ueberhaupt passen *kann*.

Nebenbefund derselben Klasse: ein `<summary>` traegt keine Button-Rolle. Weder
`getByRole("button")` noch der `button[aria-label=…]`-Sucher der Harness findet es. Beide Stellen
fragen jetzt nach dem Element statt nach der Rolle.

### 2. Ziehen aus der Bibliothek, zweites Medium auf zweiter Spur — GESCHLOSSEN

**Der Zug ist gebaut, dort wo er moeglich ist.** Ein Pointer-Events-Pfad, also Maus, Stift und
Finger auf denselben Handlern — kein zweiter Pfad und kein HTML5-Drag-and-Drop, das mit einem
Finger ohnehin nicht funktioniert hätte.

Aufteilung: die Bibliothek meldet nur, *welches* Medium unter dem Zeiger liegt. Ob daraus ein Drop
wird, auf welcher Spur und zu welchem Zeitpunkt, entscheidet die Timeline — alle drei sind ihre
Geometrie, und eine Geste, die an einer Stelle beurteilt wird, kann sich nicht mit sich selbst
widersprechen. Die Timeline lauscht dafuer am `window`, weil der Zeiger in der anderen Flaeche
heruntergegangen ist. Ein `clip.add`, also **ein Undo-Schritt**.

Angeboten auf Schreibtisch und Tablet (`draggable={layout !== "phone"}`). Auf dem Telefon nicht:
Bibliothek und Zeitleiste wechseln sich hinter der Reiterleiste ab, es gibt kein Ziel.

**Der Knopf bleibt ueberall.** Das weicht vom Auftrag ab („lass den Knopf, wo er nicht moeglich
ist"), und zwar bewusst: ein Zug ist nicht mit der Tastatur bedienbar. Ihn zu entfernen, wo der Zug
geht, haette den einzigen tastaturbedienbaren Weg auf die Zeitleiste gestrichen.

**Zwei Medien auf zwei Spuren sind gefahren**, im Tablet-Lauf, an der gebauten Anwendung: zwei
verschiedene Dateien (das zweite Fixture ist ein Mandelbrot, sichtbar etwas anderes als die
Farbbalken), zwei Spuren, der zweite Clip per Fingerzug auf V2 abgelegt, an der Stelle wo der
Finger losliess, und ein Undo nimmt den ganzen Zug zurueck. Im Schirmbild `tablet.png` zu sehen.

### 3. Vorschaubilder — GEBAUT, aber nicht unter dem Pfad, den die DoD nennt

`packages/media/src/thumbnails.ts` gibt es weiterhin nicht, und zwar aus einem Grund, der nicht
verhandelbar ist: **`@videola/media` haengt nicht an `@videola/engine`, sondern umgekehrt.** Ein
Thumbnail ist ein dekodierter Frame; der Dekoder liegt in der Engine. Die Datei unter dem
genannten Pfad haette die Abhaengigkeitsrichtung gedreht.

Das etablierte Muster dieses Baums waere Injektion gewesen — `importFile(file, doc, probe)` macht
das genau so. Hier traegt es nicht: bei `importFile` ist das Dekodieren ein Detail, hier *ist* es
die ganze Aufgabe. Was uebrig bliebe, waere ein Cache mit einem Thumbnail-Namen.

Also `packages/engine/src/decode/thumbnail.ts`, 45 Zeilen: `openInput` → Videospur →
`VideoSampleSink.getSample(t)` → `drawWithFit(ctx, { fit: "cover" })` auf ein `OffscreenCanvas` →
`convertToBlob`. Der Frame kommt bei einem Zehntel der Laufzeit, hoechstens eine Sekunde hinein —
das erste Bild echten Materials ist ungefaehr so oft eine Blende aus Schwarz wie ein Bild, und eine
schwarze Kachel ist genau das graue Rechteck, das hier vermieden werden sollte. `ponytail:`-Marker
auf dem festen Versatz.

`apps/web/src/thumbnails.ts` haelt die Object-URLs, eine Dekodierung pro Medium, revoked beim
Verlassen der Seite. Ein Medium ohne brauchbaren Frame steht **nicht** in der Karte, und die
Bibliothek zeichnet dafuer nichts — kein Platzhalter.

**Geprueft als Bild, nicht als Element:** `naturalWidth` ungleich null bei 160×90, die beiden
Medien im Tablet-Lauf muessen sich messbar voneinander unterscheiden, und ein Standbild darf keine
einfarbige Flaeche sein. Ein Platzhalter, ein schwarzes Bild und ein fehlgeschlagenes Dekodieren
fallen an der letzten Zusicherung alle durch — das war die Lehre aus `litPixels() > 1000`.

---

## Der Mobile-Ausbau

### Effekte sind auf dem Telefon erreichbar

Der Inspector lag zwischen Transport und Reiterleiste, mit `max-height: 35vh`. Er hatte damit ein
Drittel des Schirms und konnte trotzdem keinen Effekt zeigen. **Jetzt ist er der dritte Reiter**
(Medien · Zeitleiste · Eigenschaften), die Zeile im Raster ist weg. Damit sind Effekte, Keyframes,
Uebergaenge und Tempo auf dem Telefon erreichbar, und das Bild steht weiter oben fest.

Drei Reiter, nicht die sechs des Entwurfs: Text, Ton und Export haben keine eigene Flaeche, und ein
Reiter, der nichts oeffnet, bleibt schlimmer als einer, den es nicht gibt.

Im Lauf: Clip antippen, Reiter wechseln, „Helligkeit hinzufuegen" (44 px), Parameterzeile mit dem
Namen aus dem Manifest, Keyframe-Schalter da, nichts gemeldet. Schirmbild `phone-inspector.png`.

### Der Tablet-Modus wird gefahren

Er hatte eine Layout-Regel und keinen Lauf dahinter. Jetzt ein eigener Chrome-Start ueber
`Emulation.setDeviceMetricsOverride` bei 834×1112 mit Beruehrungsemulation — dem Telefonlauf
nachgebaut, aus demselben Grund: `--window-size` klemmt unter Windows bei 500 px und **beschneidet**
das Schirmbild, statt zu skalieren.

**Der Lauf hat drei Fehler gefunden, die kein Test gesehen hat und die auf dem Schirmbild sofort
zu sehen waren:**

1. Die Zeitanzeige stand auf `00 / 00`. Bei drei Spalten blieben der Mitte rund 330 px, schmaler
   als der Transport selbst.
2. Die Eigenschaftsspalte schob ihre Schieber ueber den rechten Fensterrand. `.v-inspector` trug
   `width: 300px` und schlug damit die Rasterspalte. Breiten gehoeren in die Schale, nicht in die
   Flaeche — jetzt bestimmt `.v-editor` jede Spalte, und der Inspector fuellt, was er bekommt.
3. Mit `1fr` auf der falschen Zeile fiel die **Vorschau auf null Pixel** zusammen. Ein Canvas hat
   keine eigene Hoehe, mit der es eine Rasterzeile offenhalten koennte. Alle anderen Pruefungen
   blieben dabei gruen.

Das Tablet ist deshalb **zweispaltig**: Bibliothek links, Bild + Transport + Eigenschaften
uebereinander rechts, Zeitleiste unten. Ein Hochformat-Tablet ist knapp an Breite und reichlich an
Hoehe. Bibliothek und Zeitleiste bleiben gleichzeitig sichtbar — das ist das, was das Telefon nicht
kann, und was den Zug ueberhaupt erst moeglich macht.

Zusicherungen dagegen, damit keiner der drei zurueckkommt: das Canvas hat mindestens 200 px Hoehe;
Bild ueber Transport ueber Zeitleiste; jede der fuenf Flaechen liegt vollstaendig im Fenster; die
Zeitanzeige bekommt die Breite, die ihre Ziffern brauchen (Rechteck gegen `scrollWidth`, nicht
`scrollWidth` gegen `clientWidth` — ein unter seinen Inhalt gequetschtes Flex-Element meldet beide
gleich).

### Kamera- und Galerie-Import — ehrlich beantwortet

Auf Telefon und Tablet bietet die Bibliothek **Aufnehmen** und **Aus der Galerie** neben **Medien
importieren**. Beides sind gewoehnliche `<input type="file" accept="video/*">` in einem `<label>`;
das erste traegt `capture="environment"`.

Ein natives Feld im Dokument, kein per Skript erzeugtes: nur so ist das Attribut ueberhaupt von
aussen pruefbar. Die Vorlagen-Sitzung hat denselben Weg aus demselben Grund gewaehlt.

**Headless nachweisbar ist:** dass das Feld existiert, mit `accept="video/*"` und
`capture="environment"`, dass das Galerie-Feld dasselbe ohne `capture` und mit `multiple` ist, und
dass beide 44 px hoch sind. **Nicht nachweisbar ist alles danach** — ein headless Browser hat weder
Kamera noch Galerie. Das steht so in der Doku und wird hier nicht schoener geschrieben.

### Gesten und Performance-Budgets

Kein neuer Pfad. Der Zug aus der Bibliothek laeuft ueber dieselben Pointer-Events, Pinch-Zoom,
Trimm-Zonen ab 44 px bei `pointerType !== 'mouse'` und der Langdruck standen schon. Die nicht
sichtbare Flaeche wird weiterhin **ausgehaengt**, nicht versteckt — eine Mutation, die die
Zeitleiste hinter den anderen Telefonreitern montiert laesst, faerbt den Lauf rot.

Zu den Performance-Budgets: gemessen ist, dass Telefon und Tablet unter laufender Wiedergabe den
Playhead bewegen und dass nichts seitwaerts scrollt. **Eine Bildratenzahl fuer Telefon oder Tablet
ist nicht gemessen** und waere unter SwiftShader eine Aussage ueber den Rasterizer. Das
Knotenbudget der Virtualisierung deckt weiterhin `ui test:browser` ab.

---

## Gegenproben

18 Mutationen, sechs Ueberlebende. Die Ueberlebenden waren wieder die interessanten.

| # | Mutation | Ergebnis |
|---|---|---|
| M1 | Ueberlaufmenue bekommt die Telefon-Aktionen nicht | 2 rot |
| M2 | Wortmarke auch auf dem Telefon gezeichnet | 1 rot |
| M3 | Eigenschaften-Reiter aus `TABS` entfernt | 3 rot |
| M4 | `useDismiss`: Escape-Zweig entfernt | 1 rot |
| M5 | `useDismiss`: Ausserhalb-Druck entfernt | **ueberlebt → Testluecke** |
| B1 | Projektaktionen zurueck auf die Leiste | 8 rot |
| B2 | `thumbnail` zeichnet den Frame nicht | 2 rot |
| B3 | Bibliothek nie ziehbar | 3 rot |
| B4 | `dropAt` liefert immer `tracks[0]` | 3 rot |
| B5 | `flex-shrink: 0` auf der Zeitanzeige entfernt | **ueberlebt → tote Deko** |
| B6 | `1fr` auf der Eigenschaftszeile (Tablet) | 1 rot |
| B7 | jeder Eintrag zeigt das erste Standbild | 1 rot |
| B8 | Drop ignoriert `scrollLeft` | **ueberlebt → Testluecke** |
| B9 | Zug-Schwelle entfernt | **ueberlebt → tote Deko** |
| B10 | `onGrabEnd` vor `onDropMedia` | **ueberlebt → falscher Kommentar** |
| B11 | `capture`-Attribut entfernt | 2 rot |
| B12 | `fit: contain` statt `cover` | **ueberlebt → strukturell nicht unterscheidbar** |
| B13 | Zeitleiste bleibt auf dem Telefon montiert | 1 rot |

**M5 und B8 waren echte Testluecken.** `useDismiss` verlor seinen Ausserhalb-Druck, ohne dass einer
von 125 Tests rot wurde — Escape war abgedeckt, die andere Haelfte desselben Hooks nicht, und das
ist die Haelfte, die ein Finger benutzt, weil ein Telefon keine Escape-Taste hat. Zwei Tests
ergaenzt, danach rot. B8: der Zug lief nie auf einer gescrollten Zeitleiste, und bei Scrollstand
null geben „Offset lesen" und „Offset ignorieren" dasselbe Ergebnis. Die Harness scrollt jetzt vor
dem Zug, danach rot.

**B5 und B9 waren Dekoration und sind geloescht.** `flex-shrink: 0` auf der Zeitanzeige war nach
dem zweispaltigen Tablet wirkungslos — die strukturelle Loesung hatte die punktuelle ueberfluessig
gemacht, und beide zu behalten heisst, eine Zusicherung zu haben, die nichts unterscheidet. Die
Zug-Schwelle war ein zweiter, schwaecherer Ausdruck einer Bedingung, die `dropAt` ohnehin
durchsetzt: ein ruhender Druck steht auf dem Bibliothekseintrag, und der liegt nie ueber den
Spuren. Mit der Schwelle fielen auch die Startkoordinaten im Griff — `MediaGrab` ist jetzt die
Medien-Id und kein Objekt mehr.

**Damit sieben Runden in Folge, in denen eine ueberlebende Mutation Dekoration statt Logik
gezeigt hat.** Das ist kein Zufall mehr, das ist ein Werkzeug.

**B10 ist Fehlerklasse „Kommentar gegen Messung".** Neben der Reihenfolge von `onDropMedia` und
`onGrabEnd` stand, sie sei wichtig, damit ein Aufrufer das Medium nicht unter dem Drop wegzieht.
Die Gegenprobe widerlegt das: das Ziel ist vor beiden Rueckrufen aufgeloest und liegt in einer
lokalen Variablen. Der Kommentar sagt das jetzt.

**B12 ist ehrlich zu benennen statt zu reparieren.** `cover` gegen `contain` ist nicht
unterscheidbar, weil beide Fixtures 16:9 sind und die Kachel es auch ist — die beiden Verfahren
liefern dasselbe Bild. Um es zu unterscheiden, braeuchte die Harness ein Hochformat- oder
4:3-Medium. Nicht gebaut; die Wahl ist kosmetisch und hier als ungeprueft vermerkt.

---

## Schirmbilder, und was darauf zu sehen ist

Alle aus `pnpm --filter videola-web test:browser`, an der **gebauten** Anwendung in echtem Chrome.

**`phone.png`** (390×844, `devicePixelRatio` 2, Beruehrung an) — die Kopfzeile traegt drei Elemente
und **passt vollstaendig ins Bild**: `☰`, Rueckgaengig, Wiederholen. Nichts abgeschnitten, nichts
ausserhalb. Darunter die Vorschau mit einem dekodierten Bild, der Transport mit Pause-Knopf (die
Wiedergabe laeuft) und vollstaendigem Timecode `00:00:01.04 / 00:00:04.00`, die drei Reiter mit
„Zeitleiste" aktiv, und die Zeitleiste mit V1 und zwei Clips.

**`phone-library.png`** — derselbe Kopf. Reiter „Medien" aktiv, darunter **Medien importieren,
Aufnehmen, Aus der Galerie**, und der Bibliothekseintrag mit einem **echten Vorschaubild** links
neben Name, Laenge, Maßen und Abtastrate. Das Bild ist der dekodierte Frame, keine Flaeche.

**`phone-inspector.png`** — Reiter „Eigenschaften" aktiv, die Vorschau steht weiter oben, darunter
die Transformationsschieber ueber die volle Breite. Das ist der Beleg dafuer, dass das Telefon kein
Betrachter mehr ist.

**`tablet.png`** (834×1112, Beruehrung an) — die Kopfzeile mit Wortmarke, Menue, Rueckgaengig,
Wiederholen, Exportieren, DE, Thema und Speichern, alles im Bild. Links die Bibliothek mit **zwei
Medien und zwei verschiedenen Vorschaubildern** (Farbbalken und Mandelbrot). Rechts das grosse
Vorschaubild, darunter der Transport mit vollstaendigem Timecode und darunter die
Eigenschaften. Unten die Zeitleiste mit **V1 und V2**: auf V1 die beiden angehaengten Clips, auf V2
`second.mp4` dort, wo der Finger ihn hingezogen hat.

**`preview.png`** und **`templates.png`** unveraendert in ihrer Aussage.

---

## Was ich weggelassen habe, und warum

- **`packages/media/src/thumbnails.ts` unter genau diesem Pfad.** Die Abhaengigkeitsrichtung laesst
  es nicht zu; begruendet oben. Die DoD-Zeile ist inhaltlich erfuellt, die Pfadangabe nicht.
- **`waveform.ts`.** Nicht im Auftrag und nicht in den drei Punkten. Sie waere die naheliegende
  Fortsetzung: `AudioSource` steht, und die Bibliothek hat jetzt eine Kachelspalte, in der sie
  Platz haette.
- **Kollabierbare Seitenpanels auf dem Tablet**, die die Spec nennt. Das zweispaltige Raster loest
  das Platzproblem ohne einen Aufklappmechanismus, und ein Mechanismus, den nichts braucht, ist
  der teuerste Weg zu demselben Bild. Wenn die Bibliothek einmal wegklappbar sein soll, ist
  `<details>` derselbe Griff wie in der Kopfzeile.
- **Eine Bildratenzahl fuer Telefon und Tablet.** Unter SwiftShader auf einem Rechner, auf dem
  parallel vier Rust-Builds laufen, waere sie eine Aussage ueber die Maschine.
- **Ripple-Delete, WebM/VP9, Lippensynchronitaet, ein gezeichneter Uebergang.** Offene DoD-Punkte
  aus `task-24-report.md`, aber nicht die drei, die dieser Auftrag nennt.
- **Ein drittes Fixture im Hochformat**, das `cover` gegen `contain` unterscheiden wuerde. Siehe
  B12.

---

## Eine Anmerkung zum Bauen, und eine widerlegte Annahme

`wasm-pack` ist in diesem Worktree dreimal abgebrochen (`STATUS_ILLEGAL_INSTRUCTION`,
`STATUS_ACCESS_VIOLATION`) und ein vierter Lauf hat ueber eine Stunde CPU verbraucht, ohne fertig
zu werden — mehrere Agenten bauen parallel Rust auf derselben Maschine.

Um nicht daran zu haengen, habe ich zwischenzeitlich das Artefakt aus einem Nachbar-Worktree
uebernommen, nachdem drei Worktrees mit byte-identischen Rust-Quellen, `Cargo.lock` und
`rust-toolchain.toml` **byte-identische** `videola_core_bg.wasm` erzeugt hatten.

**Diese Annahme war falsch, und der eigene Lauf hat sie widerlegt.** Der spaetere Bau in diesem
Worktree liefert einen anderen Hash und **1.629.619 statt 2.359.558 Bytes** — er hat `wasm-bindgen`
frisch geholt und `wasm-opt` durchlaufen lassen. Drei uebereinstimmende Ausgaben belegen also
nicht, dass der Bau reproduzierbar ist, sondern nur, dass drei Laeufe dieselbe zwischengespeicherte
Werkzeugversion benutzt haben. Ein Beispiel dafuer, wie eine Stichprobe wie ein Beweis aussieht.

**Der Endstand haengt daran nicht.** Alle oben genannten Zahlen — `typecheck`, 737 Tests, `build`
und alle vier Harnessen — sind danach **gegen das selbst gebaute Artefakt** noch einmal vollstaendig
durchgelaufen und gruen. Das Artefakt ist `.gitignore`d und in keinem Commit; nichts in diesem
Meilenstein fasst `crates/` an.

---

## Was gebunden bleibt

- **Ein Pointer-Events-Pfad.** Der Zug aus der Bibliothek ist kein zweiter — die Bibliothek meldet
  ein Medium, die Timeline beurteilt die Geste. Wer spaeter ein Ziel ausserhalb der Timeline
  braucht, sollte `dropAt` dorthin ziehen und nicht die Geste teilen.
- **Breiten gehoeren in `.v-editor`, nicht in die Flaeche.** `.v-inspector` mit eigener Breite hat
  die Rasterspalte geschlagen und die Schieber aus dem Fenster geschoben. Jede Spalte wird jetzt in
  der Schale gesetzt.
- **Eine Flaeche, die ein Canvas enthaelt, braucht eine Rasterzeile, die ihr Hoehe gibt.** `auto`
  gibt ihr null, und kein anderer Test sieht es.
- **Ein neuer Reiter in `PanelTabs.TABS` braucht seinen Zweig in `App.tsx`**, sonst zeigt er nichts;
  und die nicht sichtbare Flaeche wird ausgehaengt, nicht versteckt.
- Der Anwendungs-Harness-Port ist `VIDEOLA_HARNESS_PORT`; dieser Lauf hing auf 4550.
