# M5 — Templates

Branch `m5-templates`, Worktree `../videola-templates`, Basis `b7c5ab9` (Merge `m1-export` in
`m1-editor`). Sieben Commits, nicht gepusht, nicht gemergt.

Am Ende grün: `cargo test --workspace`, `pnpm typecheck`, `pnpm test`, `pnpm build`, und alle vier
Browser-Harnessen. Die Anwendungs-Harness ist von **56 auf 83** Prüfungen gewachsen.

---

## 1. Was gebaut ist

| Teil | Wo |
|---|---|
| Vorlagenformat, Platzhalter, Bake | `crates/videola-core/src/template/mod.rs` |
| Vier mitgelieferte Vorlagen | `crates/videola-core/src/template/builtin.rs` |
| `.videolat`-Container | `crates/videola-core/src/format/{reader,writer}.rs` |
| WASM-Grenze | `crates/videola-core-wasm/src/{lib,inner}.rs` |
| TS-Fassade | `packages/core/src/{wasm-backend,backend,document}.ts` |
| Galerie und Assistent | `packages/ui/src/templates/` |
| Verdrahtung | `apps/web/src/App.tsx` |
| Beweis im Browser | `apps/web/browser/{driver.js,run.mjs}` |
| Doku | `apps/docs/guide/templates.md`, `apps/docs/de/guide/templates.md` |

---

## 2. Das Format, und warum es so aussieht

**`.videolat` = der `.videola`-Container plus einem Eintrag `template.json`.** Keine Variante, keine
eigene Familie: derselbe ZIP, dasselbe `videola.json`, dasselbe `project.json`, dieselbe
inhaltsadressierte Medienbenennung unter `media/<sha256>`.

Die Begründung ist die zweite Sprosse der Leiter, nicht Bequemlichkeit. Der Reader trägt schon:
zwei getrennte Größenschranken (64 MiB für JSON, 512 MiB pro Medium, 2 GiB gesamt), den `take()`-Schutz
gegen einen lügenden ZIP-Header, den Hash-Vergleich gegen manipulierte Medienbytes, den
Migrationsweg über `schemaVersion` und die Regel „fehlendes Medium ist eine Warnung, kein Abbruch".
Ein zweites Format hätte all das ein zweites Mal gebraucht, oder — wahrscheinlicher — nicht gehabt.
Und derselbe Nebeneffekt fällt gratis an: **dieselben Bytes öffnen sich weiterhin als Projekt.** Eine
Vorlage ist ein Projekt mit Fragen daran, keine zweite Art von Dokument. Das ist genau die Aussage,
die „Bake-to-Project" auf der Formatebene macht.

Konkrete Diff-Größe dieser Entscheidung: `TEMPLATE_ENTRY` als Konstante, ein `Option`-Feld an
`LoadedProject`, `write_template` neben `write` über einen gemeinsamen privaten Rumpf, und
`read_template_manifest`. Rund 50 Zeilen.

Eine Stelle ist bewusst nicht symmetrisch: **ein vorhandenes, aber kaputtes `template.json` lässt die
ganze Datei scheitern**, statt sie stillschweigend als Projekt durchzulassen. `read_entry_bytes`
meldet „nicht vorhanden" und „nicht lesbar" als denselben Fehler, deshalb wird die Anwesenheit
getrennt gefragt (`has_entry`). Sonst wäre aus einer beschädigten Vorlage wortlos ein Projekt
geworden.

### Der mitgelieferte Satz ist Rust-Code, nicht JSON

Vier Vorlagen als Datenliteral wären rund 600 Zeilen JSON mit handgeschriebenen Clip-Ids gewesen.
Als Rust-Funktionen sind sie typisiert, teilen Hilfsfunktionen und haben deterministische Ids. Damit
der Deserialisierungsweg trotzdem geprüft ist, geht ein Test jede mitgelieferte Vorlage durch den
echten ZIP-Container und vergleicht das Ergebnis mit dem Original (`template_format.rs`).

---

## 3. Platzhalter: ein Enum statt eines Pfad-Strings

Die Spezifikation schreibt eine Bindung als `{ clipId, path }`. Gebaut ist ein Enum:

```rust
pub enum SlotBinding {
    ClipMedia { clip: ClipId, fit: Fit },   // Quelle + Einpassung
    ClipLabel { clip: ClipId },             // Name auf der Zeitleiste
    ProjectTitle,                           // Projektname, Browser-Tab, Exportname
    Background,                             // settings.background
}
```

