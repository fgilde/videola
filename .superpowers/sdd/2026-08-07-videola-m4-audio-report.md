# M4 — Audio-Vollausbau: Bericht

Worktree `../videola-audio`, Branch `m4-audio`, sechs Commits auf `8b0755a`. Nicht gepusht, nicht
gemergt.

Am Ende gruen: `cargo test --workspace` (295 Rust-Tests), `pnpm typecheck`, `pnpm test`
(827 JS-Tests, vorher 730), `pnpm build`, und alle vier Harnessen — GPU 89/89, Export 27/27,
UI 41/41, Anwendung **108/108** (vorher 98).

---

## 1. Was gebaut ist

### 1.1 Rueckwaerts laufende Clips sind hoerbar (`57e49a0`)

Der `ponytail:`-Marker in `audio/graph.ts` ist weg, und die Definition of Done von M1 stimmt an
diesem Punkt jetzt.

Ein `AudioBufferSourceNode` kennt keine negative Abspielrate, also spielt ein umgekehrter Clip eine
**umgedrehte Kopie seines eigenen Bereichs**, einmal beim Vorbereiten erzeugt. Der Marker sagte
voraus, dass dazu „der Versatz invertiert" werden muesse — **das stimmt nicht, und das ist der
interessante Teil.** Eine Zeitleistenposition `p` im Clip verbraucht `p x rate` Sekunden Quelle,
vom Ausspielpunkt zurueckgerechnet; dasselbe `p x rate` vom Anfang der umgedrehten Kopie vorwaerts
ist genau derselbe Abtastwert. Die Versatz-Arithmetik in `#schedule` brauchte **keine einzige
Aenderung**. Der Fix ist eine Zeile im Zwischenspeicherschluessel, eine Pufferkopie und eine
geloeschte Bedingung.

`hasAudibleClips` zaehlt umgekehrte Clips jetzt mit. Das war die Wurzel und nicht das Symptom: der
Export teilt sich das Praedikat mit dem Graphen, und ohne den Fix dort haette der Export weiter eine
stumme Tonspur fuer Material geschrieben, das die Wiedergabe schedult.

Gemessen an echten Abtastwerten aus `node-web-audio-api`: eine Rampe rueckwaerts liest bei 0,25 s
den Wert 0,75; der Wiedereinstieg mitten im Clip trifft die Position, die die Zeitleiste nennt; bei
Rate 2 wird die Quelle vom Ausspielpunkt gezaehlt; eine Blende legt sich auf den Kopf, den der Clip
tatsaechlich spielt.

### 1.2 Wellenform (`9cb8728`)

`packages/media/src/waveform.ts` existiert jetzt — die sichtbarste Luecke im Ton ist zu.

`peaks(channels, buckets)` haelt **Min und Max je Bucket**, nicht den Mittelwert: ein Mittelwert
macht aus einem Snare-Schlag eine Delle und aus einer Passage Sprache ein graues Band.

**Die Samples kommen aus den Puffern, die der Graph fuer die Wiedergabe schon dekodiert hat.**
`AudioGraph.waveforms(buckets)` liest seine eigenen Stimmen. Kein zweiter Dekodierlauf, kein zweiter
Zwischenspeicher — und ein umgekehrter Clip zeigt sich so, wie er spielt, weil der gehaltene Puffer
bereits die umgedrehte Kopie ist. Ein Clip, den der Graph nicht schedult, bekommt keinen Eintrag,
und genau das laesst die Timeline „kein Ton" von „noch nicht gelesen" unterscheiden.

Der Streifen ist ein **SVG-Pfad in eigenen Koordinaten**, per `viewBox` und
`preserveAspectRatio="none"` auf den Clip gedehnt. Damit ueberlebt er jede Zoomstufe und jede
Fenstergroesse unveraendert — es steht keine Breite darin, die veralten koennte. Der Pfad ist eine
reine Funktion und als Zeichenkette pruefbar, was in jsdom sonst nicht ginge.

### 1.3 Lautheit nach EBU R128 (`09eb7ce`)

`integratedLufs(channels, sampleRate)` und `peakDbfs(channels)` in
`packages/engine/src/audio/loudness.ts`, plus `measureLoudness(ctx, project, source)` in `graph.ts`.

