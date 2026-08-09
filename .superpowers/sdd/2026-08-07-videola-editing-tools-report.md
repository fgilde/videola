# Schnitt-Werkzeuge: Geschwindigkeitsrampen und Voreinstellungen

Arbeitsverzeichnis `C:\dev\privat\github\videola-audio2`, Zweig `feat-audio2`. Nicht gepusht, nicht
gemergt. Neun Commits.

## Ist die Geschwindigkeitsrampe drin?

Ja. Sie war die Aufgabe wert und sie ist nicht groesser als der Rest zusammen — weil der harte Teil
genau eine Funktion ist und alles andere daran haengt statt daneben zu liegen.

### Wie die Zeitabbildung jetzt aussieht

Vorher:

```
Quelle(t) = in_point + (t − start) · rate
```

Jetzt:

```
Quelle(t) = in_point + ∫ von start bis t ueber rate(u) du
```

`rate(u)` kommt aus einer Keyframe-Spur unter dem Schluessel `speed` (`SPEED_TRACK`,
`model/clip.rs`), im selben Faktor, den `Speed::rate` verwendet. Ohne Spur faellt das Integral auf
die alte Multiplikation zurueck, und zwar in derselben Funktion — es gibt keinen zweiten Pfad.

Das Integral steht in `keyframe::integrate` und ist **exakt und additiv**, nicht numerisch. Fuer ein
Segment zwischen zwei Schluesseln gilt

```
∫ lerp(v0, v1, ease(s)) ds  =  v0·(β−α) + (v1−v0)·(E(β) − E(α))
```

mit `E` als Stammfunktion der Zeitverzerrung: `E(s) = s²/2` fuer `linear`, `E(s) = s³ − s⁴/2` fuer
`ease` (Smoothstep), `E ≡ 0` fuer `hold`. Damit ist die Flaeche ueber einer Spanne exakt die Summe
der Flaechen ueber ihren Teilen.

**Warum das die entscheidende Eigenschaft ist:** `consumed_source()` ist bewusst dieselbe Funktion,
nur fuer `self.duration` gefragt — `source_offset(delta)` mit `delta = duration`. Ein rueckwaerts
laufender Clip liest `in_point + consumed − Flaeche(t)`. Waeren Summe und Anfang aus getrennter
Arithmetik gekommen, faellt der Kopf eines rueckwaerts laufenden Clips aus `[in_point, out_point)`
heraus — und die Klemmung in `readable_source_time_at` haette das stillschweigend kaschiert, statt
den Fehler zu zeigen. Ein Testlauf faehrt genau das ab (`a_reversed_ramp_still_hands_the_decoder_a_time_inside_the_range`).

**`bezier` ist abgelehnt.** Seine Zeitverzerrung hat in der Spurzeit keine elementare Stammfunktion.
Eine Naeherung waere nicht additiv (ein Simpson ueber `[0,u]` ist kein Anfang eines Simpson ueber
`[0,1]`), und damit fiele genau die Eigenschaft, auf der alles ruht. Abgelehnt in
`Project::normalize()`, in `keyframe.add` und in `keyframe.setInterp` — durch **dieselbe Funktion**
(`speed_track_bounded`), damit eine Rampe, die ein Weg annimmt, nie eine ist, die der andere nicht
mehr oeffnet. Der Aufweg, falls es je gebraucht wird, steht als Kommentar dort: Substitution
`x = bezier_x(t)` macht den Integranden zu einem Polynom fuenften Grades in `t`.

### Die Naht an `Speed`

Wie im Auftrag vermutet: `speed.rate = 1e30` war das C1-Loch, und die Ratenspur ist dasselbe Loch
eine Ebene tiefer — nur traegt eine Spur beliebig viele Werte, und `keyframe_bounded` fragte bloss,
ob sie endlich sind. `speed_track_bounded` (`model/project.rs`) prueft jeden Schluessel gegen
`0.0..=MAX_SPEED_RATE`, verlangt `ParamValue::Float`, lehnt `bezier` ab und lehnt einen Verbundclip
ab. **Null ist hier erlaubt und auf `Speed::rate` weiterhin nicht** — eine Ratenspur, die null liest,
ist ein Standbild und damit etwas Gewolltes, waehrend eine statische Null ein Clip ist, der nichts
verbraucht und durch den die Verbundabbildung dividiert.

### Ton und Bild