**Begründung.** Ein Pfad-String braucht einen JSON-Pointer-Schreiber, kann jedes Feld des Projekts
benennen (auch solche, die kein Slot je vernünftig füllt) und ist nicht prüfbar, bevor er geschrieben
wird. Das Enum ist kürzer, kann kein Feld benennen, das es nicht gibt, und — der eigentliche Punkt —
**jede Variante ist etwas, das man heute sehen kann.** Sobald Generatoren gezeichnet werden, wächst
die Liste um eine Variante und nicht um eine Maschinerie. Das Modell für alle anderen wird nicht
komplizierter: **das Datenmodell hat kein einziges neues Feld bekommen.** Der Herkunftsvermerk beim
Backen landet in `Project::extra`, dem `#[serde(flatten)]`-Beutel, den es schon gab.

`Vec<SlotBinding>` pro Slot ist nicht Dekoration: der eine Medien-Slot von „Auftakt und Abspann"
füllt den ersten *und* den letzten Clip. Genau dieser Fall ist getestet und mutiert (M23).

**Keine Ton-Slots.** Ein Musikbett bräuchte eine Datei in jeder Vorlage (Repo-Größe) oder einen
Upload bei jeder Benutzung, und keine Harness hier kann das Ergebnis hören — headless Chrome hat
keine Ausgabe (steht so schon im M1-Ledger). Eine Slot-Art, keine Maschinerie; kostet später eine
Variante.

**Der Titel-Slot bindet auf den Projektnamen, nicht ins Bild.** Es gibt keine Textmaschine. Der
Hinweis im Assistenten sagt das wörtlich. Damit ein Titel überhaupt *irgendwo* sichtbar wirkt, setzt
`apps/web` jetzt `document.title` — eine Zeile, und die Harness kann sie ablesen.

---

## 4. Die Ladeschranke

`Template::normalize` läuft **jedes Mal**: für den mitgelieferten Satz, für eine Datei von der Platte
und für eine Vorlage, die aus JavaScript über die WASM-Grenze zurückkommt (nichts hindert den Host
daran, sie unterwegs zu ändern — `fromTemplate` normalisiert deshalb erneut, bevor gebacken wird).
Zuerst `Project::normalize`, dann:

* Schema-Version, Id, Obergrenze 64 Slots
* jedes angebotene Bildformat gegen `dimension_bounded` — dieselbe Funktion, die Projektbreite und
  -höhe prüft, jetzt `pub(crate)` statt privat
* Slot-Ids vorhanden und eindeutig; jede Bindung zulässig für die Art ihres Slots; jede Bindung
  benennt einen existierenden Clip; `Fit` endlich und mit positiver Fläche
* **jeder Slot in genau einem Schritt.** Ein verpflichtender Slot, nach dem kein Schritt fragt, ließe
  den Assistenten dem Backen eine Antwortmenge übergeben, die es abweisen *muss* — die Sackgasse
  zeigte sich erst am letzten Knopf. Zweimal gefragt ist genauso falsch.
* **jeder Clip entweder von einem Slot gefüllt oder durch mitgebrachtes Material gedeckt.** Das ist
  die Regel gegen den leeren Galerieeintrag, im Kern und nicht im Review.
* **keine Generator- und keine Compound-Clips.** `sourceSize` in `draw-list.ts` lässt beide heute
  weg. Eine Vorlage darauf sähe in der Zeitleiste vollständig aus und wäre auf dem Schirm leer.

### Ein drittes Loch in derselben Naht

Die Sitzung hatte zwei gefunden (`speed.rate = 1e30`, Bezier-Anfasser ohne Endlichkeitsprüfung). Hier
ist ein drittes: **`settings.background` war ungeprüft.** `parseColor` in `draw-list.ts` liefert für
alles, was es nicht lesen kann, deckendes Schwarz — kommentarlos. Ein Tippfehler wurde damit zu einer
Farbe statt zu einer Meldung. Gefunden, weil ein Farb-Slot genau in dieses Feld schreibt, und
geschlossen, wo es hingehört: in `settings_bounded`, der einen Schranke, die der Ladeweg *und*
`project.setSettings` teilen. Ein Farb-Slot kann jetzt nichts einschmuggeln, was der Compositor still
umdeutet — nicht weil das Backen es prüft, sondern weil das Backen in `Project::normalize` endet.

---