Geprueft gegen die **Konformitaetsfaelle aus EBU Tech 3341 in ihrer angegebenen Laenge** — Fall 1
(-23 LUFS), Fall 2 (-33), Fall 3 (10 s / 60 s / 10 s, relatives Tor) und Fall 4 (mit -72-Strecken,
absolutes Tor). Die Segmentlaengen sind nicht Dekoration: wie weit eine leise Strecke den
ungetorten Mittelwert zieht, entscheidet, ob das relative Tor ueberhaupt bis zu ihr hinunterreicht.

`measureLoudness` misst **das Programm, nicht das Material**: ein echter Offline-Lauf des echten
Graphen. Clip-Pegel, Blenden, Spur-Busse, Stumm, Solo und der Summenregler sind darin, weil sie alle
die Zahl veraendern. Die Tests zeigen das: der Spurregler auf 0,5 kostet exakt 6,02 LU, der
Summenregler ebenso, eine stummgeschaltete Spur liefert minus unendlich.

### 1.4 Mischpult (`fb4ee84`)

Ein Streifen je Spur mit Pegel, Panorama, Stumm und Solo — **ueber die Kommandos, die der Kern schon
hat**. `track.setVolume`, `track.setPan`, `track.setFlags`. Kein neues Modell, keine Rust-Aenderung,
kein wasm-Bau. Dazu die Lautheitsanzeige mit Messknopf.

Stumm und Solo bleiben unabhaengig, weil der Graph Stumm ueber Solo stellt. Die Streifen stehen in
der Reihenfolge, in der die Timeline stapelt, nicht in der des Kerns. Ein Zug am Regler ist ein
Schritt in der Historie.

### 1.5 Doku (`5fb43fd`)

`apps/docs/guide/audio.md` und `apps/docs/de/guide/audio.md`, in beiden Kapitellisten in
`config.mts`. Mit einem Abschnitt „Was es noch nicht gibt", der die Luecken benennt statt sie
anzudeuten.

---

## 2. Was aus Audiola uebernommen ist

### Lizenz — zuerst lesen

| Pfad | Lizenz | Folge |
|---|---|---|
| `Audiola/` (Wurzel, `src/`) | **Keine LICENSE-Datei.** README: „Proprietary… All rights reserved" | Videola steht unter **GPL-3.0**. Derselbe Autor, also ist die Umlizenzierung deine Entscheidung — aber sie ist **nicht getroffen und nicht dokumentiert**. Was ich uebernommen habe, ist unten einzeln aufgefuehrt und in den Quelldateien als Herkunft vermerkt. **Wenn das so nicht gewollt ist, sag es — es sind zwei umschriebene Algorithmen, keine kopierten Dateien.** |
| `Audiola/cleaner/TrackAICleaner/` | **CC BY-NC 4.0** — verbietet kommerzielle Nutzung ausdruecklich | **Nichts uebernommen.** Unvereinbar mit GPL-3.0. Nur gelesen. |
| `Audiola/mmm/mmm/` | CC0 1.0 | Nichts uebernommen — AI-Wasserzeichenentferner, alles Substanzielle ist ein librosa-Aufruf. |

Es gibt in `Audiola/src/` **keine** SPDX- oder Copyright-Kopfzeilen.

### Uebernommen