Nicht zwei Umsetzungen, die man im Gleichschritt haelt: **eine Abbildung, zweimal gerechnet.** Ein
`AudioBufferSourceNode` liest seinen Puffer am laufenden Integral von `playbackRate` — genau diesem
Integral. Der Graph uebergibt der Plattform die Ratenkurve als Automation (`ratePoints` in
`audio/graph.ts`), statt eine Zahl zu setzen. Puffer-Versatz und -Laenge kommen aus
`consumedBetween` im Kern, nicht mehr aus `Spanne · rate`.

Dabei fiel eine dritte Kopie der Abbildung auf: `outPoint()` in `graph.ts` rechnete
`duration · rate` selbst und haette unter einer Rampe zu kurz dekodiert — der Clip waere mitten drin
still geworden, und nichts sonst haette es gemeldet. Ebenso `templates/outline.ts`. Beide gehen jetzt
durch `consumedSource`.

`apps/server/src/inspect.ts` meldete fuer einen gerampten Clip `speed 1`. Es meldet jetzt die
Schluessel.

Die Rampe im Ton ist an Samples nachgewiesen: das Testsignal ist eine Rampe 0..1 ueber den Quellbereich,
also sagt ein Sample, welche Quellposition gerade gelesen wird — das Ton-Gegenstueck zu „pro Bild
eine andere Farbe". Jede Erwartung wird aus `consumedBetween` berechnet statt hingeschrieben.

### Wo die zwei Umsetzungen gepinnt sind

`sourceTimeAt` gibt es zweimal (Rust und TypeScript), weil die Zeichenliste den Moment *innerhalb*
einer verschachtelten Timeline braucht und den nicht aus einer Stapelabfrage bekommen kann. Zwei
Umsetzungen **eines Integrals** sind eine schlimmere Gefahr als zwei Umsetzungen einer
Multiplikation: eine Abweichung sammelt sich ueber den Clip an, statt bei einer Rundung
stehenzubleiben, und eine rueckwaerts laufende Rampe liest die *Summe*, um ihren Kopf zu setzen — ein
Fehler im letzten Segment verschiebt also das erste Bild.

`roundtrip.test.ts` faehrt sie deshalb ueber sieben Formen Flick fuer Flick gegeneinander:
lineare Rampe, weiche Rampe, beide rueckwaerts, Standbild aus der Mitte, vier Schluessel gemischter
Zeitverzerrung, und eine Rampe, deren Schluessel innerhalb des Clips liegen (damit auch die flache
Strecke ausserhalb geprueft wird). Gegen den echten WASM-Bau, nicht gegen eine zweite Lesart der
Datei.

## Wurden Voreinstellungen Befehlsfolgen? Und warum?

Ja, ausnahmslos — `packages/core/src/presets.ts`, jede Funktion gibt `Command[]` zurueck und
verschickt nichts selbst.

**Der Grund ist nicht Sparsamkeit, sondern dass ein eigenes Konzept alles verlieren wuerde, was eine
Befehlsfolge geschenkt bekommt:**

| was eine Voreinstellung braucht | wer es schon liefert |
|---|---|
| ein Rueckgaengig-Schritt | `Dispatch.coalesceKey` — `history.coalesces_with` vergleicht nur den Schluessel |
| die Umkehrung | `json_patch::diff` andersherum, keine Zeile Umkehrcode |
| Feldpruefung | die Befehlsschicht, die es ohnehin tut |
| Erreichbarkeit ueber MCP | `POST /api/projects/:id/commands` praegt bereits `batch_<hex>` als Sammelschluessel |

Ein `Preset` in der Projektdatei braeuchte eine eigene Ladeschranke, ein eigenes Rueckgaengig und ein
eigenes Drahtformat — und waere eine **zweite Instanz**, die entscheidet, was „ein viertelgrosses Bild
in der Ecke" heisst, eine, der die Befehle dann widersprechen koennten. Was hier steht, ist
Arithmetik, keine neue Art von Ding.

Gegenprobe im Bestand: `Template` gibt es bereits, und es ist etwas anderes — ein ganzes Projekt plus
Assistent, also ein Rezept auf Projektebene. Dass es existiert, ist gerade das Argument, auf
Clipebene nichts Zweites danebenzustellen.

Belegt statt behauptet: `presets.test.ts` schickt jede Folge unter einem Schluessel gegen den echten
Kern und prueft, dass `undo()` den Zustand **exakt** wiederherstellt (`toEqual(before)`), auch fuer
eine Folge ueber zwei Clips.

### Was gebaut ist