## 5. Bake-to-Project

```
bake(&self, answers, settings: Option<&ProjectSettings>) -> Result<Project>
```

Frische Projekt-Id, gewähltes Bildformat, jede Antwort angewandt, unbeantwortete optionale
Medien-Clips **entfernt** (ein Clip, der auf nicht vorhandenes Material zeigt, zeichnet gar nichts —
ein unsichtbares Rechteck in der Zeitleiste wäre die Vorlage, die etwas verspricht, was sie nicht
zeigen kann), Herkunftsvermerk in `extra`, dann `Project::normalize`.

**Kein Command.** Die Spezifikation listet `template.instantiate` unter `template.*`. Commands sind
Bearbeitungen mit einer Umkehrung; „dieses Projekt ist entstanden" hat keine, und ein Undo darüber
wäre Unsinn. Backen ist ein Dokument-Konstruktor wie `open`. Alles danach ist ein Command wie jeder
andere — der Katalog bleibt bei 26.

### Einpassen ist die eigentliche Leistung

Nichts in der Oberfläche dieser Fassung setzt eine Clip-Transformation. Ein 640×360-Clip in einem
1080p-Projekt sitzt als kleines Rechteck in der Mitte; das steht so im M1-Ledger als Befund von
Gruppe G. Eine Bindung trägt ein Rechteck in Bruchteilen des Bildes und `cover` oder `contain`; das
Backen kennt Materialgröße *und* gewähltes Bildformat und rechnet Maßstab und Position daraus.
Deshalb bedient eine Vorlage 16:9, 9:16 und 1:1 aus demselben Material. Geschrieben werden nur
Maßstab und Position — Drehung, Deckkraft, Beschnitt und Anker bleiben, wie die Vorlage sie setzte.

### Zu kurzes Material wird verlangsamt, nicht gekürzt

Der Rhythmus *ist* die Vorlage. Eine gekürzte Aufnahme hinterließe ein Loch dort, wo die nächste
Überblendung ein Bild erwartet; die Clips danach zu verschieben wäre eine andere Vorlage als die, die
die Karte zeigte. Also `speed.rate = verfügbar / gewollt`, mit einer benannten Decke: unter 0,25
(vierfache Verlangsamung) liest sich eine Aufnahme als Standbild, und dort weist das Backen ab. Der
Assistent nennt die gewünschte Länge; der Kern entscheidet, was er ablehnt — die Ablehnungsregel in
der Oberfläche zu wiederholen wäre eine zweite Instanz zum Mitpflegen.

### Keine Drift

Zeit ist ganzzahlig in Flicks, `Rate` bleibt rational. Ein Test backt dieselbe Vorlage auf 30 und auf
25 Bilder pro Sekunde und vergleicht **Flicks, nicht Sekunden**: identisch. Die Einpassung ändert sich
dabei sehr wohl (Querformat in ein Hochkant-Bild muss wachsen), und genau das prüft derselbe Test —
sonst wäre „nichts hat sich geändert" auch dann wahr, wenn das Bildformat ignoriert würde.

---

## 6. Der mitgelieferte Satz — und was er wirklich zeigt

Der Renderer dieser Fassung zeichnet: Medien-Clips, eine Transformation, **eine** Überblendung,
**einen** Helligkeitseffekt, eine Hintergrundfarbe. Keine Textmaschine, keine Effektbibliothek. Jede
Vorlage ist so gebaut, dass sie genau eines davon bei der Arbeit zeigt:

| Vorlage | Aufbau | Was daran heute wirklich funktioniert |
|---|---|---|
| **Drei Aufnahmen** | 3 × 2,5 s auf einer Spur, 0,5 s Überlappung, 6,5 s | die Überblendung — und die Einpassung, in drei Bildformaten |
| **Auftakt und Abspann** | 2 s / 3 s / 2 s, ein Slot füllt Clip 1 und 3, Helligkeitskurven 0→1 und 1→0 | ein Platzhalter, der an zwei Stellen schreibt; Auf- und Abblenden aus dem Schwarz — die einzige Art, die diese Fassung dafür hat |
| **Hochformat-Story** | 4 × 1,8 s hart geschnitten, 1080×1920, 7,2 s | die Einpassung als solche: Querformat füllt ein Hochkant-Bild statt in Balken zu liegen |
| **Bild im Bild** | zwei Spuren, Hintergrund bildfüllend, Einblendung `contain` in (0,60 / 0,06 / 0,34 / 0,34), 6 s | zwei gestapelte Spuren und eine Einpassung in ein Rechteck statt ins ganze Bild |