| Aus | Nach | Was |
|---|---|---|
| `Dsp/LoudnessMeter.cs` (100 Z., C#) | `packages/engine/src/audio/loudness.ts` | Struktur der R128-Messung: 400-ms-Bloecke, 100-ms-Schritt, `-0,691 + 10 log10(z)`, absolutes Tor bei -70, relatives bei -10 LU, Koeffizienten pro Abtastrate neu gerechnet statt Tabelle. **Mit zwei Korrekturen, siehe unten.** |
| `Dsp/Biquad.cs` (117 Z., C#) | ebenda | `HighShelf`- und `HighPass`-Formeln (RBJ). Nur diese zwei; `Peaking`, `LowShelf`, `MagnitudeDb` nicht gebraucht. |
| `Services/AudioEdits.ComputePeaks` (~35 Z., C#) | `packages/media/src/waveform.ts` | Min/Max-Bucketing fuer die Wellenform. **Mit korrigierten Bucketgrenzen, siehe unten.** |

### Bewusst *nicht* uebernommen

- **`Dsp/Fft.cs`** — `AnalyserNode` und `OfflineAudioContext` decken das ab.
- **`Dsp/Compressor.cs`, `Models/EqBand.cs`, `LiveEqProcessor.cs`** — die Plattform bringt
  `BiquadFilterNode` und `DynamicsCompressorNode` nativ mit, mit weichem Knie, das Audiolas
  Kompressor fehlt. Ein Port waere ein zweiter, konkurrierender Filter gewesen.
- **`MasteringProfiles.cs`** (14 Presets als Datentabelle) — haengt an EQ und Kompressor, die es
  noch nicht gibt. Presets ohne die Regler waeren Versprechen ohne Deckung.
- **`SpatialAudioService.cs`** (binaural, VBAP, Lautsprecher-Tabellen) — ausserhalb dessen, was in
  einen Durchgang passt, und `PannerNode` deckt den Wiedergabeweg.
- **`AudioEffects.cs`** (De-Esser, Schroeder-Hall, Stereo-Verbreiterung) — kein Ort im Modell, an
  dem Parameter bleiben koennten.

### Was in Audiola *nicht* existiert

Gesucht und nicht gefunden, quer durch `src/`:

- **Rauschreduktion.** Kein `noise`, `denoise`, `spectral subtraction`, kein Rauschtor. Null Treffer.
- **Beat-Erkennung / BPM.** Keine eigene Implementierung. In `mmm` ist es
  `librosa.beat.beat_track(...)`, also ein Bibliotheksaufruf.

Beide standen auf meiner Liste als „aus Audiola uebernehmen". **Sie sind dort nicht zu holen** und
muessten von Grund auf entstehen. Das hat die Priorisierung mitentschieden.

### Zwei Fehler im Original, beide gemessen

**(1) Die K-Bewertungs-Konstanten sind falsch.** Audiola traegt einen angepasst aussehenden Satz
(Kuhschwanz 1681,9744509555319 / 0,7071752369554196 / 3,999843853973347). Mit der RBJ-Formel geben
die **die im Standard abgedruckte 48-kHz-Tabelle nicht wieder**:

| | Kuhschwanz b | K-Verstaerkung @ 1 kHz |
|---|---|---|
| Audiolas Konstanten | 1,52930 -2,63612 1,15848 | **+0,438 dB** |
| BS.1770 Tabelle | 1,53512 -2,69170 1,19839 | **+0,698 dB** |
| pyloudnorm-Vorgaben (1500 Hz / 1/Wurzel2 / 4 dB) | 1,53518 -2,69180 1,19843 | +0,699 dB |

Der Kommentar im Original sagt „aus pyloudnorm abgeleitet"; pyloudnorms tatsaechliche Vorgaben sind
die **runden** Zahlen. Die Wirkung: **jede Messung liest 0,25 LU zu leise, auf jedem Pegel.** Die
ersten drei Konformitaetsfaelle schlugen alle um genau 0,253 fehl, bevor ich es fand. Der
+2-dB-Mittelpunkt der Tabelle liegt bei ~1500 Hz, nicht bei 1681,97 — daran war es zu sehen.

**(2) Der Zaehler des Hochpasses.** BS.1770 tabelliert `[1, -2, 1]`; die RBJ-Skalierung auf
Durchlassverstaerkung eins kostet weitere **0,043 dB**. Videola behaelt den Zaehler des Standards.

Audiolas **Hochpass-Konstanten** (38,135 / 0,50033 statt 38 / 0,5) sind dagegen **harmlos**: der
Unterschied bei 1 kHz betraegt 0,00007 dB. Nachgerechnet, nicht angenommen — die Mutation L2 blieb
gruen, und das ist hier eine gleichwertige Mutation und keine Testluecke.

**(3) `ComputePeaks` verliert das Ende jedes Clips.** `perBucket = frames / targetBuckets` in
Ganzzahl-Division liefert fuer 2999 Bilder bei 2000 Buckets die Schrittweite 1 und damit **2999
Buckets** — bei einem Streifen von 2000 Pixeln faellt der Schwanz hinten heraus. Videola leitet die
Grenzen aus der Bucketzahl des Aufrufers ab und liefert exakt so viele, wie verlangt.

---

## 3. Was an echten Abtastwerten gemessen ist

Nichts unten ist behauptet; alles ist aus einem Lauf abgelesen.

**Unter Node, mit `node-web-audio-api` (echte Automation, echte Abtastwerte):**

- Rampe rueckwaerts: 0,75 bei 0,25 s, 0,25 bei 0,75 s. Bei Rate 2 dieselben Werte, vom Ausspielpunkt
  gezaehlt. Wiedereinstieg bei Projektzeit 0,5 s liefert 0,5 am Ausgang null.
- Der Spurregler auf 0,5 kostet **6,02 LU**, der Summenregler ebenso. Eine Blende ueber die halbe
  Cliplaenge senkt die gemessene Lautheit.
- Ein Projekt bei Einheitsverstaerkung misst **auf 0,1 LU genau dasselbe** wie dieselben
  Abtastwerte direkt ins Messgeraet — der Graph aendert den Pegel nirgends.

**Reine Arithmetik, gegen den veroeffentlichten Standard:**

- EBU Tech 3341 Fall 1 → **-23,0 LUFS**, Fall 2 → **-33,0**, dazu -20 dBFS → **-20,0**.
- Fall 3 (10/60/10 s) → **-23,0**. Fall 4 (mit -72-Strecken) → **-23,0**.
- 44,1 kHz liest dasselbe wie 48 kHz (auf 0,1 LU).
- Mono liest **3,01 LU** unter demselben Signal in Stereo — die Antwort des Standards, kein Fehler.
- Die Kuhschwanz-Ebene: 10 kHz liest **3,3 LU** ueber 1 kHz, 8 kHz und 12 kHz liegen gleichauf,
  10 Hz faellt unter -40 LUFS.

**In echtem Chrome, gegen die gebaute Anwendung, ueber OPFS und einen echten Dekodierlauf:**

- Der Wellenformstreifen der Testdatei erreicht **y = 0,821** — also rund 0,18 Amplitude, etwa
  -15 dBFS. Ein echtes Signal, keine Haarlinie.
- Dieselbe Datei misst **-21,8 LUFS** ueber einen echten `OfflineAudioContext`. **Spitzen bei
  -15 dBFS und Lautheit bei -21,8** — dichtes Material mit wenig Spitzenreserve. Ich hatte im ersten
  Anlauf „leise Spitzen, also leises Programm" angenommen und die Harnesse hat mich widerlegt.

---

## 4. Gegenprobe

**44 Mutationen, 44 rot nach Aufraeumen.** Sieben Ueberlebende im ersten Durchgang: **drei waren
toter Code**, zwei waren echte Testluecken, zwei sind gleichwertig und bleiben benannt.

| # | Mutation | Ergebnis |
|---|---|---|
| **`peaks` (packages/media)** | | |
| W1 | Minimum nie mitgefuehrt | 2 rot |
| W2 | Ganzzahl-Schrittweite (Audiolas Original) | **ueberlebte** → Test „liest den letzten Abtastwert bei ungerader Teilung" ergaenzt → 1 rot |
| W3 | Keine Mindestbreite je Bucket | 1 rot |
| W4 | Keine Kanalmischung | **ueberlebte** (Test war nicht diskriminierend: 1 + -1 = 0 mit und ohne Teiler) → Test auf zwei gleiche Kanaele geaendert → 1 rot |
| W5 | `isFinite`-Wache entfernt | **ueberlebte → TOTER CODE.** Mit der Mindestbreite laeuft die Schleife immer mindestens einmal. Entfernt. |
| W6 | Bildzahl nur aus Kanal 0 | **ueberlebte → spekulative Allgemeinheit.** Die Kanaele eines `AudioBuffer` sind immer gleich lang. Vereinfacht. |
| W7 | Bucketanfang um eins versetzt | 5 rot |
| W8 | Maximum nie mitgefuehrt | 5 rot |
| **`waveformPath` (packages/ui)** | | |
| P1–P7 | Keine Haarlinie / keine Klemmung / Troege nicht umgedreht / Form nicht geschlossen / y nicht gespiegelt / Bucketzahl nur aus max / leere Spitzenwerte ergeben doch einen Pfad | **alle 7 rot** |
| **`integratedLufs` (packages/engine)** | | |
| L1 | Audiolas Kuhschwanz-Konstanten | 7 rot |
| L2 | Audiolas Hochpass-Konstanten | **ueberlebt — gleichwertig.** 0,00007 dB Unterschied bei 1 kHz, nachgerechnet. Keine Testluecke. |
| L3 | RBJ-Zaehler statt Standard-Zaehler | 2 rot |
| L4 | Offset -0,691 entfernt | 6 rot |
| L5 | Hochpass-Stufe weggelassen | 1 rot |
| L6 | Kuhschwanz-Stufe weggelassen | 8 rot |
| L7 | Kein relatives Tor | 3 rot |
| L8 | Kein absolutes Tor | 1 rot |
| L9 | Relatives Tor ueber alle Bloecke statt ueber die Ueberlebenden | **ueberlebte** → Test mit 60 s Stille ergaenzt → 1 rot |
| L10 | Relatives Tor auf -20 LU geweitet | 3 rot |
| L11 | Block 300 ms | 1 rot |
| L12 | Schritt = Block (keine Ueberlappung) | **ueberlebte** → Test „lauter Schwanz am Ende eines kurzen Clips" ergaenzt → 1 rot |
| L13 | Laengenwache entfernt | **ueberlebte → TOTER CODE.** `frames < blockSize` und `channels.length === 0` sind beide durch die Schleifengrenze abgedeckt. Entfernt; nur `hop < 1` bleibt, weil das eine Endlosschleife verhindert — dafuer jetzt ein eigener Test, der ohne die Wache haengt. |
| L14 | Energie summiert statt gemittelt | 9 rot |
| L15 | Nur erster Kanal | 9 rot |
| L18 | Filterzustand nicht mitgefuehrt | 11 rot |
| **`peakDbfs`** | | |
| L16 | Spitze nur aus Kanal 0 | 1 rot |
| L17 | Sonderfall Stille entfernt | **ueberlebte → TOTER CODE.** `20 * Math.log10(0)` **ist** bereits `-Infinity`. Ternaeroperator entfernt. |
| **Mischpult (packages/ui)** | | |
| M1–M9 | Streifen in Kernreihenfolge / Stumm loescht Solo / Solo loescht Stumm / kein Historienschluessel / Schluessel nie erneuert / Stille als Zahl gedruckt / ungemessen als Messwert / Messknopf waehrend der Messung aktiv / Panorama-Untergrenze bei 0 | **alle 9 rot** |
| **Browser-Harnesse (apps/web)** | | |
| H1 | Wellenform nie an die Timeline gereicht | 2 rot |
| H2 | Streifen immer auf der Haarlinie | 2 rot |
| H3 | Lautheit ohne K-Bewertung | **ueberlebt — absichtlich.** Das Band [-30, -15] ist bewusst weit; die K-Bewertung verschiebt um 0,7 dB. Von den Unit-Tests abgedeckt (L5, L6). Das Band enger zu ziehen machte daraus eine goldene Zahl, die bricht, sobald die Testdatei wechselt. |

**Dreimal hat eine ueberlebende Mutation toten Code freigelegt** (W5, L13, L17), dazu einmal
spekulative Allgemeinheit (W6). Das ist in diesem Projekt inzwischen der Regelfall und kein Zufall.

**Ein eigener Fehler, den die Gegenprobe gefunden hat, bevor er in den Bericht kam:** meine erste
Harnesse-Pruefung „der Streifen traegt ein Signal" las per Regex die **x**-Koordinaten des Pfades
statt der y. `Math.max` davon ist die Bucketzahl minus eins — wahr fuer jeden Pfad ueberhaupt.
**Tautologisch, genau die genannte Fehlerklasse.** Ersetzt durch die y der Ecken.

**Und ein Fund der Harnesse selbst:** die ersten drei Harnesse-Mutationen blieben alle gruen, weil
`apps/web/browser/run.mjs` gegen `dist/` faehrt und **nicht selbst baut**. Ohne Neubau zwischen den
Mutationen misst man den alten Bundle. Wiederholt mit Bau — dann fielen H1 und H2.

---

## 5. Was weggelassen ist, und warum

Ehrlich benannt, auch im Doku-Kapitel, damit die Oberflaeche nichts verspricht.

| Weggelassen | Grund |
|---|---|
| **EQ und Kompressor auf dem Spur-Bus** | `Track.effects` steht im Modell und serialisiert, aber `effect.add`/`effect.setParam` sprechen **nur Clips** an. Es gibt keinen Ort, an dem Bandeinstellungen bleiben koennten. Das braucht ein Rust-Kommando, Neugenerierung der Typen und einen wasm-Bau. **Die Tonseite ist danach kurz** — `BiquadFilterNode` und `DynamicsCompressorNode` sind nativ. Der teure Teil ist das Modell, nicht das DSP. |
| **Summenregler im Mischpult** | Dieselbe Ursache: `project.master.volume` steht im Modell, der Graph beachtet ihn, **kein Kommando schreibt ihn**. |
| **Pegelanzeigen im Betrieb** | Braucht je Bus einen `AnalyserNode`, pro Bild gelesen. In jsdom nicht pruefbar, und headless Chrome hat keine Tonausgabe — es waere ungepruefter Code hinter einer huebschen Anzeige. Der ehrliche Ersatz ist die R128-Messung auf Knopfdruck, die vollstaendig gemessen ist. |
| **Ducking / Auto-Volume** | Braucht Sidechain und damit den Kompressor, also erst nach dem Modell. |
| **Rauschreduktion** | **In Audiola nicht vorhanden** (gesucht, null Treffer). Spektrale Subtraktion von Grund auf ist ein eigenes Vorhaben. |
| **Beat-Erkennung** | **In Audiola nicht vorhanden**, nur ein `librosa`-Aufruf. Von Grund auf ein eigenes Vorhaben. |
| **Spatial-Panning ueber Stereo** | Audiolas binauraler Renderer ist portierbar (~50 Z.), aber das Modell hat kein Kanallayout und kein Kommando fuer eine Position im Raum. |
| **Waveform-Editing im Detail** | Der Streifen ist da und stimmt; ihn *bearbeitbar* zu machen (Auswahl, Verstaerkung, Stille im Bereich) ist eine eigene Gruppe mit eigenen Kommandos. |
| **True Peak (dBTP)** | Braucht Ueberabtastung. `peakDbfs` ist Abtastwert-Spitze und sagt das. |
| **Kurzzeit- und Momentan-Lautheit, LRA** | Der 100-ms-Schritt ist da, die Fenster fehlen. Additiv, sobald eine Anzeige sie will. |
| **Surround-Kanalgewichte** | BS.1770 gewichtet Ls/Rs mit 1,41. Nichts im Modell unterscheidet einen hinteren Kanal von einem vorderen. `ponytail:`-Marker gesetzt. |

---

## 6. Fuer die naechste Gruppe

- **Der billigste naechste Schritt ist ein Rust-Kommando, nicht DSP.** `track.addEffect` /
  `track.setEffectParam` (und `project.setMasterVolume`) schalten EQ, Kompressor, Mastering-Presets
  und den Summenregler **auf einmal** frei, weil die Web-Audio-Knoten die Verarbeitung schon koennen.
  Solange das fehlt, ist jede Tonverarbeitung auf dem Bus nicht speicherbar.
- **Audiolas `MasteringProfiles.cs` sind 14 fertige Presets als reine Datentabelle** und der
  billigste Gewinn, sobald es EQ und Kompressor gibt. Deutsche Beschreibungen, muessen uebersetzt
  werden.
- **Lippensynchronitaet bleibt ungemessen.** Ich habe keinen Weg gefunden: headless Chrome hat keine
  Tonausgabe. Der einzig gangbare Weg, den ich sehe, ist der **Export**: die Harnesse `test:export`
  schreibt bereits eine echte MP4 gegen ffmpeg. Ein Ton mit einem Klick an einer bekannten
  Projektzeit und ein Bild, das an derselben Stelle umschlaegt, liessen sich **in der Ausgabedatei**
  gegeneinander messen. Das prueft die Exportkette, nicht die Wiedergabe — aber es waere die erste
  Zahl ueberhaupt.
- **`AudioSource.bufferFor` bleibt ungetestet** (braucht einen `AudioDecoder`), und damit auch der
  HE-AAC/SBR-Befund. Ich habe es **nicht** testbar gemacht: ein Sink-Fake waere die Falle aus
  Gruppe B gewesen. Die Browser-Harnesse faehrt den Weg jetzt immerhin **echt** — der
  Wellenformstreifen und die -21,8 LUFS kommen beide durch `bufferFor`. Das ist kein Beweis fuer
  HE-AAC, aber der Weg ist nicht mehr voellig unbeobachtet.
- **`prepare`s Generationszaehler ist unberuehrt.** Ich habe verstanden, warum er kein
  Promise-Kette ist, und hatte keinen Grund, ihn anzufassen.
- **Der Zwischenspeicherschluessel traegt jetzt `reverse`.** Ein Clip, der zwischen vorwaerts und
  rueckwaerts umgeschaltet wird, dekodiert einmal je Richtung. Bewusst: ein Umschalten ist selten,
  und zwei Karten oder ein zweiter Schluesselraum waeren mehr Code als der eine gesparte Lauf wert.