| Voreinstellung | Was sie schickt |
|---|---|
| Standbild ab hier | zwei Schluessel auf der Ratenspur: eigene Rate gehalten, dann null |
| Langsamer Anfang / Ende / Mitte | zwei bzw. drei weiche Schluessel auf der Ratenspur |
| Ken-Burns-Fahrt hinein / heraus | je zwei Schluessel auf `scaleX`/`scaleY` plus Bewegungspfad aus zwei Punkten |
| Bild im Bild | ein `clip.setTransform`, dazu `clip.move`, wenn eine Videospur darueber liegt |
| Geteilter Bildschirm | ein `clip.setTransform` je Clip, jeder auf seine Haelfte **beschnitten** statt gestaucht |
| Titel (untere Drittel / Bauchbinde / Abspannkarte) | ein `clip.add` mit fertigem Textstil |

**Standbild ist eine Rate von null und sonst nichts.** Kein Standbildclip, keine zweite Quellenart,
kein Zweig irgendwo dahinter — und weil es auf der Ratenspur liegt, bleibt der Ton mit stehen, ohne
dass irgendwo etwas dafuer geschrieben wurde. Das war der Punkt, an dem sich das Integral bezahlt
gemacht hat.

Oberflaeche: eine Gruppe „Voreinstellungen" im Inspektor (zweispaltig am Schreibtisch, einspaltig mit
`--v-touch-target` am Finger, beide Themes ueber die vorhandenen Tokens), und „Geteilter Bildschirm"
im Clipmenue der Timeline — die eine Voreinstellung, die von *zwei* Clips handelt, und die Timeline
ist der Ort, an dem zwei Clips ausgewaehlt sind. Beide Sprachen im Katalog, vom bestehenden
`catalogs.test.ts` erzwungen.

## Was ich weggelassen habe, und warum

**Standbild auf einem rueckwaerts laufenden Clip.** Gefunden, weil ich die zwei Achsen gekreuzt habe.
Rueckwaerts liest ein Clip `in_point + consumed − Flaeche`; eine Rate von null verkuerzt `consumed`
und verschiebt damit das Bild, an dem der Clip *verankert* ist, statt jenes, auf dem er stehenbleibt
— er friert immer auf `in_point` ein, egal wo der Abspielkopf stand. Reparierbar waere es nur mit
einem `clip.slip` um einen **negativen** Betrag, und `slip` misst seinen Schritt als Flaeche, hat also
kein Negativ. `frameHold` gibt jetzt `[]` zurueck, der Knopf ist ausgegraut. Ein Testlauf haelt es
abgelehnt.

**Rampen auf und in Verbundclips.** Die Verbundabbildung (`nesting.ts`) kehrt die aeussere Rate durch
Division um und multipliziert die innere damit — beides geht nur, solange eine Rate eine Zahl ist.
Statt das Innere still an falschen Zeitpunkten zu zeichnen, ist die Regel jetzt in **beide**
Richtungen dicht: `speed_track_bounded` lehnt eine Rampe auf einem Verbundclip ab, `clip.nest` lehnt
einen gerampten Clip ab. Der Ausweg fuer den Benutzer steht in der Doku.

**Ein Pixel-Nachweis der Rampe im Browser.** Der Web-Harness misst mit `centrePixel()` gegen ein
Fixture aus *raeumlichen* Farbbalken — die Farbe an einer Stelle sagt nicht, welches Bild laeuft. Ein
echter Nachweis braeuchte ein neues Fixture mit einer Farbe pro Bild plus eine Abtastschleife. Ich
habe es gelassen, weil dieselbe Abbildung bereits zweimal schaerfer gepinnt ist: Flick fuer Flick
gegen den Rust-Kern ueber sieben Formen, und **Sample fuer Sample** in einem echten Offline-Tonlauf —
Sample-Aufloesung ist feiner als Bild-Aufloesung. Der Bildweg geht durch genau dieselbe Funktion
(`readableSourceTimeAt`), und dass die Zeichenliste den Schirm erreicht, messen die 258
GPU-Pruefungen. Ein dritter Nachweis derselben Sache waere teuer und schwaecher.

**Abspann als Rolltitel.** Der Textgenerator kann nur kleine Ein-/Ausfahrten (`TRAVEL = 0.06`). Ein
echter Rolltitel waere zwei `position`-Schluessel auf dem Clip — moeglich, aber `clip.add` gibt die
neue Clip-ID nicht zurueck, also braucht es einen Zwei-Schritt-Tanz in der Oberflaeche. „Abspann" ist
deshalb eine zentrierte Karte und heisst in der Doku auch so, statt eine Rolle zu versprechen.