**Keine bringt Material mit.** Bewusst: eine Vorlage ist ein Rezept, Video mitzuliefern machte jeden
Eintrag so schwer wie das Projekt, aus dem er kam, brächte eine Lizenzfrage mit und stellte fremdes
Material in die Galerie statt der Idee der Vorlage. Folge fürs Repository: null Bytes. Folge für den
Import: jede Vorlage hat mindestens einen verpflichtenden Medien-Slot, und der Assistent führt durch
den ganz normalen Import (gehasht, in OPFS, per `probe` vermessen) — dasselbe, was ein Ablegen auf
den Editor tut.

**Die Karte zeigt kein Vorschauvideo, sondern den Zeitstrahl, den die Vorlage baut** — direkt aus
deren Projekt gelesen, ein Block pro Clip, eine Zeile pro Spur, die Überblendung als Verlauf am Kopf
des eingehenden Blocks. Damit kann eine Karte nicht mehr versprechen als das Ergebnis hält, und ein
Standbild aus fremdem Fundus wäre genau diese Behauptung gewesen.

Vier automatische Tests halten den Satz an dieser Linie: jede Vorlage geht durch die Ladeschranke;
jede backt vollständig beantwortet in ein Projekt, in dem **jeder** Clip Material in der Bibliothek
hat und kein Platzhalter übrig ist; jedes *angebotene* Bildformat backt wirklich; und keine benutzt
einen Effekt oder Übergang, den die Registry nicht kennt (`effectPasses` und `mixPass` überspringen
einen unbekannten Typ **stillschweigend** — das sähe wie eine Vorlage aus, die einfach nichts tut).

---

## 7. Autoren-Modus: entschieden, begründet, halb gebaut

Gebaut ist **„Projekt als Vorlage speichern"**, aus der Galerie. Jedes Medium, das das Projekt
benutzt, wird ein verpflichtender Slot, gebunden an *jeden* Clip, der es benutzt; das Material bleibt
zurück (die Bibliothek wird geleert, was die Clips genau in den Platzhalterzustand versetzt, den die
Ladeschranke erlaubt); ein Titel- und ein Farb-Slot kommen dazu; zwei Schritte.

**Nicht gebaut** ist das Markieren von Slots im Editor: Slots von Hand benennen, gruppieren und in
Schritte einteilen ist ein kleiner Editor für sich.

**Warum trotzdem diese Hälfte und nicht null.** Ohne einen Schreiber hätte das `.videolat`-Format
keinen Produzenten — ein Format, das niemand schreibt, ist selbst ein Versprechen ohne Deckung. Mit
„speichern" plus „Vorlagendatei öffnen" ist der Kreis geschlossen und im Test belegt: Projekt →
Vorlage → ZIP → Vorlage → gebackenes Projekt mit *anderem* Material (`template_format.rs` und
`templates.test.ts`, beide Richtungen).

---

## 8. Ein Fehler, den die Vorlagen aufgedeckt haben, aber nicht verursacht

Beim ersten Harness-Lauf war die Vorschau nach dem Backen **weiß**. Ursache lag nicht bei den
Vorlagen: `Playback.dispose()` ruft `context.dispose()`, und das ruft `WEBGL_lose_context.loseContext()`
— mit Absicht, weil ein Browser nur begrenzt viele Kontexte hält. Die Leinwand gehört aber der
Oberfläche und überlebt das Playback. Das nächste Playback bekam dieselbe Leinwand mit einem dauerhaft
verlorenen Kontext.

**Das traf „Öffnen" genauso, seit es das gibt.** Nur hat nie jemand nach dem Öffnen eines zweiten
Projekts auf die Vorschau gesehen. Behoben an der Klasse, nicht an der Instanz: `adopt()` ist jetzt
der einzige Weg, ein Dokument zu übernehmen, und zählt eine Epoche hoch, an der `<Preview>` als `key`
hängt — ein neues Dokument bekommt eine neue Leinwand und damit einen neuen Kontext. Drei gleiche
Fünfzeiler in `App.tsx` sind dabei zu einem geworden; der Fix ist **kürzer** als das, was er ersetzt.

---

## 9. Was geprüft ist

| Lauf | Vorher | Jetzt |
|---|---|---|
| `cargo test --workspace` | 242 | 292 |
| `@videola/core` (vitest, echter WASM-Kern) | 20 | 40 |
| `@videola/ui` (vitest) | 211 | 262 |
| `@videola/media`, `@videola/engine` | 30 / 236 | unverändert |
| `pnpm --filter @videola/engine test:gpu` | 89 | 89 |
| `pnpm --filter @videola/engine test:export` | 27 | 27 |
| `pnpm --filter @videola/ui test:browser` | 29 | 29 |
| **`pnpm --filter videola-web test:browser`** | **56** | **83** |

Bundle: JS 614,24 → **659,59 kB** roh, 173,12 → **184,73 kB** gzip. Die Galerie und der Assistent
kosten rund 11,5 kB gzip. (Die WASM-Zahl ist hier nicht vergleichbar: lokal wird mit `--no-opt`
gebaut, weil `wasm-opt` auf diesem Rechner defekt ist.)

### Der Beweis ist ein Bild

`apps/web/browser/templates.png`, erzeugt von einem vierten Chrome-Lauf über die **gebaute**
Anwendung: Galerie öffnen, „Drei Aufnahmen" wählen, drei Platzhalter mit einer echten Datei füllen
(als `FileList` aus einem `DataTransfer` — genau deshalb benutzt der Assistent
`input[type=file]` und keinen gescripteten Picker), Titel tippen, Farbe wählen, backen. Danach:
drei Clips auf der Zeitleiste und ein 640×360-Farbbalkenbild, das den 1920×1080-Rahmen **randlos
füllt**.

Zwei Zusicherungen tragen die Behauptung des Meilensteins, und beide unterscheiden:

* **250 px pro Clip.** Zweieinhalb Sekunden bei Vorgabezoom. Die Datei hat nur 2,0 s. Hätte das
  Backen gekürzt statt verlangsamt, wären es 200 px — und dort, wo die Überblendung ein Bild
  erwartet, klaffte ein Loch. Zusätzlich die Versätze 0 / 200 / 400 px, also die Überlappung selbst.
* **Kein Hintergrund bleibt stehen.** Gezählt werden Pixel, die der gewählten Hintergrundfarbe
  gleichen, nicht helle Pixel: eine dunkle Aufnahme ist dunkel, ob eingepasst oder nicht, aber
  Hintergrund ist Hintergrund. Ohne Einpassung wären acht Neuntel des Bildes die gewählte Farbe.
* Und die Farbe selbst, hinter dem letzten Clip gemessen, kanalweise auf ±3.

Erste Fassung der Farbprüfung war falsch gebaut und wurde korrigiert: die Warteschleife wartete auf
„blau" und hätte damit exakt das abgefragt, was die Zusicherung behauptet. Jetzt wartet sie auf „das
Bild hat sich geändert", und eine falsche Farbe fällt an der Zusicherung statt an einem Zeitablauf.

---

## 10. Gegenprobe

**43 Mutationen, 43 rot** — nach einer Runde, in der die eine Überlebende toten Code freigelegt hat.

### Rust-Kern (29)

| # | Absichtlicher Fehler | Ergebnis |
|---|---|---|
| M1 | `cover` nimmt die kleinere Kante | rot: `cover_in_a_portrait_frame_scales_by_the_taller_edge` |
| M2 | Einpassung zentriert nicht auf den Rahmen | rot (2), u. a. `contain_fits_inside_an_inset_box_and_lands_on_its_centre` |
| M3 | zu kurzes Material wird nie verlangsamt | rot (2) |
| M4 | keine Untergrenze für die Verlangsamung | rot: `material_far_too_short_is_refused_instead_of_frozen` |
| M5 | gewähltes Bildformat wird ignoriert | rot (3), u. a. `baking_at_another_frame_rate_moves_no_clip_by_a_single_flick` |
| M6 | fehlende Pflichtantwort wird durchgelassen | rot |
| M7 | unbeantworteter optionaler Medien-Clip bleibt stehen | rot |
| M8 | Titelantwort wird nicht geschrieben | rot |
| M9 | Farbantwort wird nicht geschrieben | rot (2) |
| M10 | jeder Clip gilt als gedeckt | rot (2), inkl. Generator-Regel |
| M11 | Slot ohne Schritt ist in Ordnung | rot |
| M12 | Slot darf in zwei Schritten stehen | rot — **erst nach Nachtrag eines Tests**, siehe unten |
| M13 | jede Zeichenkette ist eine Farbe | rot (2), Lade- und Backweg |
| M14 | Medien-Slot darf einen Nicht-Medien-Clip füllen | **ÜBERLEBT** → toter Code, siehe unten |
| M14b | Medien-Bindung darf einen nicht existierenden Clip nennen | rot |
| M15 | Projekt-Schranke wird für eine Vorlage übersprungen | rot |
| M16 | „als Vorlage speichern" behält das Material | rot (2) |
| M17 | zweimal benutztes Medium bindet nur seinen ersten Clip | rot |
| M18 | kaputtes `template.json` macht die Datei zum Projekt | rot |
| M19 | Container wird ohne `template.json` geschrieben | rot (5) |
| M20 | zwei Bakes teilen eine Projekt-Identität | rot |
| M21 | Überblendung ist auf den Schnitt zentriert | rot: `a_dissolve_is_covered_by_a_real_overlap` |
| M22 | die überblendenden Clips überlappen nicht | rot |
| M23 | die Rahmen-Aufnahme öffnet nur | rot (3) |
| M24 | die Einblendung füllt das ganze Bild | rot |
| M25 | Clip wird auf das Material gekürzt statt verlangsamt | rot (2) |
| M26 | Clip-Beschriftung wird nicht geschrieben | rot |