**Ein Regler fuer die Rampe.** Die Rampe wird ueber die Voreinstellungen und ueber `keyframe.add`
gesetzt, nicht ueber eine eigene Kurvenansicht. Eine Rampen-Zeichenflaeche im Inspektor ist eine
eigene Aufgabe.

**`preserve_pitch`** wird weiterhin nur durchgereicht. `AudioBufferSourceNode` hat keine
Tonhoehenkorrektur; das war vorher so und bleibt es.

## Gegenprobe

Jede Mutation einzeln eingebaut, die engste Suite laufen lassen, zurueckgenommen.

| # | Mutation | Ergebnis |
|---|---|---|
| M1 | Stammfunktion `linear`: `s²/2` → `s` | gefangen |
| M2 | Stammfunktion `ease` → die lineare | gefangen |
| M3 | Halte-Verzweigung in `span_area` entfernt | **ueberlebt — aequivalent, siehe unten** |
| M4 | `integrate` akzeptiert `bezier` | gefangen |
| M5 | `consumed_source` wieder `duration · rate` (Summe von Anfang getrennt) | gefangen |
| M6 | Ratenspur ohne obere Schranke | gefangen |
| M7 | Rampe auf Verbundclip erlaubt | gefangen |
| M8 | gerampter Clip darf verschachtelt werden | gefangen |
| M9 | Rampe ab Zeitnull statt ab `clip.start` gemessen | gefangen |
| M10 | Befehlsschicht ueberspringt die Rampenpruefung | gefangen |
| M11 | Halte-Verzweigung in TypeScript entfernt | **ueberlebt — aequivalent, siehe unten** |
| M12 | Ton wieder auf konstante Rate | gefangen |
| M13 | dekodierter Bereich ignoriert die Rampe | gefangen |
| M14 | Standbild auf rueckwaerts laufendem Clip erlaubt | gefangen |
| M15 | Ken Burns ohne Bewegungspfad | gefangen |
| M16 | Eckbild buendig an der Kante statt eingerueckt | gefangen |
| M17 | alle Voreinstellungen unter einem Sammelschluessel | gefangen |
| M18 | `clip.keyframes?.[…]` → `clip.keyframes[…]` | gefangen |

**Die beiden Ueberlebenden waren dieselbe Sache und kein Testloch.** `ease_area(Hold, s)` gibt an
beiden Enden null zurueck, also faellt die allgemeine Form ohnehin auf `width · start` zusammen — das
ist genau, was ein Halt bedeutet. Die Verzweigung war tote Regel ohne Verhalten dahinter. Ich habe
sie auf beiden Seiten geloescht, statt einen Testlauf zu erfinden, der eine Redundanz festhaelt; die
Sonderbehandlung lebt jetzt an genau einer Stelle. Beide Suiten bleiben gruen.

M18 verdient eine Randnotiz: der Fehler war echt und hat sich als **Aufhaengen** gezeigt, nicht als
Fehlschlag — ein Testfixture ohne `keyframes` liess den Zugriff in einem `async`-Dekodierpfad werfen,
und der Export blieb einfach stehen. Die Ausgabeschicht liest Projektdaten, die sie nicht selbst
gebaut hat; der optionale Zugriff ist Eingabepruefung an einer Vertrauensgrenze, nicht Vorsicht.

## Gruen am Ende

| | |
|---|---|
| `cargo test --workspace` | 0 Fehler, `clippy --all-targets` 0 Meldungen |
| `pnpm typecheck` | 0 |
| `pnpm test` | 86 / 46 / 349 / 450 / 170 |
| `pnpm build` | durch, Doku baut ebenfalls |
| `@videola/ui test:browser` | 136/136 (war 134, zwei dazu) |
| `@videola/engine test:gpu` | 258/258 |
| `@videola/engine test:export` | 35/35, mit ffprobe und ffmpeg auf der Datei |
| `videola-web test:browser` | 182/182, Schirmbilder erneuert |
| `export_catalog` | durch (keine neuen Befehle, Katalog unveraendert) |

Kein neuer Befehl und keine Typaenderung an der Rust-Grenze — die Rampe ist eine Keyframe-Spur, also
traegt `keyframe.add` sie mit. `gen:types` und der Katalogtest bestaetigen das, statt es
vorauszusetzen.