**M14 ist der Fund.** Die Prüfung „ein Medien-Slot darf nur einen Medien-Clip füllen" konnte kein
Ergebnis mehr ändern: `check_every_clip_has_a_source` weist eine Vorlage mit *irgendeinem* anderen
Clip-Typ ohnehin ab, und beide Wege liefern `InvalidArgument`. Die Prüfung änderte nur den Wortlaut.
Entfernt; `media_clip` ist zu `exists` geschrumpft, und die Mutation gegen die verbleibende Aussage
ist rot. **Sechste Runde in Folge, in der eine überlebende Mutation Dekoration statt Logik zeigt.**

**M12 war ein falsch-positives „rot".** Der erste Durchgang meldete Nicht-Null-Exit ohne einen
einzigen fallenden Test: die Mutation hatte gar nicht kompiliert (ohne `insert` konnte Rust den Typ
des `BTreeSet` nicht mehr ableiten). Ein Compilerfehler ist kein bestandener Test. Zusicherung
nachgetragen (`a_slot_asked_about_in_two_steps_is_refused`), Mutation compilierbar neu gefahren, rot.
**Für die Merkliste: bei einer Mutation ist „Exit ≠ 0" nicht dasselbe wie „ein Test ist gefallen".**

### Oberfläche (10, gegen die vitest-Suite)

| # | Absichtlicher Fehler | Ergebnis |
|---|---|---|
| J1 | `slotNeeds` ignoriert die Clip-Geschwindigkeit | rot |
| J2 | jeder Block der Karte beginnt am Anfang | rot (2) |
| J3 | Dauer ist die Summe der Clips statt ihr Ende | rot (4) |
| J4 | ein Schritt ist immer vollständig | rot |
| J5 | geleerte optionale Antwort wird doch geschrieben | rot |
| J6 | die Bildformatwahl wird ignoriert | rot |
| J7 | Medien-Antworten erreichen den Abschluss nicht | rot (2) |
| J8 | das Titelfeld startet leer | rot (5) |
| J9 | eine Karte zeichnet einen Block, egal was drin ist | rot |
| J10 | ein Medien-Slot gilt als beantwortet, bevor eine Datei da ist | rot |

### Gebaute Anwendung in Chrome (4)

Jede dieser vier braucht einen neuen WASM- und einen neuen Anwendungs-Build, also rund fünf Minuten
pro Stück. Sie sind die einzigen, die etwas über Pixel sagen.

| # | Absichtlicher Fehler | Ergebnis |
|---|---|---|
| H1 | nichts wird eingepasst, der Clip behält seine Größe | rot: *and the fitted clip leaves no background showing* |
| H2 | die Farbantwort wird nicht geschrieben | rot (3): die drei Kanalprüfungen hinter dem letzten Clip |
| H3 | der Clip wird auf das Material gekürzt statt verlangsamt | rot: *each one is as long as the template says* — gemessen `[200,200,200]` gegen `[250,250,250]` |
| H4 | ein neues Dokument benutzt die alte Vorschauflaeche weiter | rot: das Bild kommt überhaupt nicht, der Lauf läuft in seine Frist |

H4 ist die Gegenprobe zum Fix aus Abschnitt 8: ohne ihn bleibt die Vorschau nach dem Backen leer.

### Zwei Fehler in meiner eigenen Prüfmaschinerie, beide gefunden und benannt

**Der teurere:** mein Mutationsskript ignorierte den Rückgabewert des *Wiederherstellungs*-Builds.
Als der WASM-Build danach an einem sporadischen rustc-Absturz scheiterte, blieb die **mutierte**
WASM-Datei auf der Platte liegen, und die nächsten drei Harness-Läufe meldeten dieselben drei roten
Farbprüfungen — die aussahen wie eine flackernde Zusicherung und in Wahrheit die Mutation aus H2
korrekt anzeigten. Erst per Hand neu gebaut, dann dreimal 83/83. **Ein Prüfaufbau, der einen
Exit-Code wegwirft, ist selbst untestet.** Das Skript prüft ihn jetzt und bricht ab.

**Der subtilere:** die Zusicherung „kein Hintergrund bleibt stehen" las den Zeichenpuffer ein
*zweites* Mal. Ein Puffer, den der Seiten-Compositor schon geholt hat, liest sich als vier Nullen
zurück — und ein leerer Puffer enthält auch keinen Hintergrund. Die Messung hätte bestanden, indem
sie leer war, statt indem sie richtig war. Beide Zahlen kommen jetzt aus derselben Lesung, und die
Lesung ist die, die schon ein Bild gefunden hat. Verwandt mit dem tautologischen Test: eine
Zusicherung, die auf zwei Wegen wahr wird, prüft nur den bequemeren.

---

## 11. Was nicht geprüft ist, und was nicht da ist

**Nicht geprüft:**

* **Ton.** Headless Chrome hat keine Ausgabe (M1-Ledger). Keine Vorlage benutzt Ton, also ist auch
  nichts unbelegt behauptet — aber ein Ton-Slot ließe sich hier nicht beweisen, und das ist der
  Grund, dass es keinen gibt.
* **Die Helligkeitskurven von „Auftakt und Abspann" als Pixel.** Dass ein keyframegesteuerter
  Helligkeitseffekt am Ende im Shader ankommt, ist in `test:gpu` und in `templates.test.ts` belegt
  (Keyframes hinaus und wieder herein über die WASM-Grenze). Dass die *Vorlage* wirklich aus dem
  Schwarz aufblendet, ist nicht mit einer Pixelmessung belegt — die Anwendungs-Harness fährt „Drei
  Aufnahmen".
* **„Hochformat-Story" und „Bild im Bild" auf dem Schirm.** Beide backen im Test und in jedem
  angebotenen Bildformat; die Pixelmessung läuft an „Drei Aufnahmen".
* **`readTemplate` aus einer echten Datei im Browser.** Der Weg ist in Rust und in vitest geprüft
  (echte ZIP-Bytes, echter Kern); im Browser ist das Dateifeld der Galerie nicht gefahren.
* **Das Handy-Layout mit Galerie und Assistent.** Der Assistent ist in einer Spalte gebaut und der
  Scrim scrollt, aber kein Lauf hat ihn in 390 px gemessen.
* **Das Speichern einer Vorlage als Download.** Der `saveAsTemplate`-Aufruf ist über den echten Kern
  geprüft, der `downloadBlob` daneben nicht — wie beim bestehenden `save`.

**Bewusst nicht gebaut** (jedes davon steht auch in der Doku):

* Titel im Bild. Es gibt keine Textmaschine.
* Ton-Slots.
* Remote-Katalog (`GET /api/templates`) — additiv, späterer Meilenstein.
* Filter und Suche in der Galerie. Vier Karten brauchen beides nicht.
* Slot-Markierung im Editor (siehe Abschnitt 7).
* Das Material eines Slots nach dem Backen tauschen. Das Backen vermerkt die Herkunft, aber nicht die
  lebenden Bindungen — weil noch nichts diesen Knopf anbietet.

**Ein bewusst offener Unterschied.** `media.import` verlangt eine kanonische Medien-Id (`med_` plus
64 Hex); das Backen tut es nicht, genau wie der `.videola`-Ladeweg es nicht tut. Der Writer schützt
sich selbst (`media_entry_name` hasht alles, was kein Inhaltshash ist), und die Oberfläche liefert
nur Assets aus dem echten Importweg. Benannt, nicht geschlossen.
